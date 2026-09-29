// Monta's public API, for chargers that stay in Monta instead of dialling in
// over OCPP. The owner makes an application in the Monta portal and pastes its
// client id and secret on /connect; from those we get an access token (valid
// an hour) and the charge points on the account, including whether a cable is
// plugged in. https://docs.public-api.monta.com/reference/home
import { config } from "./config.ts";

const BASE = (process.env.MONTA_API_BASE ?? "https://public-api.monta.com/api/v1").replace(/\/+$/, "");

export class MontaError extends Error {
  readonly kind: "bad_keys" | "unreachable";
  constructor(kind: "bad_keys" | "unreachable", message: string) {
    super(message);
    this.kind = kind;
  }
}

export interface MontaChargePoint {
  id: number;
  name: string;
  state: string;
  cablePluggedIn: boolean;
  maxKw?: number;
}

async function call(path: string, init: RequestInit & { token?: string } = {}): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": config.userAgent,
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      },
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    });
  } catch (err) {
    throw new MontaError("unreachable", `Monta did not answer: ${(err as Error).message}`);
  }
  if (res.status === 400 || res.status === 401 || res.status === 403) throw new MontaError("bad_keys", `Monta refused the keys (${res.status})`);
  if (!res.ok) throw new MontaError("unreachable", `Monta answered ${res.status} to ${init.method ?? "GET"} ${path.split("?")[0]}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  // Monta's ids can be larger than a JavaScript number holds exactly (892753960160181xxx), and a rounded id
  // is a different charge. Keep any integer that does not fit as the text Monta sent.
  return JSON.parse(await res.text(), (_key, value, ctx?: { source?: string }) =>
    typeof value === "number" && !Number.isSafeInteger(value) && ctx?.source && /^-?\d+$/.test(ctx.source) ? ctx.source : value,
  );
}

export async function montaToken(clientId: string, clientSecret: string): Promise<string> {
  const d = (await call("/auth/token", { method: "POST", body: JSON.stringify({ clientId, clientSecret }) })) as { accessToken?: string };
  if (!d.accessToken) throw new MontaError("bad_keys", "Monta gave no access token");
  return d.accessToken;
}

let cached: { at: number; key: string; points: MontaChargePoint[] } | undefined;

/** The account's charge points, fetched at most once a minute per key, for pages that poll. */
export async function montaChargePointsCached(clientId: string, clientSecret: string): Promise<MontaChargePoint[]> {
  const key = `${clientId}:${clientSecret}`;
  if (cached && cached.key === key && Date.now() - cached.at < 60_000) return cached.points;
  const points = await montaChargePoints(await montaToken(clientId, clientSecret));
  cached = { at: Date.now(), key, points };
  return points;
}

export async function montaChargePoints(token: string): Promise<MontaChargePoint[]> {
  const d = (await call("/charge-points?page=0&perPage=100", { token })) as { data?: Record<string, unknown>[] };
  return (d.data ?? []).map((c) => ({
    id: Number(c.id),
    name: String(c.name ?? `Monta ${c.id}`),
    state: String(c.state ?? "unknown"),
    cablePluggedIn: Boolean(c.cablePluggedIn),
    ...(typeof c.maxKw === "number" ? { maxKw: c.maxKw } : {}),
  }));
}

export async function montaChargePoint(token: string, id: number): Promise<MontaChargePoint> {
  const c = (await call(`/charge-points/${id}`, { token })) as Record<string, unknown>;
  return {
    id: Number(c.id),
    name: String(c.name ?? `Monta ${c.id}`),
    state: String(c.state ?? "unknown"),
    cablePluggedIn: Boolean(c.cablePluggedIn),
    ...(typeof c.maxKw === "number" ? { maxKw: c.maxKw } : {}),
  };
}

interface MontaCharge {
  /** A number, or the exact digits as text when it is too large for one. */
  id: number | string;
  state: string;
  chargePointId?: number;
  startedAt?: string;
  createdAt?: string;
  consumedKwh?: number;
}

async function recentCharges(token: string, chargePointId: number): Promise<MontaCharge[]> {
  const d = (await call(`/charges?chargePointId=${chargePointId}&page=0&perPage=20`, { token })) as { data?: MontaCharge[] };
  return (d.data ?? []).filter((c) => c.chargePointId === undefined || Number(c.chargePointId) === chargePointId);
}

/** Charge states where power flows, or may at any moment. */
const RUNNING = new Set(["starting", "charging", "paused"]);
/** A charge Monta is holding for later: its own schedule, or a reservation. */
const PENDING = new Set(["scheduled", "reserved"]);

/** The charge on this charge point that is running or waiting, if any. */
export async function montaActiveCharge(token: string, chargePointId: number): Promise<(MontaCharge & { running: boolean }) | undefined> {
  const c = (await recentCharges(token, chargePointId)).find((x) => RUNNING.has(x.state) || PENDING.has(x.state));
  return c && { ...c, running: RUNNING.has(c.state) };
}

/** kWh delivered on this charge point since a moment, for how much a plan still has to find. */
export async function montaChargesSince(token: string, chargePointId: number, since: Date): Promise<number> {
  return (await recentCharges(token, chargePointId))
    .filter((c) => new Date(c.startedAt ?? c.createdAt ?? 0).getTime() >= since.getTime() - 60_000)
    .reduce((sum, c) => sum + (c.consumedKwh ?? 0), 0);
}

/** Starts a charge and returns its id. */
export async function montaStartCharge(token: string, chargePointId: number): Promise<string | undefined> {
  const d = (await call("/charges", { method: "POST", token, body: JSON.stringify({ chargePointId }) })) as { id?: number | string };
  return d.id === undefined ? undefined : String(d.id);
}

export async function montaStopCharge(token: string, chargeId: number | string): Promise<void> {
  await call(`/charges/${chargeId}/stop`, { method: "POST", token });
}
