// JSON for the web page: a charging plan for settings the visitor picks, with
// no charger involved. Read-only and cheap, since prices and CO2 are cached
// per price area, so it needs no token. Text is left to the page, which
// formats numbers and times in the visitor's language; warnings are codes.
import type { Request, Response } from "express";
import { z } from "zod";
import { config } from "./config.ts";
import { EdsError } from "./eds.ts";
import { round2 } from "./planner.ts";
import { makePlan, nextReadyBy } from "./smart.ts";
import { isConnected } from "./ocpp.ts";
import { defaults, store } from "./store.ts";
import { setup } from "./setup.ts";

const query = z.object({
  ready_by: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("07:00"),
  energy_kwh: z.coerce.number().min(1).max(150).default(30),
  green_weight: z.coerce.number().min(0).max(1).default(0),
  max_amps: z.coerce.number().int().min(6).max(32).default(16),
  phases: z.coerce.number().pipe(z.union([z.literal(1), z.literal(3)])).default(3),
  price_area: z.enum(["DK1", "DK2"]).optional(),
});

export async function planHandler(req: Request, res: Response): Promise<void> {
  const parsed = query.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "bad_request", issues: parsed.error.issues.map((i) => i.path.join(".")) });
    return;
  }
  const q = parsed.data;
  const s = { ...defaults("preview"), readyBy: q.ready_by, energyKwh: q.energy_kwh, greenWeight: q.green_weight, maxAmps: q.max_amps, phases: q.phases, priceArea: q.price_area ?? setup.priceArea() };
  const now = new Date();
  try {
    const p = await makePlan(s, now);
    const on = new Set(p.chosen.map((x) => x.start.getTime()));
    const warnings: string[] = [];
    if (p.readyBy.getTime() < nextReadyBy(q.ready_by, now).getTime()) warnings.push("prices_end");
    if (p.totals.energyKwh < q.energy_kwh - 0.01) warnings.push("short");
    if (q.green_weight > 0 && p.slots.some((x) => x.co2GPerKwh === undefined)) warnings.push("co2_partial");
    res.set("Cache-Control", "no-store").json({
      ready_by: p.readyBy.toISOString(),
      slots: p.slots.map((x) => ({
        start: x.start.toISOString(),
        cost: round2(x.spotDkkPerKwh + x.tariffDkkPerKwh),
        ...(x.co2GPerKwh !== undefined ? { co2: Math.round(x.co2GPerKwh) } : {}),
        on: on.has(x.start.getTime()),
      })),
      plan: p.totals,
      charge_now: p.chargeNow,
      cheapest: p.cheapest,
      ...(p.greenest ? { greenest: p.greenest } : {}),
      tariff: Boolean(config.tariffDkkPerKwh),
      warnings,
    });
  } catch (err) {
    const limited = err instanceof EdsError && err.status === 429;
    res.status(limited ? 503 : 502).json({ error: limited ? "rate_limited" : "upstream" });
  }
}

/**
 * Whether a charger with this id has dialled in, for the onboarding page to
 * poll. Only answers for an id the caller already knows (the serial number),
 * and only with what the charger announced about itself and its plan settings.
 */
export function chargerHandler(req: Request, res: Response): void {
  const id = String(req.params.id ?? "");
  if (!/^[A-Za-z0-9._-]{3,64}$/.test(id)) {
    res.status(400).json({ error: "bad_request" });
    return;
  }
  const s = store.get(id);
  res.set("Cache-Control", "no-store");
  if (!s) {
    res.json({ connected: false });
    return;
  }
  const st = store.state(id);
  res.json({
    connected: isConnected(id),
    ...(st.vendor ? { vendor: st.vendor, model: st.model } : {}),
    ready_by: s.readyBy,
    energy_kwh: s.energyKwh,
  });
}
