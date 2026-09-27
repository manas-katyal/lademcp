import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSlots, plan, tariffAt, toChargingSchedule } from "../src/planner.ts";

const T0 = new Date("2026-09-27T16:00:00Z"); // 18:00 in Denmark (CEST)
const q = (i: number) => new Date(T0.getTime() + i * 15 * 60_000);

// Eight quarter-hours: cheap at 2–3, clean at 5–6.
const prices = [1.2, 1.1, 0.2, 0.3, 0.9, 0.8, 0.85, 1.0].map((p, i) => ({ start: q(i), spotDkkPerKwh: p }));
const co2 = [300, 290, 250, 260, 200, 40, 50, 180].flatMap((g, i) => [0, 5, 10].map((m) => ({ start: new Date(q(i).getTime() + m * 60_000), gPerKwh: g })));
const slots = buildSlots(prices, co2);
const base = { now: T0, readyBy: q(8), energyKwh: 5.5, maxKw: 11, greenWeight: 0 }; // two quarter-hours

test("cheapest picks the two cheapest quarter-hours", () => {
  const p = plan(slots, base);
  assert.deepEqual(p.chosen.map((s) => s.start), [q(2), q(3)]);
  assert.equal(p.totals.energyKwh, 5.5);
  assert.ok(p.totals.costDkk < p.chargeNow.costDkk);
});

test("greenest picks the lowest-CO2 quarter-hours, and says what that costs", () => {
  const p = plan(slots, { ...base, greenWeight: 1 });
  assert.deepEqual(p.chosen.map((s) => s.start), [q(5), q(6)]);
  assert.ok(p.totals.co2Kg! < p.cheapest.co2Kg!);
  assert.ok(p.totals.costDkk > p.cheapest.costDkk);
});

test("CO2 is averaged per quarter-hour from the 5-minute prognosis", () => {
  assert.equal(slots[5]!.co2GPerKwh, 40);
});

test("too little time: charges in every slot and warns", () => {
  const p = plan(slots, { ...base, readyBy: q(1), energyKwh: 20 });
  assert.equal(p.chosen.length, 1);
  assert.match(p.warnings.join(" "), /only 1 are left/);
});

test("a ready-by beyond the published prices is capped, with a warning", () => {
  const p = plan(slots, { ...base, readyBy: new Date(T0.getTime() + 86_400_000) });
  assert.equal(p.readyBy.getTime(), q(8).getTime());
  assert.match(p.warnings.join(" "), /only published until/);
});

test("the tariff follows the Danish clock, across daylight saving", () => {
  const tariff = Array.from({ length: 24 }, (_, h) => h);
  assert.equal(tariffAt(new Date("2026-09-27T16:00:00Z"), tariff), 18); // CEST
  assert.equal(tariffAt(new Date("2026-12-01T16:00:00Z"), tariff), 17); // CET
});

test("a peak tariff moves charging out of the peak", () => {
  const peak = Array.from({ length: 24 }, (_, h) => (h >= 17 && h < 21 ? 5 : 0));
  // T0 is 18:00, so slots 0–7 fall in 18:00–20:00: all peak. Add later cheap-spot, off-peak hours.
  const late = [0.9, 0.9].map((p, i) => ({ start: new Date(T0.getTime() + (3 * 60 + i * 15) * 60_000), spotDkkPerKwh: p }));
  const withLate = buildSlots([...prices, ...late], [], peak);
  const p = plan(withLate, { ...base, readyBy: new Date(T0.getTime() + 4 * 3_600_000) });
  assert.deepEqual(p.chosen.map((s) => s.start), late.map((l) => l.start));
});

test("schedule: full current in chosen slots, 0 elsewhere, merged, ending with the last chosen slot", () => {
  const p = plan(slots, base);
  const s = toChargingSchedule(p, 16, "A", T0)!;
  assert.equal(s.startSchedule, T0.toISOString());
  assert.deepEqual(s.chargingSchedulePeriod, [
    { startPeriod: 0, limit: 0 },
    { startPeriod: 1800, limit: 16 },
  ]);
  assert.equal(s.duration, 3600);
});

test("schedule starts mid-slot when planned mid-slot", () => {
  const now = new Date(T0.getTime() + 5 * 60_000);
  const p = plan(slots, { ...base, now, greenWeight: 0, energyKwh: 30 });
  const s = toChargingSchedule(p, 16, "A", now)!;
  assert.equal(s.chargingSchedulePeriod[0]!.startPeriod, 0);
  assert.equal(s.startSchedule, now.toISOString());
});
