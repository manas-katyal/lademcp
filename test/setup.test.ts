// First-run setup on a public deployment: nothing is reachable until the
// owner has claimed the server with the code from the log, chosen a price
// area, connected a charger and added the server to their assistant.
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

test("a wrong code does not claim the server; the one from the log does", async () => {
  const wrong = await post("/setup/claim", { code: "NOPE" });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.headers.get("set-cookie"), null);
  const right = await post("/setup/claim", { code: setup.claimCode()!.toLowerCase() });
  assert.equal(right.status, 200);
  cookie = right.headers.get("set-cookie")!.split(";")[0];
  assert.match(await (await get("/setup")).text(), /Hvor bor du\?/);
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
  assert.ok(page.includes("SETUP-1"));
});

test("another browser still cannot see the secrets or add chargers", async () => {
  const stranger = await fetch(url("/setup"));
  const html = await stranger.text();
  assert.ok(!html.includes(setup.ocppPassword()) && !html.includes(setup.mcpToken()));
  assert.equal((await fetch(url("/connect"), { redirect: "manual" })).headers.get("location"), "/setup");
});
