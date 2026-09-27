// Ties it together: fetch prices and CO2 for the charger's area, plan, and
// send the result to the charger as a TxDefaultProfile. Re-plans when a car is
// plugged in, when a charger reconnects, and on a timer while a car is
// connected, so the intraday CO2 updates and tomorrow's prices are picked up.
import { config } from "./config.ts";
import { eds } from "./eds.ts";
import { buildSlots, plan, round2, toChargingSchedule, type Plan } from "./planner.ts";
import { call, isConnected, onChargerEvent } from "./ocpp.ts";
import { maxKw, store, type ChargerSettings } from "./store.ts";

/** A fixed id, so every new plan replaces the previous one instead of stacking on top. */
export const PROFILE_ID = 1776;

/** Statuses that mean a car is plugged in. */
const CAR_PRESENT = new Set(["Preparing", "Charging", "SuspendedEV", "SuspendedEVSE"]);

const TZ = "Europe/Copenhagen";
const parts = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function offsetMs(at: Date): number {
  const p = Object.fromEntries(parts.formatToParts(at).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!) - Math.floor(at.getTime() / 60_000) * 60_000;
}

/** The next moment the Danish clock shows HH:MM, at least 15 minutes from now. */
export function nextReadyBy(hhmm: string, now: Date): Date {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  const p = Object.fromEntries(parts.formatToParts(now).map((x) => [x.type, Number(x.value)]));
  for (let addDays = 0; addDays < 3; addDays++) {
    const wall = Date.UTC(p.year!, p.month! - 1, p.day! + addDays, h, m);
    // Two passes settle the offset across a daylight-saving change.
    let guess = wall - offsetMs(new Date(wall));
    guess = wall - offsetMs(new Date(guess));
    if (guess > now.getTime() + 15 * 60_000) return new Date(guess);
  }
  return new Date(now.getTime() + 86_400_000);
}

const danish = new Intl.DateTimeFormat("da-DK", { timeZone: TZ, weekday: "short", hour: "2-digit", minute: "2-digit" });
export const danishTime = (d: Date) => danish.format(d);

export async function makePlan(s: ChargerSettings, now = new Date(), overrides: Partial<ChargerSettings> = {}): Promise<Plan> {
  const settings = { ...s, ...overrides };
  const [prices, co2] = await Promise.all([eds.prices(settings.priceArea), eds.co2(settings.priceArea)]);
  const slots = buildSlots(prices, co2, config.tariffDkkPerKwh);
  return plan(slots, {
    now,
    readyBy: nextReadyBy(settings.readyBy, now),
    energyKwh: settings.energyKwh,
    maxKw: maxKw(settings),
    greenWeight: settings.greenWeight,
  });
}

export function summarize(p: Plan): string {
  if (!p.chosen.length) return "Nothing to charge in the window.";
  const first = p.chosen[0]!.start;
  const saved = round2(p.chargeNow.costDkk - p.totals.costDkk);
  return `${p.totals.energyKwh} kWh in ${p.chosen.length} quarter-hours from ${danishTime(first)}, ready by ${danishTime(p.readyBy)}; ${p.totals.costDkk} DKK${saved > 0 ? `, ${saved} DKK less than charging right away` : ""}`;
}

/** Sends the plan to the charger. Resolves to the charger's answer (Accepted, Rejected, NotSupported). */
export async function applyPlan(id: string, p: Plan, now = new Date()): Promise<string> {
  const s = store.ensure(id);
  const limit = s.unit === "A" ? s.maxAmps : Math.round(maxKw(s) * 1000);
  const schedule = toChargingSchedule(p, limit, s.unit, now);
  const state = store.state(id);
  if (!schedule) {
    state.lastPlan = { madeAt: now.toISOString(), sent: false, summary: summarize(p) };
    return "Nothing to send";
  }
  const res = await call(id, "SetChargingProfile", {
    connectorId: 0,
    csChargingProfiles: {
      chargingProfileId: PROFILE_ID,
      stackLevel: 1,
      chargingProfilePurpose: "TxDefaultProfile",
      chargingProfileKind: "Absolute",
      chargingSchedule: schedule,
    },
  });
  const status = String(res.status ?? "Unknown");
  state.lastPlan = { madeAt: now.toISOString(), sent: status === "Accepted", summary: summarize(p) };
  return status;
}

/** Removes our profile, so the charger goes back to charging at full power. */
export async function clearPlan(id: string): Promise<string> {
  const res = await call(id, "ClearChargingProfile", { id: PROFILE_ID });
  store.state(id).lastPlan = undefined;
  return String(res.status ?? "Unknown");
}

export const carPresent = (id: string) => Object.values(store.state(id).status).some((s) => CAR_PRESENT.has(s));

const log = (msg: string) => console.error(`[lade ${new Date().toISOString()}] ${msg}`);

async function replan(id: string, why: string): Promise<void> {
  const s = store.get(id);
  if (!s?.smart || !isConnected(id) || !carPresent(id)) return;
  try {
    const p = await makePlan(s);
    const status = await applyPlan(id, p);
    log(`charger ${id} (${why}): ${summarize(p)} -> ${status}`);
  } catch (err) {
    log(`charger ${id} (${why}): planning failed: ${(err as Error).message}`);
  }
}

/** Starts the automatic part. Returns a stop function. */
export function startScheduler(): () => void {
  onChargerEvent((e) => {
    // Plan when a car arrives. Charging -> SuspendedEVSE and back is our own
    // schedule at work, so only the arrival state triggers a new plan.
    // After a restart the charger reports Charging or Suspended* straight away,
    // so a car that is present without a plan also gets one.
    if (e.type !== "status" || !e.status) return;
    if (e.status === "Preparing") void replan(e.id, "car plugged in");
    else if (CAR_PRESENT.has(e.status) && !store.state(e.id).lastPlan) void replan(e.id, "car present without a plan");
    else if (e.status === "Available") store.state(e.id).lastPlan = undefined;
  });
  const timer = setInterval(() => {
    for (const s of store.list()) void replan(s.id, "scheduled");
  }, config.replanMinutes * 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
