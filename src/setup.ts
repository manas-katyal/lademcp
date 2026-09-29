// First-run setup for a self-hosted server. Whoever deploys LadeMCP should
// not have to invent secrets or edit environment variables: the server makes
// its own charger password and MCP token on first start and keeps them in
// DATA_DIR. The owner proves they run the server with a one-time code printed
// in its log, and from then on a signed cookie marks their browser. Until the
// owner has chosen a price area, connected a charger and added the server to
// their assistant, the pages send them to /setup.
//
// OCPP_PASSWORD and MCP_BEARER_TOKEN still win when set, so an existing
// deployment keeps the secrets its chargers and assistants already use.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config, isLocalUrl } from "./config.ts";
import type { PriceArea } from "./eds.ts";

interface SetupFile {
  /** Signs the owner cookie. */
  ownerKey: string;
  ocppPassword: string;
  mcpToken: string;
  claimedAt?: string;
  priceArea?: PriceArea;
  /** When an assistant first called /mcp with the token, or "skipped". */
  assistant?: string;
  doneAt?: string;
}

export const OWNER_COOKIE = "lade_owner";
const MAX_WRONG_CODES = 30;

const file = () => join(config.dataDir, "setup.json");
const secret = (bytes: number) => randomBytes(bytes).toString("base64url");
let data: SetupFile | undefined;
let claimCode: string | undefined;
let wrongCodes = 0;

function load(): SetupFile {
  if (data) return data;
  try {
    data = JSON.parse(readFileSync(file(), "utf8")) as SetupFile;
  } catch {
    // First start: nothing on disk yet.
  }
  if (!data?.ownerKey || !data.ocppPassword || !data.mcpToken) {
    data = { ...data, ownerKey: data?.ownerKey || secret(32), ocppPassword: data?.ocppPassword || secret(18), mcpToken: data?.mcpToken || secret(32) };
    save();
  }
  return data;
}

function save(): void {
  try {
    mkdirSync(config.dataDir, { recursive: true });
    const tmp = `${file()}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    renameSync(tmp, file());
  } catch (err) {
    console.error(`[lade] could not save setup: ${(err as Error).message}`);
  }
}

function update(patch: Partial<SetupFile>): void {
  data = { ...load(), ...patch };
  save();
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const ownerValue = () => createHmac("sha256", load().ownerKey).update("owner-v1").digest("base64url");

// The socket's own peer, not req.ip: with "trust proxy" req.ip comes from X-Forwarded-For, which anyone can send.
const fromLoopback = (addr: string | undefined) => addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";

type Req = { headers: { cookie?: string }; socket: { remoteAddress?: string } };

export const setup = {
  /** The password chargers present (HTTP Basic, user = charger id). */
  ocppPassword: (): string => config.ocppPassword || load().ocppPassword,
  /** The token assistants present on /mcp. */
  mcpToken: (): string => config.mcpToken || load().mcpToken,
  priceArea: (): PriceArea => load().priceArea ?? config.defaultPriceArea,

  /** The owner's browser, or anyone on this machine when the server only runs locally. */
  isOwner(req: Req): boolean {
    if (isLocalUrl(config.baseUrl) && fromLoopback(req.socket.remoteAddress)) return true;
    const got = String(req.headers.cookie ?? "").split(/;\s*/).find((c) => c.startsWith(`${OWNER_COOKIE}=`))?.slice(OWNER_COOKIE.length + 1);
    return Boolean(got && load().claimedAt && same(got, ownerValue()));
  },

  ownerCookie(): string {
    const secure = config.baseUrl.startsWith("https:") ? "; Secure" : "";
    return `${OWNER_COOKIE}=${ownerValue()}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure}`;
  },

  /** The one-time code for the log. Undefined once the server is claimed. */
  claimCode(): string | undefined {
    if (load().claimedAt) return undefined;
    claimCode ??= randomBytes(5).toString("hex").toUpperCase();
    return claimCode;
  },

  /** Checks the code from the log. Too many wrong guesses and only a restart (a new code) helps. */
  claim(code: string): "ok" | "wrong" | "locked" {
    const want = this.claimCode();
    if (!want) return "wrong";
    if (wrongCodes >= MAX_WRONG_CODES) return "locked";
    if (!same(code.trim().toUpperCase().replace(/[\s-]/g, ""), want)) {
      wrongCodes++;
      return "wrong";
    }
    update({ claimedAt: new Date().toISOString() });
    return "ok";
  },

  setPriceArea(area: PriceArea): void {
    update({ priceArea: area });
  },

  /** Called on every authorised /mcp request; only the first one is written down. */
  assistantSeen(): void {
    if (!load().assistant) update({ assistant: new Date().toISOString() });
  },

  skipAssistant(): void {
    if (!load().assistant) update({ assistant: "skipped" });
  },

  finish(): void {
    if (!load().doneAt) update({ doneAt: new Date().toISOString() });
  },

  status() {
    const d = load();
    return { claimed: Boolean(d.claimedAt), priceArea: d.priceArea, assistant: d.assistant, done: Boolean(d.doneAt) };
  },

  /** Test seam: forget everything in memory and on disk. */
  reset(): void {
    data = undefined;
    claimCode = undefined;
    wrongCodes = 0;
    try {
      writeFileSync(file(), "{}");
    } catch {}
  },
};
