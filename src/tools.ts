import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config } from "./config.ts";
import { EdsError } from "./eds.ts";
import { OcppError, isConnected, OCPP_PATH } from "./ocpp.ts";
import { SLOT_MINUTES, round2, type Plan, type PlanTotals, type Slot } from "./planner.ts";
import { applyPlan, clearPlan, danishTime, makePlan, summarize } from "./smart.ts";
import { maxKw, store, type ChargerSettings } from "./store.ts";

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

class ToolError extends Error {}

function guard<A extends unknown[]>(fn: (...args: A) => Promise<ReturnType<typeof json> | ReturnType<typeof fail>>) {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof ToolError) return fail(err.message);
      if (err instanceof OcppError && err.code === "NotConnected") {
        return fail(`${err.message}. It has to be online and pointed at ${ocppUrl("<id>")}; call connection_guide for how to set that up per brand.`);
      }
      if (err instanceof OcppError && err.code === "Timeout") return fail(`${err.message}. It may be offline or busy; try again in a minute.`);
      if (err instanceof OcppError) return fail(`The charger refused: ${err.message}`);
      if (err instanceof EdsError && err.status === 429) {
        return fail("Energi Data Service rate-limited the price lookup. Prices are cached for five minutes; wait and ask again rather than retrying now.");
      }
      if (err instanceof EdsError) return fail(err.message);
      return fail(`Error: ${(err as Error).message}`);
    }
  };
}

export const ocppUrl = (id: string) => `${config.baseUrl.replace(/^http/, "ws")}${OCPP_PATH}${id}`;

function charger(id: string): ChargerSettings {
  const s = store.get(id);
  if (!s) {
    const known = store.list().map((c) => c.id);
    throw new ToolError(`No charger with id ${id}. ${known.length ? `Known chargers: ${known.join(", ")}.` : "No charger has connected yet; call connection_guide."}`);
  }
  return s;
}

/** Consecutive chosen quarter-hours as windows a person can read. */
function windows(chosen: Slot[]) {
  const out: { from: string; to: string; avg_cost_dkk_per_kwh: number; avg_co2_g_per_kwh?: number }[] = [];
  let run: Slot[] = [];
  const flush = () => {
    if (!run.length) return;
    const co2 = run.map((s) => s.co2GPerKwh).filter((v): v is number => v !== undefined);
    out.push({
      from: danishTime(run[0]!.start),
      to: danishTime(new Date(run.at(-1)!.start.getTime() + SLOT_MINUTES * 60_000)),
      avg_cost_dkk_per_kwh: round2(run.reduce((a, s) => a + s.spotDkkPerKwh + s.tariffDkkPerKwh, 0) / run.length),
      ...(co2.length === run.length ? { avg_co2_g_per_kwh: Math.round(co2.reduce((a, b) => a + b, 0) / co2.length) } : {}),
    });
    run = [];
  };
  for (const slot of chosen) {
    const prev = run.at(-1);
    if (prev && slot.start.getTime() - prev.start.getTime() !== SLOT_MINUTES * 60_000) flush();
    run.push(slot);
  }
  flush();
  return out;
}

const compare = (label: string, t: PlanTotals, plan: PlanTotals) => ({
  strategy: label,
  cost_dkk: t.costDkk,
  ...(t.co2Kg !== undefined ? { co2_kg: t.co2Kg } : {}),
  extra_cost_vs_plan_dkk: round2(t.costDkk - plan.costDkk),
  ...(t.co2Kg !== undefined && plan.co2Kg !== undefined ? { extra_co2_vs_plan_kg: round2(t.co2Kg - plan.co2Kg) } : {}),
});

function planView(p: Plan, s: ChargerSettings) {
  return {
    summary: summarize(p),
    ready_by: danishTime(p.readyBy),
    charge_in: windows(p.chosen),
    totals: { energy_kwh: p.totals.energyKwh, cost_dkk: p.totals.costDkk, ...(p.totals.co2Kg !== undefined ? { co2_kg: p.totals.co2Kg } : {}) },
    compared_with: [
      compare("charge right away", p.chargeNow, p.totals),
      compare("cheapest", p.cheapest, p.totals),
      ...(p.greenest ? [compare("greenest", p.greenest, p.totals)] : []),
    ],
    settings_used: { green_weight: s.greenWeight, energy_kwh: s.energyKwh, max_kw: round2(maxKw(s)), price_area: s.priceArea },
    cost_basis: config.tariffDkkPerKwh
      ? "Spot price plus the configured grid tariff (nettarif), DKK/kWh. Elafgift, Energinet tariffs and VAT come on top and do not change which hours are best."
      : "Spot price only. No grid tariff is configured, so the 17–21 peak nettarif is not accounted for, and real bills are higher.",
    ...(p.warnings.length ? { warnings: p.warnings } : {}),
    sources: [
      "Energinet, Energi Data Service, DayAheadPrices: https://www.energidataservice.dk/tso-electricity/DayAheadPrices",
      "Energinet, Energi Data Service, CO2EmisProg: https://www.energidataservice.dk/tso-electricity/CO2EmisProg",
    ],
  };
}

