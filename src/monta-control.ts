// Smart charging for a charger that stays in Monta. Monta's API cannot take a
// schedule, only start and stop, so this checks once a minute: is a cable in,
// is a charge running, and should one be running now according to the plan?
// A plan is made when a cable goes in and redone on the usual timer (new
// prices after 13:00, CO2 updates), for the energy still missing.
//
// With smart charging on, a charge outside the planned quarter-hours is
// stopped, including one the charger started by itself when the car was
// plugged in. charge_now turns smart charging off, and then a charge is
// started and left alone.
import { config } from "./config.ts";
import { MontaError, montaActiveCharge, montaChargePoint, montaChargesSince, montaStartCharge, montaStopCharge, montaToken } from "./monta.ts";
import type { Plan } from "./planner.ts";
import { makePlan, summarize } from "./smart.ts";
import { setup } from "./setup.ts";
import { store, type ChargerSettings } from "./store.ts";

export const MONTA_PREFIX = "monta-";
const SLOT_MS = 15 * 60_000;

export interface MontaStatus {
  pluggedIn: boolean;
  charging: boolean;
  state?: string;
  lastAction?: { at: string; action: "start" | "stop"; ok: boolean; why: string };
  error?: string;
  /** Monta keeps scheduling charges of its own: its smart charging is on and fights ours. */
  montaScheduling?: boolean;
  /** Someone started a charge in the Monta app; it is left running until the cable comes out. */
  manualCharge?: boolean;
}

interface Session {
  pluggedAt: Date;
  /** Charges this server started; any other running charge was started by the charger or by a person. */
  ours: Set<number>;
  plan?: Plan;
  plannedAt?: number;
}

const status = new Map<string, MontaStatus>();
let session: Session | undefined;
let token: { value: string; at: number } | undefined;
/** When we last cancelled a charge Monta had scheduled itself. */
let cancelledAt: number[] = [];

const log = (msg: string) => console.error(`[lade ${new Date().toISOString()}] monta: ${msg}`);

export const isMonta = (id: string) => id.startsWith(MONTA_PREFIX);
export const montaStatus = (id: string) => status.get(id);

/** Whether a plan wants the car charging at this moment. */
export const inPlannedSlot = (p: Plan, now: Date) => p.chosen.some((s) => now.getTime() >= s.start.getTime() && now.getTime() < s.start.getTime() + SLOT_MS);

/** The whole decision, kept free of I/O so it can be tested. */
export function decide(o: { pluggedIn: boolean; charging: boolean; smart: boolean; remainingKwh: number; wantNow: boolean }): "start" | "stop" | "none" {
  if (!o.pluggedIn) return "none";
  if (!o.smart) return o.charging ? "none" : "start";
  if (o.remainingKwh <= 0.1) return o.charging ? "stop" : "none";
  if (o.wantNow && !o.charging) return "start";
  if (!o.wantNow && o.charging) return "stop";
  return "none";
}

/** Chargers in Monta start from the power Monta reports, since there is no OCPP BootNotification to go by. */
function settingsFor(id: string, maxKw: number | undefined): ChargerSettings {
  if (store.get(id)) return store.get(id)!;
  const phases = maxKw !== undefined && maxKw < 8 ? 1 : 3;
  const maxAmps = maxKw !== undefined && maxKw > (phases === 1 ? 4 : 12) ? 32 : 16;
  return store.update(id, { maxAmps, phases });
}

async function accessToken(): Promise<string> {
  const keys = setup.monta()!;
  // Tokens last an hour; take a new one well before that.
  if (token && Date.now() - token.at < 45 * 60_000) return token.value;
  token = { value: await montaToken(keys.clientId, keys.clientSecret), at: Date.now() };
  return token.value;
}

/** Forget the current plan, so the next check makes a new one (settings changed, smart charging turned on). */
export function replanMonta(): void {
  if (session) session.plan = undefined;
}

