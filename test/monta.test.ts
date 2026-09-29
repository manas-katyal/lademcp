// A charger that stays in Monta: the owner pastes the application's keys on
// /connect, LadeMCP checks them against Monta and finds the charge point, and
// setup moves on without any charger dialling in over OCPP.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const monta = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c)).on("end", () => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/auth/token") {
      const { clientId, clientSecret } = JSON.parse(body);
      if (clientId !== "id-1" || clientSecret !== "secret-1") return res.writeHead(401).end("{}");
      return res.end(JSON.stringify({ accessToken: "tok" }));
    }
    if (req.url?.startsWith("/charge-points") && req.headers.authorization === "Bearer tok") {
      return res.end(JSON.stringify({ data: [{ id: 42, name: "Carport", state: "available", cablePluggedIn: true, maxKw: 11 }] }));
    }
    res.writeHead(404).end("{}");
  });
});
await new Promise<void>((r) => monta.listen(0, r));
process.env.MONTA_API_BASE = `http://localhost:${(monta.address() as { port: number }).port}`;
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "lademcp-"));
process.env.BASE_URL = "https://lade.example.dk";

const { listen } = await import("../src/listen.ts");
let port = 0;
let close: () => void;
before(async () => {
  const s = await listen(0);
  port = (s.server.address() as { port: number }).port;
  close = s.close;
});
after(() => (close(), monta.close()));

let cookie = "";
const post = (path: string, body: unknown) =>
  fetch(`http://localhost:${port}${path}`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });

test("Monta keys find the charge point and count as the charger step", async () => {
  cookie = (await post("/setup/claim", { password: "hemmelig-lader" })).headers.get("set-cookie")!.split(";")[0];
  await post("/setup/area", { area: "DK1" });
  assert.equal((await post("/setup/monta", { clientId: "id-1", clientSecret: "wrong" })).status, 400);
  const ok = await post("/setup/monta", { clientId: " id-1 ", clientSecret: "secret-1" });
  assert.deepEqual(await ok.json(), { chargePoints: [{ id: 42, name: "Carport", state: "available", cablePluggedIn: true }] });
  const page = await (await fetch(`http://localhost:${port}/setup`, { headers: { cookie }, redirect: "manual" })).text();
  assert.match(page, /Tilføj LadeMCP til Claude/);
  assert.ok(!page.includes("secret-1"));
});

test("the front page's charger status asks Monta, for the owner only", async () => {
  const status = async (withCookie: boolean) => (await fetch(`http://localhost:${port}/api/charger/monta-42`, { headers: withCookie ? { cookie } : {} })).json();
  assert.deepEqual(await status(true), { connected: true, plugged_in: true, vendor: "Monta", model: "Carport" });
  assert.deepEqual(await status(false), { connected: false });
});
