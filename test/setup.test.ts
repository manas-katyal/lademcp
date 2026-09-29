// First-run setup on a public deployment: nothing is reachable until the
// owner has claimed the server by choosing a password, chosen a price area,
// connected a charger and added the server to their assistant.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "lademcp-"));
// Public-looking, so the loopback shortcut for local servers does not apply.
process.env.BASE_URL = "https://lade.example.dk";
delete process.env.OCPP_PASSWORD;
delete process.env.MCP_BEARER_TOKEN;

const { listen } = await import("../src/listen.ts");
const { setup } = await import("../src/setup.ts");

let port = 0;
let close: () => void;
before(async () => {
  const s = await listen(0);
  port = (s.server.address() as { port: number }).port;
  close = s.close;
});
after(() => close());

const url = (path: string) => `http://localhost:${port}${path}`;
let cookie = "";
const get = (path: string) => fetch(url(path), { redirect: "manual", headers: { cookie } });
const post = (path: string, body: unknown) =>
  fetch(url(path), { method: "POST", redirect: "manual", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });

test("the server makes its own secrets and keeps them private on disk", () => {
  const saved = JSON.parse(readFileSync(join(process.env.DATA_DIR!, "setup.json"), "utf8"));
  assert.ok(saved.ocppPassword.length >= 20 && saved.mcpToken.length >= 40);
  assert.equal(setup.ocppPassword(), saved.ocppPassword);
});

test("before setup, the pages lead to /setup and the owner-only routes are closed", async () => {
  assert.equal((await get("/")).headers.get("location"), "/setup");
  assert.equal((await get("/connect")).headers.get("location"), "/setup");
  assert.match(await (await get("/setup")).text(), /Gør serveren til din/);
  assert.equal((await post("/setup/area", { area: "DK2" })).status, 403);
});

test("the first visitor claims the server by choosing a password", async () => {
  const short = await post("/setup/claim", { password: "kort" });
  assert.equal(short.status, 400);
  assert.equal(short.headers.get("set-cookie"), null);
  const ok = await post("/setup/claim", { password: "hemmelig-lader" });
  assert.equal(ok.status, 200);
  cookie = ok.headers.get("set-cookie")!.split(";")[0];
  assert.match(await (await get("/setup")).text(), /Hvor bor du\?/);
});

test("after that, nobody else can claim it, and the password logs in elsewhere", async () => {
  const other = { "content-type": "application/json" };
  assert.equal((await fetch(url("/setup/claim"), { method: "POST", headers: other, body: JSON.stringify({ password: "min-egen-kode" }) })).status, 409);
  assert.match(await (await fetch(url("/setup"))).text(), /Log ind/);
  assert.equal((await fetch(url("/setup/login"), { method: "POST", headers: other, body: JSON.stringify({ password: "forkert-kode" }) })).status, 401);
  const login = await fetch(url("/setup/login"), { method: "POST", headers: other, body: JSON.stringify({ password: "hemmelig-lader" }) });
  assert.equal(login.status, 200);
  assert.equal(login.headers.get("set-cookie")!.split(";")[0], cookie);
});

test("after the area, setup sends the owner to /connect, which shows the charger password", async () => {
  assert.equal((await post("/setup/area", { area: "DK2" })).status, 200);
  assert.equal(setup.priceArea(), "DK2");
  assert.equal((await get("/setup")).headers.get("location"), "/connect");
  const page = await (await get("/connect")).text();
  assert.ok(page.includes(setup.ocppPassword()));
  assert.equal((await post("/setup/finish", {})).status, 409, "no charger yet");
});

