// Smart charging through Monta: start in the planned quarter-hours, stop
// outside them, cancel a charge Monta scheduled by itself, and back off when
// Monta keeps doing that.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const QUARTER = 15 * 60_000;
const base = Math.floor(Date.now() / QUARTER) * QUARTER;
const iso = (t: number) => new Date(t).toISOString().slice(0, 19);

// Cheap from two to five hours from now, dear otherwise.
const prices = Array.from({ length: 48 }, (_, i) => ({ TimeUTC: iso(base + i * QUARTER), DayAheadPriceDKK: i >= 8 && i < 20 ? 100 : 2000 }));
const co2 = Array.from({ length: 144 }, (_, i) => ({ Minutes5UTC: iso(base + i * 5 * 60_000), CO2Emission: 100 }));

const monta = { pluggedIn: true, charges: [] as { id: number; state: string; chargePointId: number; startedAt: string; consumedKwh: number }[], calls: [] as string[] };
let nextCharge = 100;

const fake = createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  const url = new URL(req.url!, "http://x");
  if (url.pathname === "/dataset/DayAheadPrices") return res.end(JSON.stringify({ records: prices }));
  if (url.pathname === "/dataset/CO2EmisProg") return res.end(JSON.stringify({ records: co2 }));
  if (url.pathname === "/auth/token") return res.end(JSON.stringify({ accessToken: "tok" }));
  if (url.pathname === "/charge-points/42") return res.end(JSON.stringify({ id: 42, name: "Carport", state: "available", cablePluggedIn: monta.pluggedIn, maxKw: 11 }));
  if (url.pathname === "/charges" && req.method === "GET") return res.end(JSON.stringify({ data: monta.charges }));
  if (url.pathname === "/charges" && req.method === "POST") {
    monta.calls.push("start");
    const id = nextCharge++;
    monta.charges.unshift({ id, state: "charging", chargePointId: 42, startedAt: new Date().toISOString(), consumedKwh: 0 });
    return res.end(JSON.stringify({ id, state: "starting" }));
  }
  const stop = /^\/charges\/(\d+)\/stop$/.exec(url.pathname);
  if (stop) {
    monta.calls.push(`stop ${stop[1]}`);
    const c = monta.charges.find((x) => x.id === Number(stop[1]));
    if (c) c.state = "stopped";
    return res.end("{}");
  }
  res.writeHead(404).end("{}");
});
await new Promise<void>((r) => fake.listen(0, r));
const fakeUrl = `http://localhost:${(fake.address() as { port: number }).port}`;
process.env.MONTA_API_BASE = fakeUrl;
process.env.EDS_API_BASE = fakeUrl;
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "lademcp-"));

const { setup } = await import("../src/setup.ts");
const { store } = await import("../src/store.ts");
const { decide, montaCheck, montaStatus, resetMonta } = await import("../src/monta-control.ts");

before(() => {
  setup.setMonta({ clientId: "id", clientSecret: "secret", chargePointId: 42, name: "Carport" });
  // Ready by the end of the fake price series, so the plan fits in it.
  store.update("monta-42", { readyBy: new Date(base + 11 * 3600_000).toLocaleTimeString("da-DK", { timeZone: "Europe/Copenhagen", hour: "2-digit", minute: "2-digit" }).replace(".", ":"), energyKwh: 20 });
  resetMonta();
});
after(() => fake.close());

test("decide: nothing without a car, start in the plan, stop outside it and when full", () => {
  const d = (o: Partial<Parameters<typeof decide>[0]>) => decide({ pluggedIn: true, charging: false, smart: true, remainingKwh: 10, wantNow: false, ...o });
  assert.equal(d({ pluggedIn: false, wantNow: true }), "none");
  assert.equal(d({ wantNow: true }), "start");
  assert.equal(d({ charging: true }), "stop");
  assert.equal(d({ charging: true, wantNow: true, remainingKwh: 0 }), "stop");
  assert.equal(d({ smart: false }), "start", "charge now");
  assert.equal(d({ smart: false, charging: true }), "none");
});

test("a charge Monta scheduled itself is cancelled, and nothing starts before the cheap hours", async () => {
  monta.charges.push({ id: 7, state: "scheduled", chargePointId: 42, startedAt: new Date(base).toISOString(), consumedKwh: 0 });
  await montaCheck(new Date(base + 60_000));
  assert.deepEqual(monta.calls, ["stop 7"]);
  assert.equal(montaStatus("monta-42")?.pluggedIn, true);
  assert.match(store.state("monta-42").lastPlan!.summary, /kWh/);
});

test("in a planned quarter-hour it starts, and it stops when the energy is in", async () => {
  monta.calls = [];
  await montaCheck(new Date(base + 2 * 3600_000 + 60_000));
  assert.deepEqual(monta.calls, ["start"]);
  await montaCheck(new Date(base + 2 * 3600_000 + 120_000));
  assert.deepEqual(monta.calls, ["start"], "already charging: nothing more");
  monta.charges[0]!.consumedKwh = 20;
  await montaCheck(new Date(base + 2 * 3600_000 + 180_000));
  assert.deepEqual(monta.calls, ["start", `stop ${nextCharge - 1}`]);
});

test("when Monta keeps scheduling its own charges, LadeMCP stops fighting and says so", async () => {
  monta.calls = [];
  for (const id of [8, 9, 10]) {
    monta.charges.unshift({ id, state: "scheduled", chargePointId: 42, startedAt: new Date().toISOString(), consumedKwh: 0 });
    await montaCheck(new Date(base + 7 * 3600_000 + id * 60_000));
  }
  assert.deepEqual(monta.calls, ["stop 8", "stop 9"]);
  assert.equal(montaStatus("monta-42")?.montaScheduling, true);
});

test("a charge started by hand in the Monta app is left running", async () => {
  monta.calls = [];
  for (const c of monta.charges) c.state = "stopped";
  monta.charges.unshift({ id: 55, state: "charging", chargePointId: 42, startedAt: new Date().toISOString(), consumedKwh: 0 });
  await montaCheck(new Date(base + 7 * 3600_000 + 30 * 60_000));
  assert.deepEqual(monta.calls, [], "not ours, and long after plug-in: someone wants to charge now");
  assert.equal(montaStatus("monta-42")?.manualCharge, true);
  monta.charges[0]!.state = "stopped";
});

test("cable out: no plan and no calls", async () => {
  monta.calls = [];
  monta.pluggedIn = false;
  await montaCheck(new Date(base + 8 * 3600_000));
  assert.deepEqual(monta.calls, []);
  assert.equal(store.state("monta-42").lastPlan, undefined);
});
