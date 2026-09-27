// The two forecasts a charging plan needs, from Energi Data Service: day-ahead
// spot prices (DayAheadPrices, 15-minute) and the CO2 prognosis (CO2EmisProg,
// 5-minute). Both are published in the afternoon for the next day, so a plan
// made after about 15:00 can see until midnight tomorrow.
//
// The API rate-limits per dataset and expects about one call per update
// interval, so reads are cached and concurrent identical reads are shared.
// The full query client with its catalogue lives in energimcp; this one only
// knows these two datasets.
import { config } from "./config.ts";

export type PriceArea = "DK1" | "DK2";

export class EdsError extends Error {
  readonly status: number;

  constructor(status: number, body: string) {
    super(`Energi Data Service returned ${status}: ${body.slice(0, 200)}`);
    this.status = status;
  }
}

export interface PriceSlot {
  /** Start of the 15-minute period. */
  start: Date;
  /** Spot price in DKK/kWh, excluding tariffs, taxes and VAT. */
  spotDkkPerKwh: number;
}

export interface Co2Point {
  start: Date;
  gPerKwh: number;
}

const TTL_MS = 5 * 60_000;
const cache = new Map<string, { expires: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

async function getRecords(dataset: string, params: Record<string, string>): Promise<Record<string, unknown>[]> {
  const url = `${config.edsApiBase}/dataset/${dataset}?${new URLSearchParams(params)}`;
  const hit = cache.get(url);
  if (hit && hit.expires > Date.now()) return hit.value as Record<string, unknown>[];
  const pending = inflight.get(url);
  if (pending) return pending as Promise<Record<string, unknown>[]>;

  const task = (async () => {
    const res = await fetch(url, {
      headers: { accept: "application/json", "user-agent": config.userAgent },
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    });
    const text = await res.text();
    if (!res.ok) throw new EdsError(res.status, text);
    const records = (JSON.parse(text) as { records?: Record<string, unknown>[] }).records ?? [];
    cache.set(url, { expires: Date.now() + TTL_MS, value: records });
    return records;
  })().finally(() => inflight.delete(url));

  inflight.set(url, task);
  return task;
}

// The *UTC columns come without a zone suffix; read them as UTC, not local time.
const utc = (value: unknown) => new Date(`${String(value)}Z`);

export const eds = {
  /** Spot prices from an hour ago until the end of what has been published. */
  async prices(area: PriceArea): Promise<PriceSlot[]> {
    const rows = await getRecords("DayAheadPrices", {
      start: "now-PT1H",
      end: "now+P2D",
      filter: JSON.stringify({ PriceArea: [area] }),
      columns: "TimeUTC,DayAheadPriceDKK",
      sort: "TimeUTC asc",
    });
    return rows
      .filter((r) => typeof r.DayAheadPriceDKK === "number")
      .map((r) => ({ start: utc(r.TimeUTC), spotDkkPerKwh: (r.DayAheadPriceDKK as number) / 1000 }));
  },

  /** CO2 prognosis in g/kWh, 5-minute points, for the same window. */
  async co2(area: PriceArea): Promise<Co2Point[]> {
    const rows = await getRecords("CO2EmisProg", {
      start: "now-PT1H",
      end: "now+P2D",
      filter: JSON.stringify({ PriceArea: [area] }),
      columns: "Minutes5UTC,CO2Emission",
      sort: "Minutes5UTC asc",
    });
    return rows
      .filter((r) => typeof r.CO2Emission === "number")
      .map((r) => ({ start: utc(r.Minutes5UTC), gPerKwh: r.CO2Emission as number }));
  },

  clearCache(): void {
    cache.clear();
  },
};