const settingsShape = {
  label: z.string().max(60).optional().describe("A name the household recognises, e.g. 'Carport'"),
  ready_by: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().describe("Danish local time the car has to be ready, HH:MM, e.g. 07:00"),
  energy_kwh: z.number().min(1).max(150).optional().describe("How much to charge per session. Without the car's state of charge, this is the user's estimate"),
  green_weight: z.number().min(0).max(1).optional().describe("0 = cheapest hours, 1 = lowest-CO2 hours, in between blends the two"),
  max_amps: z.number().int().min(6).max(32).optional().describe("Current per phase the charger may draw (the fuse and installation decide this)"),
  phases: z.union([z.literal(1), z.literal(3)]).optional(),
  unit: z.enum(["A", "W"]).optional().describe("Unit for the charging schedule. Most home chargers want A"),
  price_area: z.enum(["DK1", "DK2"]).optional().describe("DK1 is west of the Great Belt (Jutland, Funen), DK2 east (Zealand, Bornholm)"),
};

type SettingsInput = { [K in keyof typeof settingsShape]?: z.infer<(typeof settingsShape)[K]> };

function toPatch(input: SettingsInput): Partial<ChargerSettings> {
  const patch: Partial<ChargerSettings> = {};
  if (input.label !== undefined) patch.label = input.label;
  if (input.ready_by !== undefined) patch.readyBy = input.ready_by;
  if (input.energy_kwh !== undefined) patch.energyKwh = input.energy_kwh;
  if (input.green_weight !== undefined) patch.greenWeight = input.green_weight;
  if (input.max_amps !== undefined) patch.maxAmps = input.max_amps;
  if (input.phases !== undefined) patch.phases = input.phases;
  if (input.unit !== undefined) patch.unit = input.unit;
  if (input.price_area !== undefined) patch.priceArea = input.price_area;
  return patch;
}

