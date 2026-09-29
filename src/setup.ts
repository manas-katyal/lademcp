// First-run setup for a self-hosted server. Whoever deploys LadeMCP should
// not have to invent secrets or edit environment variables: the server makes
// its own charger password and MCP token on first start and keeps them in
// DATA_DIR. Like Home Assistant, the first person to open /setup becomes the
// owner by choosing a password; a signed cookie marks their browser, and the
// password lets them in from another device. Until the owner has chosen a
// price area, connected a charger and added the server to their assistant,
// the pages send them to /setup.
//
// OCPP_PASSWORD and MCP_BEARER_TOKEN still win when set, so an existing
// deployment keeps the secrets its chargers and assistants already use.
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
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
  /** scrypt of the owner's password, "salt:hash". Missing on servers claimed before passwords. */
  ownerHash?: string;
  priceArea?: PriceArea;
  /** When an assistant first called /mcp with the token, or "skipped". */
  assistant?: string;
  doneAt?: string;
}

export const OWNER_COOKIE = "lade_owner";
export const MIN_PASSWORD = 8;
/** Wrong passwords allowed per quarter of an hour before logins pause. */
const MAX_WRONG = 10;
const WRONG_WINDOW_MS = 15 * 60_000;

const file = () => join(config.dataDir, "setup.json");
const secret = (bytes: number) => randomBytes(bytes).toString("base64url");
let data: SetupFile | undefined;
let wrong: number[] = [];

const hash = (password: string, salt = randomBytes(16).toString("base64url")) => `${salt}:${scryptSync(password, salt, 32).toString("base64url")}`;

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

// Tied to the password hash, so changing the password signs out other browsers. A server claimed
// before there were passwords keeps the old value until the owner picks one.
const ownerValue = () => {
  const h = load().ownerHash;
  return createHmac("sha256", load().ownerKey).update(h ? `owner-v1:${h}` : "owner-v1").digest("base64url");
};

function throttled(): boolean {
  const now = Date.now();
  wrong = wrong.filter((t) => now - t < WRONG_WINDOW_MS);
  return wrong.length >= MAX_WRONG;
}

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

  /** The first visitor becomes the owner by choosing a password. */
  claim(password: string): "ok" | "taken" | "short" {
    if (load().claimedAt) return "taken";
    if (password.length < MIN_PASSWORD) return "short";
    update({ claimedAt: new Date().toISOString(), ownerHash: hash(password) });
    return "ok";
  },

  /** The owner on another device. */
  login(password: string): "ok" | "wrong" | "throttled" {
    const stored = load().ownerHash;
    if (throttled()) return "throttled";
    const [salt] = (stored ?? "").split(":");
    if (!stored || !same(hash(password, salt), stored)) {
      wrong.push(Date.now());
      return "wrong";
    }
    return "ok";
  },

  /** For the owner of a server claimed before there were passwords, or to change it. */
  setPassword(password: string): "ok" | "short" {
    if (password.length < MIN_PASSWORD) return "short";
    update({ ownerHash: hash(password) });
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
    return { claimed: Boolean(d.claimedAt), hasPassword: Boolean(d.ownerHash), priceArea: d.priceArea, assistant: d.assistant, done: Boolean(d.doneAt) };
  },

  /** Test seam: read setup.json again. */
  reload(): void {
    data = undefined;
  },

  /** Test seam: forget everything in memory and on disk. */
  reset(): void {
    data = undefined;
    wrong = [];
    try {
      writeFileSync(file(), "{}");
    } catch {}
  },
};
