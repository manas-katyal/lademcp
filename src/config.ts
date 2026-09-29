// Two kinds of client talk to this server: chargers over OCPP 1.6J (a
// WebSocket at /ocpp/<charge point id>) and assistants over MCP. Both reach
// into the same household's charger, so unlike energimcp there are secrets
// here: a password chargers present, and a bearer token for the hosted MCP
// endpoint. Everything else has a working default.
import { accessSync, constants, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const env = process.env;
// Local mode: launched by an MCP client over stdio on the user's own machine.
// The OCPP listener still runs, on its own port, because the charger has to
// reach something.
const localMode = env.LADEMCP_LOCAL === "1";
const port = Number(env.PORT ?? (localMode ? 9180 : 8080));

function detectBaseUrl(): string {
  if (env.BASE_URL) return env.BASE_URL.replace(/\/+$/, "");
  if (env.RAILWAY_PUBLIC_DOMAIN) return `https://${env.RAILWAY_PUBLIC_DOMAIN}`;
  if (env.FLY_APP_NAME) return `https://${env.FLY_APP_NAME}.fly.dev`;
  if (env.RENDER_EXTERNAL_URL) return env.RENDER_EXTERNAL_URL.replace(/\/+$/, "");
  return `http://localhost:${port}`;
}

/**
 * The household's grid tariff (nettarif) per hour of the day in DKK/kWh,
 * as 24 comma-separated numbers starting at 00:00. It varies by grid company
 * and season, and the 17–21 peak can outweigh the spot price, so there is no
 * made-up default: without it, plans are made on the spot price alone and
 * every plan says so.
 */
function parseTariff(raw: string | undefined): number[] | undefined {
  if (!raw?.trim()) return undefined;
  const values = raw.split(",").map((v) => Number(v.trim()));
  if (values.length !== 24 || values.some((v) => !Number.isFinite(v))) return undefined;
  return values;
}

export const config = {
  localMode,
  port,
  baseUrl: detectBaseUrl(),
  appName: env.APP_NAME ?? "LadeMCP",
  dataDir: env.DATA_DIR ?? (localMode ? join(homedir(), ".lademcp") : "./data"),
  edsApiBase: (env.EDS_API_BASE ?? "https://api.energidataservice.dk").replace(/\/+$/, ""),
  /** DK1 is west of the Great Belt, DK2 east. Chargers can override it. */
  defaultPriceArea: (env.PRICE_AREA === "DK2" ? "DK2" : "DK1") as "DK1" | "DK2",
  tariffDkkPerKwh: parseTariff(env.NETTARIF_DKK_PER_KWH),
  tariffRaw: env.NETTARIF_DKK_PER_KWH,
  /** Shared OCPP password (security profile 1: HTTP Basic, user = charge point id). Unset, setup.ts makes one. */
  ocppPassword: env.OCPP_PASSWORD,
  /** Bearer token for POST /mcp on a hosted deployment. Unset, setup.ts makes one. The stdio entry point needs none. */
  mcpToken: env.MCP_BEARER_TOKEN,
  /** How long to wait for a charger to answer a call before giving up. OCPP-J suggests tens of seconds. */
  ocppCallTimeoutMs: Number(env.OCPP_CALL_TIMEOUT_MS ?? 30_000),
  heartbeatSeconds: Number(env.OCPP_HEARTBEAT_SECONDS ?? 300),
  /** Prices only change once a day, so re-planning on a timer mostly picks up the CO2 forecast's intraday updates. */
  replanMinutes: Number(env.REPLAN_MINUTES ?? 30),
  requestTimeoutMs: Number(env.REQUEST_TIMEOUT_MS ?? 30_000),
  userAgent: env.USER_AGENT ?? "LadeMCP (+https://github.com/manas-katyal/lademcp)",
};

export const isLocalUrl = (url: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(url);

/** What is stopping the server from working safely. */
export function setupProblems(): string[] {
  const problems: string[] = [];
  if (config.tariffRaw && !config.tariffDkkPerKwh) {
    problems.push("NETTARIF_DKK_PER_KWH must be 24 comma-separated numbers (DKK/kWh for 00:00 to 23:00); it is ignored");
  }
  if (!config.tariffDkkPerKwh) {
    problems.push("No NETTARIF_DKK_PER_KWH set, so charging is planned on the spot price alone; the 17–21 peak tariff is not accounted for");
  }
  try {
    mkdirSync(config.dataDir, { recursive: true });
    accessSync(config.dataDir, constants.W_OK);
  } catch {
    problems.push(`DATA_DIR ${config.dataDir} is not writable, so charger settings are lost on restart`);
  }
  return problems;
}
