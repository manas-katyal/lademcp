// Picks the 15-minute slots to charge in. Pure: prices, CO2 and the car's
// needs in, a plan and an OCPP charging schedule out, so it can be tested
// without a charger or the network.
//
// Cost is what the household pays per kWh that varies by time: spot plus the
// grid tariff when one is configured. Elafgift, Energinet's tariffs and VAT on
// top are flat or proportional, so they do not change *which* hours are best.
import type { Co2Point, PriceSlot } from "./eds.ts";

export const SLOT_MINUTES = 15;
const SLOT_MS = SLOT_MINUTES * 60_000;
const SLOT_HOURS = SLOT_MINUTES / 60;

export interface Slot {
  start: Date;
  spotDkkPerKwh: number;
  tariffDkkPerKwh: number;
  /** Undefined when the CO2 prognosis does not reach this far. */
  co2GPerKwh?: number;
}

export interface PlanRequest {
  now: Date;
  /** When the car has to be ready. Capped at the end of the published prices. */
  readyBy: Date;
  energyKwh: number;
  maxKw: number;
  /** 0 = cheapest only, 1 = greenest only; in between blends the two. */
  greenWeight: number;
}

export interface PlanTotals {
  energyKwh: number;
  costDkk: number;
  co2Kg?: number;
}

export interface Plan {
  slots: Slot[];
  chosen: Slot[];
  totals: PlanTotals;
  /** The same amount of energy, charged from the moment the car was plugged in. */
  chargeNow: PlanTotals;
  cheapest: PlanTotals;
  greenest?: PlanTotals;
  readyBy: Date;
  warnings: string[];
}

const danishHour = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Copenhagen", hour: "2-digit", hourCycle: "h23" });

export function tariffAt(start: Date, tariff?: number[]): number {
  if (!tariff) return 0;
  return tariff[Number(danishHour.format(start))] ?? 0;
}

/** Joins prices, tariff and the CO2 prognosis on 15-minute slot starts. */
export function buildSlots(prices: PriceSlot[], co2: Co2Point[], tariff?: number[]): Slot[] {
  const co2BySlot = new Map<number, number[]>();
  for (const point of co2) {
    const key = Math.floor(point.start.getTime() / SLOT_MS) * SLOT_MS;
    const list = co2BySlot.get(key) ?? [];
    list.push(point.gPerKwh);
    co2BySlot.set(key, list);
  }
  return prices.map((p) => {
    const values = co2BySlot.get(p.start.getTime());
    return {
      start: p.start,
      spotDkkPerKwh: p.spotDkkPerKwh,
      tariffDkkPerKwh: tariffAt(p.start, tariff),
      ...(values?.length ? { co2GPerKwh: values.reduce((a, b) => a + b, 0) / values.length } : {}),
    };
  });
}

const costOf = (s: Slot) => s.spotDkkPerKwh + s.tariffDkkPerKwh;