export function registerTools(server: McpServer): void {
  server.registerTool(
    "list_chargers",
    {
      title: "List chargers",
      description: "Every charger that has connected over OCPP: whether it is online, what it reports (vendor, model, connector status), its smart-charging settings and the last plan sent to it.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guard(async () => {
      const chargers = store.list().map((s) => {
        const st = store.state(s.id);
        return {
          id: s.id,
          ...(s.label ? { label: s.label } : {}),
          online: isConnected(s.id),
          ...(st.vendor ? { vendor: st.vendor, model: st.model } : {}),
          connectors: st.status,
          smart_charging: s.smart,
          settings: { ready_by: s.readyBy, energy_kwh: s.energyKwh, green_weight: s.greenWeight, max_amps: s.maxAmps, phases: s.phases, price_area: s.priceArea },
          ...(st.lastPlan ? { last_plan: st.lastPlan } : {}),
          ...(st.meterWh !== undefined ? { meter_kwh: round2(st.meterWh / 1000) } : {}),
        };
      });
      if (!chargers.length) return json({ chargers: [], hint: "No charger has connected yet. Call connection_guide for the URL to enter in the charger's OCPP settings." });
      return json({ chargers });
    }),
  );

  server.registerTool(
    "connection_guide",
    {
      title: "How to connect a charger",
      description:
        "The OCPP URL to give a charger and where to enter it on the chargers most used in Denmark (Zaptec Go, Easee, Wallbox Pulsar, myenergi zappi), plus which ones cannot connect (Clever, Tesla Wall Connector Gen 3).",
      inputSchema: { charger_id: z.string().optional().describe("The id to use in the URL, usually the charger's serial number") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guard(async ({ charger_id }) => {
      const id = charger_id ?? "<serial number>";
      return json({
        ocpp_url: ocppUrl(id),
        protocol: "OCPP 1.6J",
        authentication: "HTTP Basic: user = the charger id, password = the charger password shown on this server's /setup page (security profile 1). A charger with no password field (EVBox Elvi) puts it in the address instead: <base>/ocpp/<password>/ and the charger adds its own id.",
        brands: [
          { brand: "Zaptec (Go, Pro)", how: "Zaptec Portal, installation owner or installer: Installation > Settings > Authentication, enable OCPP, then per charger Settings > OCPP and enter the URL. Direct OCPP turns off Zaptec's own smart features and app control; this server replaces them." },
          { brand: "Easee (Home, Charge, Lite)", how: "Direct OCPP needs firmware 344 or later (rolled out from 10 Sep 2026, beta) and Wi-Fi. It is switched on through the Easee API or an app that uses it; the charger keeps reporting to Easee Cloud in parallel." },
          { brand: "Wallbox (Pulsar Plus, Pulsar Max)", how: "myWallbox app: charger > Settings > OCPP, enable the WebSocket connection and enter the URL and charge point id. Some Wallbox app features pause while OCPP is on." },
          { brand: "myenergi zappi", how: "Only zappi with built-in Wi-Fi (serial starting with 2) on firmware 5.114 or later; charging profiles need 5.5. Set up in the myenergi app under OCPP. The myenergi app keeps working." },
          { brand: "EVBox Elvi", how: "EVBox Connect app over Bluetooth, installation mode (code that came with the charger): Charging management platform > Other backend URL. Firmware 424 or later. The URL must end with /. Only one platform at a time, so billing through Monta or an employer stops. EVBox Livo cannot connect: EVBox closed it to other platforms." },
          { brand: "Clever, Tesla Wall Connector Gen 3, leased chargers", how: "Cannot connect: Clever boxes only talk to Clever's backend, Gen 3 has no OCPP, and leased boxes are the operator's. These need the car's own API or a partnership instead." },
        ],
      });
    }),
  );

  server.registerTool(
    "preview_plan",
    {
      title: "Preview a charging plan",
      description:
        "Work out when a charger would charge, without sending anything: the chosen windows, the cost and CO2, and how that compares with charging right away, the cheapest plan and the greenest plan. Any setting can be tried out here without saving it.",
      inputSchema: { charger_id: z.string(), ...settingsShape },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async ({ charger_id, ...input }) => {
      const s = { ...charger(charger_id), ...toPatch(input) };
      return json(planView(await makePlan(s), s));
    }),
  );

  server.registerTool(
    "update_charger",
    {
      title: "Change a charger's settings",
      description: "Save when the car has to be ready, how much to charge, how green versus cheap, and the charger's electrical limits. If a car is plugged in and smart charging is on, a new plan is sent right away.",
      inputSchema: { charger_id: z.string(), ...settingsShape },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guard(async ({ charger_id, ...input }) => {
      charger(charger_id);
      const s = store.update(charger_id, toPatch(input));
      if (!s.smart || !isConnected(charger_id)) return json({ saved: s });
      const p = await makePlan(s);
      const status = await applyPlan(charger_id, p);
      return json({ saved: s, plan_sent: status, plan: planView(p, s) });
    }),
  );

  server.registerTool(
    "start_smart_charging",
    {
      title: "Start smart charging",
      description: "Turn smart charging on for a charger and send it a plan now. The charger then only charges in the chosen quarter-hours, and the plan is redone automatically as new prices and CO2 forecasts arrive.",
      inputSchema: { charger_id: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guard(async ({ charger_id }) => {
      charger(charger_id);
      const s = store.update(charger_id, { smart: true });
      const p = await makePlan(s);
      const status = await applyPlan(charger_id, p);
      if (status === "NotSupported" || status === "Rejected") {
        throw new ToolError(`The charger answered ${status} to SetChargingProfile. Smart charging stays on, but this charger or its firmware does not take charging profiles; check the firmware version in connection_guide.`);
      }
      return json({ charger_status: status, plan: planView(p, s) });
    }),
  );

  server.registerTool(
    "charge_now",
    {
      title: "Charge now at full power",
      description: "Turn smart charging off for a charger and remove the schedule, so it charges at full power straight away. Use start_smart_charging to turn it back on.",
      inputSchema: { charger_id: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guard(async ({ charger_id }) => {
      charger(charger_id);
      store.update(charger_id, { smart: false });
      const status = await clearPlan(charger_id);
      return json({ charger_status: status, smart_charging: false, note: status === "Unknown" ? "The charger had no schedule from this server." : "Charging at full power." });
    }),
  );
}