test("a charger with the generated password moves setup on to Claude", async () => {
  const ws = new WebSocket(`ws://localhost:${port}/ocpp/SETUP-1`, "ocpp1.6", {
    headers: { authorization: `Basic ${Buffer.from(`SETUP-1:${setup.ocppPassword()}`).toString("base64")}` },
  });
  await new Promise((resolve, reject) => ws.once("open", resolve).once("error", reject));
  ws.close();
  const page = await (await get("/setup")).text();
  assert.match(page, /Tilføj LadeMCP til Claude/);
  assert.ok(page.includes(`https://lade.example.dk/mcp/${setup.mcpToken()}`));
});

test("a charger with no password field can carry the password in the address", async () => {
  const open = (path: string) =>
    new Promise<number>((resolve) => {
      const ws = new WebSocket(`ws://localhost:${port}${path}`, "ocpp1.6");
      ws.once("open", () => (ws.close(), resolve(101)));
      ws.once("unexpected-response", (_req, res) => resolve(res.statusCode!));
    });
  assert.equal(await open(`/ocpp/${setup.ocppPassword()}/EVB-1`), 101);
  assert.equal(await open("/ocpp/wrong-key/EVB-1"), 401);
  assert.equal(await open("/ocpp/EVB-1"), 401, "no password at all");
  assert.equal(await open(`/ocpp/${setup.ocppPassword()}/a/EVB-1`), 404);
});

test("/mcp/<token> works like the bearer header, and the first call is noticed", async () => {
  const call = (path: string) =>
    fetch(url(path), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
  assert.equal((await call("/mcp/wrong-token")).status, 401);
  assert.deepEqual(await (await get("/setup/state")).json(), { assistant: false });
  assert.equal((await call(`/mcp/${setup.mcpToken()}`)).status, 200);
  assert.deepEqual(await (await get("/setup/state")).json(), { assistant: true });
});

test("finishing opens the front page, and /setup then shows what was set up", async () => {
  assert.equal((await post("/setup/finish", {})).status, 200);
  assert.equal((await get("/")).status, 200);
  const page = await (await get("/setup")).text();
  assert.match(page, /LadeMCP er sat op/);
  assert.ok(page.includes("SETUP-1") && page.includes("EVB-1"));
});

test("another browser still cannot see the secrets or add chargers", async () => {
  const stranger = await fetch(url("/setup"));
  const html = await stranger.text();
  assert.ok(!html.includes(setup.ocppPassword()) && !html.includes(setup.mcpToken()));
  assert.equal((await fetch(url("/connect"), { redirect: "manual" })).headers.get("location"), "/setup");
});

test("a browser that claimed the server before passwords is asked to choose one", async () => {
  const { createHmac } = await import("node:crypto");
  const { readFileSync, writeFileSync } = await import("node:fs");
  const f = join(process.env.DATA_DIR!, "setup.json");
  const saved = JSON.parse(readFileSync(f, "utf8"));
  delete saved.ownerHash;
  writeFileSync(f, JSON.stringify(saved));
  setup.reload();
  const legacy = `lade_owner=${createHmac("sha256", saved.ownerKey).update("owner-v1").digest("base64url")}`;
  const page = await (await fetch(url("/setup"), { headers: { cookie: legacy } })).text();
  assert.match(page, /Vælg en adgangskode/);
  const set = await fetch(url("/setup/password"), { method: "POST", headers: { cookie: legacy, "content-type": "application/json" }, body: JSON.stringify({ password: "ny-hemmelig-kode" }) });
  assert.equal(set.status, 200);
  const fresh = set.headers.get("set-cookie")!.split(";")[0];
  assert.match(await (await fetch(url("/setup"), { headers: { cookie: fresh } })).text(), /LadeMCP er sat op/);
});

test("on Railway without a volume, nobody can claim the server", async () => {
  const { setup: s } = await import("../src/setup.ts");
  process.env.RAILWAY_ENVIRONMENT = "production";
  delete process.env.RAILWAY_VOLUME_MOUNT_PATH;
  try {
    assert.equal(s.claim("hemmelig-lader-2"), "no_volume");
  } finally {
    delete process.env.RAILWAY_ENVIRONMENT;
  }
});