function totals(chosen: Slot[], energyKwh: number, maxKw: number): PlanTotals {
  // Every chosen slot runs at full power except the last, which only needs
  // what is left. The charger does not know that, but the car stops when full.
  let left = energyKwh;
  let cost = 0;
  let co2 = 0;
  let co2Known = true;
  for (const slot of chosen) {
    const kwh = Math.min(left, maxKw * SLOT_HOURS);
    if (kwh <= 0) break;
    left -= kwh;
    cost += kwh * costOf(slot);
    if (slot.co2GPerKwh === undefined) co2Known = false;
    else co2 += (kwh * slot.co2GPerKwh) / 1000;
  }
  return {
    energyKwh: round2(energyKwh - left),
    costDkk: round2(cost),
    ...(co2Known && chosen.length ? { co2Kg: round2(co2) } : {}),
  };
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

function normalizer(values: number[]): (v: number) => number {
  const min = Math.min(...values);
  const span = Math.max(...values) - min;
  return (v) => (span > 0 ? (v - min) / span : 0);
}

/** The cheapest (or greenest, or blended) slots that cover the energy before readyBy. */
function pick(window: Slot[], needed: number, score: (s: Slot) => number): Slot[] {
  return [...window]
    .sort((a, b) => score(a) - score(b) || a.start.getTime() - b.start.getTime())
    .slice(0, needed)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

export function plan(slots: Slot[], req: PlanRequest): Plan {
  const warnings: string[] = [];
  // A slot already under way still counts: charging can start in it right away.
  const window = slots.filter((s) => s.start.getTime() + SLOT_MS > req.now.getTime() && s.start.getTime() < req.readyBy.getTime());
  const lastPublished = slots.at(-1);
  let readyBy = req.readyBy;
  if (lastPublished && req.readyBy.getTime() > lastPublished.start.getTime() + SLOT_MS) {
    readyBy = new Date(lastPublished.start.getTime() + SLOT_MS);
    warnings.push(
      `Prices are only published until ${readyBy.toISOString()}. The plan uses the hours up to then; tomorrow's prices usually arrive around 13:00 and the plan is redone.`,
    );
  }

  const needed = Math.ceil(req.energyKwh / (req.maxKw * SLOT_HOURS) - 1e-9);
  if (needed > window.length) {
    warnings.push(
      `Needs ${needed} quarter-hours at ${req.maxKw} kW but only ${window.length} are left before the car has to be ready, so it charges in all of them and gets about ${round2(window.length * req.maxKw * SLOT_HOURS)} kWh.`,
    );
  }

  const co2Known = window.length > 0 && window.every((s) => s.co2GPerKwh !== undefined);
  const w = Math.min(Math.max(req.greenWeight, 0), 1);
  if (w > 0 && !co2Known) {
    warnings.push("The CO2 prognosis does not cover the whole window yet (it is published around 15:00 for the next day), so slots without it count as average.");
  }
  const co2Values = window.map((s) => s.co2GPerKwh).filter((v): v is number => v !== undefined);
  const co2Mean = co2Values.length ? co2Values.reduce((a, b) => a + b, 0) / co2Values.length : 0;
  const co2Of = (s: Slot) => s.co2GPerKwh ?? co2Mean;
  const normCost = normalizer(window.map(costOf));
  const normCo2 = co2Values.length ? normalizer(window.map(co2Of)) : () => 0;

  const chosen = pick(window, needed, (s) => (1 - w) * normCost(costOf(s)) + w * normCo2(co2Of(s)));
  const byTime = [...window].sort((a, b) => a.start.getTime() - b.start.getTime());

  return {
    slots: byTime,
    chosen,
    readyBy,
    totals: totals(chosen, req.energyKwh, req.maxKw),
    chargeNow: totals(byTime.slice(0, needed), req.energyKwh, req.maxKw),
    cheapest: totals(pick(window, needed, costOf), req.energyKwh, req.maxKw),
    ...(co2Values.length ? { greenest: totals(pick(window, needed, co2Of), req.energyKwh, req.maxKw) } : {}),
    warnings,
  };
}

// --- OCPP 1.6 ChargingSchedule ---

export interface ChargingSchedulePeriod {
  startPeriod: number;
  limit: number;
  numberPhases?: number;
}

export interface ChargingSchedule {
  duration: number;
  startSchedule: string;
  chargingRateUnit: "A" | "W";
  chargingSchedulePeriod: ChargingSchedulePeriod[];
}

/**
 * Turns the chosen slots into one absolute schedule: full current in chosen
 * slots, 0 in the rest, until the end of the last chosen slot. Adjacent slots
 * with the same limit are merged, since some chargers cap the number of periods.
 */
export function toChargingSchedule(p: Plan, limit: number, unit: "A" | "W", now: Date): ChargingSchedule | undefined {
  if (!p.chosen.length) return undefined;
  const chosen = new Set(p.chosen.map((s) => s.start.getTime()));
  const startMs = Math.floor(now.getTime() / 1000) * 1000;
  const end = p.chosen.at(-1)!.start.getTime() + SLOT_MS;

  const periods: ChargingSchedulePeriod[] = [];
  for (const slot of p.slots) {
    const slotEnd = slot.start.getTime() + SLOT_MS;
    if (slotEnd <= startMs || slot.start.getTime() >= end) continue;
    const startPeriod = Math.max(0, Math.round((slot.start.getTime() - startMs) / 1000));
    const value = chosen.has(slot.start.getTime()) ? limit : 0;
    if (periods.at(-1)?.limit === value) continue;
    periods.push({ startPeriod, limit: value });
  }
  return {
    duration: Math.round((end - startMs) / 1000),
    startSchedule: new Date(startMs).toISOString(),
    chargingRateUnit: unit,
    chargingSchedulePeriod: periods,
  };
}
