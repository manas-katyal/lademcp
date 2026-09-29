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
  if (!res.ok) throw new MontaError("unreachable", `Monta answered ${res.status}`);
  return res.json();
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