export async function montaCheck(now = new Date()): Promise<void> {
  const keys = setup.monta();
  if (!keys?.chargePointId) return;
  const id = `${MONTA_PREFIX}${keys.chargePointId}`;
  try {
    const t = await accessToken();
    const cp = await montaChargePoint(t, keys.chargePointId);
    const active = await montaActiveCharge(t, keys.chargePointId);
    const s = settingsFor(id, cp.maxKw);
    const running = Boolean(active?.running);
    const st: MontaStatus = { ...status.get(id), pluggedIn: cp.cablePluggedIn, charging: running, state: cp.state, error: undefined };
    status.set(id, st);

    if (!cp.cablePluggedIn) {
      if (session) log(`${id}: cable out`);
      session = undefined;
      store.state(id).lastPlan = undefined;
      return;
    }
    if (!session) {
      session = { pluggedAt: now, ours: new Set() };
      log(`${id}: cable in`);
    }

    let remaining = s.energyKwh;
    let wantNow = false;
    if (s.smart) {
      const delivered = await montaChargesSince(t, keys.chargePointId, session.pluggedAt);
      remaining = Math.max(0, s.energyKwh - delivered);
      const stale = !session.plannedAt || now.getTime() - session.plannedAt > config.replanMinutes * 60_000;
      if ((!session.plan || stale) && remaining > 0.1) {
        session.plan = await makePlan(s, now, { energyKwh: remaining });
        session.plannedAt = now.getTime();
        store.state(id).lastPlan = { madeAt: now.toISOString(), sent: true, summary: summarize(session.plan) };
        log(`${id}: ${summarize(session.plan)}`);
      }
      wantNow = session.plan ? inPlannedSlot(session.plan, now) : false;
    }

    // A charge Monta holds for its own schedule ("busy-scheduled") would start on Monta's timing, not ours.
    if (active && !active.running && s.smart) {
      cancelledAt = cancelledAt.filter((at) => now.getTime() - at < 30 * 60_000);
      if (cancelledAt.length >= 2) {
        // It came back twice: Monta's own smart charging is on. Fighting it every minute helps nobody.
        if (!st.montaScheduling) log(`${id}: Monta keeps scheduling its own charges; turn off smart charging in the Monta app`);
        st.montaScheduling = true;
        return;
      }
      try {
        await montaStopCharge(t, active.id);
        cancelledAt.push(now.getTime());
        log(`${id}: cancelled Monta's own scheduled charge ${active.id}`);
      } catch (err) {
        // Monta would not cancel it. Say so, and carry on with the plan rather than stopping here.
        st.montaScheduling = true;
        log(`${id}: could not cancel Monta's scheduled charge ${active.id} (${active.state}): ${(err as Error).message}`);
      }
    } else st.montaScheduling = false;
    // A charge we did not start, running more than a few minutes after the cable went in, was started by a
    // person (the Monta app, an RFID tag). That is a wish to charge now: leave it alone until the cable comes out.
    // One right after plug-in is the charger starting by itself, which the plan overrules.
    const theirs = running && active && !session.ours.has(active.id);
    if (theirs && now.getTime() - session.pluggedAt.getTime() > 3 * 60_000) {
      if (!st.manualCharge) log(`${id}: charge ${active!.id} was started by hand; leaving it running`);
      st.manualCharge = true;
      return;
    }
    st.manualCharge = false;
    const action = decide({ pluggedIn: true, charging: running, smart: s.smart, remainingKwh: remaining, wantNow });
    if (action === "none") return;
    const why = !s.smart ? "charge now" : action === "start" ? "planned quarter-hour" : remaining <= 0.1 ? "enough energy" : "outside the plan";
    try {
      if (action === "start") {
        const started = await montaStartCharge(t, keys.chargePointId);
        if (started !== undefined) session.ours.add(started);
      }
      else await montaStopCharge(t, active!.id);
      st.lastAction = { at: now.toISOString(), action, ok: true, why };
      st.charging = action === "start";
      log(`${id}: ${action} (${why})`);
    } catch (err) {
      st.lastAction = { at: now.toISOString(), action, ok: false, why };
      log(`${id}: ${action} failed: ${(err as Error).message}`);
    }
  } catch (err) {
    if (err instanceof MontaError && err.kind === "bad_keys") token = undefined;
    status.set(id, { ...(status.get(id) ?? { pluggedIn: false, charging: false }), error: (err as Error).message });
    log(`${id}: check failed: ${(err as Error).message}`);
  }
}

/** Checks every minute. Returns a stop function. */
export function startMontaScheduler(): () => void {
  const timer = setInterval(() => void montaCheck(), 60_000);
  timer.unref();
  void montaCheck();
  return () => clearInterval(timer);
}

/** Test seam. */
export function resetMonta(): void {
  status.clear();
  session = undefined;
  token = undefined;
  cancelledAt = [];
}

/** The planned windows of the current session, for the front page and Claude. */
export function montaPlan(): Plan | undefined {
  return session?.plan;
}
