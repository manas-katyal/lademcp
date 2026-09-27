// What the server knows about each charger: the household's settings (kept on
// disk) and what the charger last told us (kept in memory, refreshed on every
// reconnect). One JSON file is plenty for a household or a pilot; a fleet
// would want a database.
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.ts";
import type { PriceArea } from "./eds.ts";

export interface ChargerSettings {
  id: string;
  label?: string;
  /** When on, the server plans and sends a schedule whenever a car is plugged in. */
  smart: boolean;
  priceArea: PriceArea;
  /** Danish local time the car has to be ready, HH:MM. The next occurrence counts. */
  readyBy: string;
  /** How much to put in the battery per session. Without the car's own state of charge this is the user's guess. */
  energyKwh: number;
  maxAmps: number;
  phases: 1 | 3;
  /** Zaptec and most home chargers want amps; some only take watts. */
  unit: "A" | "W";
  /** 0 = cheapest, 1 = greenest. */
  greenWeight: number;
}

export interface ChargerState {
  connected: boolean;
  lastSeen?: string;
  vendor?: string;
  model?: string;
  firmware?: string;
  /** Status per connector id, as the charger last reported it (Available, Preparing, Charging, SuspendedEV, …). */
  status: Record<number, string>;
  transactionId?: number;
  meterWh?: number;
  lastPlan?: {
    madeAt: string;
    sent: boolean;
    summary: string;
  };
}

export const defaults = (id: string): ChargerSettings => ({
  id,
  smart: true,
  priceArea: config.defaultPriceArea,
  readyBy: "07:00",
  energyKwh: 30,
  maxAmps: 16,
  phases: 3,
  unit: "A",
  greenWeight: 0,
});

const file = () => join(config.dataDir, "chargers.json");
let settings: Map<string, ChargerSettings> | undefined;
const state = new Map<string, ChargerState>();

function load(): Map<string, ChargerSettings> {
  if (settings) return settings;
  settings = new Map();
  try {
    for (const s of JSON.parse(readFileSync(file(), "utf8")) as ChargerSettings[]) settings.set(s.id, { ...defaults(s.id), ...s });
  } catch {
    // No file yet, or unreadable: start empty. Chargers re-register on boot.
  }
  return settings;
}

function save(): void {
  try {
    // Write-then-rename so a crash mid-write never leaves half a file.
    const tmp = `${file()}.tmp`;
    writeFileSync(tmp, JSON.stringify([...load().values()], null, 2));
    renameSync(tmp, file());
  } catch (err) {
    console.error(`[lade] could not save charger settings: ${(err as Error).message}`);
  }
}

export const store = {
  list(): ChargerSettings[] {
    return [...load().values()];
  },

  get(id: string): ChargerSettings | undefined {
    return load().get(id);
  },

  /** Registers a charger the first time it connects, with default settings. */
  ensure(id: string): ChargerSettings {
    const all = load();
    let s = all.get(id);
    if (!s) {
      s = defaults(id);
      all.set(id, s);
      save();
    }
    return s;
  },

  update(id: string, patch: Partial<Omit<ChargerSettings, "id">>): ChargerSettings {
    const next = { ...this.ensure(id), ...patch, id };
    load().set(id, next);
    save();
    return next;
  },

  state(id: string): ChargerState {
    let s = state.get(id);
    if (!s) {
      s = { connected: false, status: {} };
      state.set(id, s);
    }
    return s;
  },

  /** Test seam. */
  reset(): void {
    settings = new Map();
    state.clear();
  },
};

export const maxKw = (s: ChargerSettings) => (s.maxAmps * 230 * s.phases) / 1000;
