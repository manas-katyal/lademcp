// End to end: a fake charger dials in over OCPP 1.6J, reports a car, and gets
// a charging schedule; the MCP tools see it and can switch it to full power.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "lademcp-"));
process.env.OCPP_PASSWORD = "secret";
process.env.OCPP_CALL_TIMEOUT_MS = "2000";

// Energi Data Service stub: a price dip three hours from now, 24 hours of data.
const slot0 = Math.floor(Date.now() / 900_000) * 900_000;
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request) => {
  const url = String(input);
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19);
  let records: object[] = [];
  if (url.includes("/DayAheadPrices")) {
    records = Array.from({ length: 96 }, (_, i) => ({ TimeUTC: iso(slot0 + i * 900_000), DayAheadPriceDKK: i >= 12 && i < 16 ? 100 : 1000 }));
  } else if (url.includes("/CO2EmisProg")) {
    records = Array.from({ length: 288 }, (_, i) => ({ Minutes5UTC: iso(slot0 + i * 300_000), CO2Emission: 100 }));
  }
  return Promise.resolve(new Response(JSON.stringify({ records }), { status: 200 }));
}) as typeof fetch;

const { listen } = await import("../src/listen.ts");
const { createServer } = await import("../src/mcp.ts");
const { PROFILE_ID } = await import("../src/smart.ts");

let port = 0;
let close: () => void;
before(async () => {
  const s = await listen(0);
  port = (s.server.address() as { port: number }).port;
  close = s.close;
});
after(() => {
  close();
  globalThis.fetch = realFetch;
});

/** A charger that records the calls it receives and answers them. */
function fakeCharger(id: string, password = "secret") {
  const received: { action: string; payload: any }[] = [];
  const waiters: ((f: { action: string; payload: any }) => void)[] = [];
  const ws = new WebSocket(`ws://localhost:${port}/ocpp/${id}`, "ocpp1.6", {
    headers: { authorization: `Basic ${Buffer.from(`${id}:${password}`).toString("base64")}` },
  });
  const replies = new Map<string, (p: any) => void>();
  let n = 0;
  ws.on("message", (data) => {
    const frame = JSON.parse(data.toString());
    if (frame[0] === 2) {
      const call = { action: frame[2], payload: frame[3] };
      received.push(call);
      ws.send(JSON.stringify([3, frame[1], { status: "Accepted" }]));
      waiters.shift()?.(call);
    } else if (frame[0] === 3) replies.get(frame[1])?.(frame[2]);
  });
  return {
    ws,
    received,
    open: () => new Promise<void>((resolve, reject) => { ws.once("open", () => resolve()); ws.once("unexpected-response", (_q, r) => reject(new Error(String(r.statusCode)))); }),
    call: (action: string, payload: object) =>
      new Promise<any>((resolve) => {
        const id = String(++n);
        replies.set(id, resolve);
        ws.send(JSON.stringify([2, id, action, payload]));
      }),
    next: () => new Promise<{ action: string; payload: any }>((resolve) => waiters.push(resolve)),
  };
}

async function mcp() {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([createServer().connect(a), client.connect(b)]);
  return async (name: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    return { error: res.isError, body: res.isError ? res.content[0]!.text : JSON.parse(res.content[0]!.text) };
  };
}

test("a charger with the wrong password is refused", async () => {
  const cp = fakeCharger("ZAP-BAD", "wrong");
  await assert.rejects(cp.open(), /401/);
});

test("a charger with the right password but a different user, or a longer password, is refused", async () => {
  const auth = (user: string, pw: string) => `Basic ${Buffer.from(`${user}:${pw}`).toString("base64")}`;
  for (const authorization of [auth("ZAP-1", "secret"), auth("ZAP-OTHER", "secret2"), auth("ZAP-OTHER", "secre")]) {
    const ws = new WebSocket(`ws://localhost:${port}/ocpp/ZAP-OTHER`, "ocpp1.6", { headers: { authorization } });
    await assert.rejects(new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("unexpected-response", (_q, r) => reject(new Error(String(r.statusCode)))); }), /401/);
  }
});

test("boot, car plugged in, schedule sent into the cheap hour", async () => {
  const cp = fakeCharger("ZAP-1");
  await cp.open();
  const boot = await cp.call("BootNotification", { chargePointVendor: "Zaptec", chargePointModel: "Go" });
  assert.equal(boot.status, "Accepted");

  const next = cp.next();
  await cp.call("StatusNotification", { connectorId: 1, status: "Preparing", errorCode: "NoError" });
  const { action, payload } = await next;
  assert.equal(action, "SetChargingProfile");
  const profile = payload.csChargingProfiles;
  assert.equal(profile.chargingProfileId, PROFILE_ID);
  assert.equal(profile.chargingProfilePurpose, "TxDefaultProfile");
  // 30 kWh at 11 kW needs 11 quarter-hours: the 4 cheap ones first, all charging at 16 A.
  const periods = profile.chargingSchedule.chargingSchedulePeriod;
  assert.ok(periods.some((p: any) => p.limit === 16));
  assert.equal(profile.chargingSchedule.chargingRateUnit, "A");
  // The charger has the call; give the server a moment to read its Accepted.
  await new Promise((r) => setTimeout(r, 50));
});

test("MCP: list_chargers and preview_plan see the charger", async () => {
  const tool = await mcp();
  const list = await tool("list_chargers");
  const zap = list.body.chargers.find((c: any) => c.id === "ZAP-1");
  assert.equal(zap.online, true);
  assert.equal(zap.vendor, "Zaptec");
  assert.equal(zap.last_plan.sent, true);

  const preview = await tool("preview_plan", { charger_id: "ZAP-1", energy_kwh: 11 });
  assert.equal(preview.body.totals.energy_kwh, 11);
  assert.equal(preview.body.charge_in.length, 1);
  assert.match(preview.body.cost_basis, /Spot price only/);
});

test("MCP: charge_now clears the profile and turns smart off", async () => {
  const cp = fakeCharger("ZAP-2");
  await cp.open();
  await cp.call("BootNotification", { chargePointVendor: "Easee", chargePointModel: "Home" });
  const tool = await mcp();
  const next = cp.next();
  const res = await tool("charge_now", { charger_id: "ZAP-2" });
  assert.equal(res.body.smart_charging, false);
  const call = await next;
  assert.equal(call.action, "ClearChargingProfile");
  assert.equal(call.payload.id, PROFILE_ID);
});

test("MCP: an unknown charger gets a helpful error", async () => {
  const tool = await mcp();
  const res = await tool("preview_plan", { charger_id: "NOPE" });
  assert.equal(res.error, true);
  assert.match(res.body, /Known chargers: .*ZAP-1/);
});
