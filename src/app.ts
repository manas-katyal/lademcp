// HTTP entry point: MCP on POST /mcp and OCPP on WebSocket /ocpp/<id>, on one
// port, because a hosted deployment usually gets one. Unlike energimcp this
// server acts on a household's charger, so /mcp needs a token unless it only
// listens on localhost: as a bearer header, or in the path (/mcp/<token>) for
// assistants like claude.ai whose custom connectors take a URL and nothing else.
// Until the owner has been through /setup, the pages lead there.
import express from "express";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config, isLocalUrl, setupProblems } from "./config.ts";
import { createServer, VERSION } from "./mcp.ts";
import { isConnected, OCPP_PATH } from "./ocpp.ts";
import { connectPage } from "./connect-page.ts";
import { homePage, LANG_COOKIE, langOf } from "./pages.ts";
import { chargerHandler, planHandler } from "./api.ts";
import { store } from "./store.ts";
import { setup } from "./setup.ts";
import { areaPage, assistantPage, donePage, ownerPage } from "./setup-page.ts";
import { MontaError, montaChargePoints, montaToken } from "./monta.ts";
import { isMonta, MONTA_PREFIX, montaStatus, replanMonta } from "./monta-control.ts";
import type { Request, Response, NextFunction } from "express";

function tokenMatches(token: string | undefined): boolean {
  const given = Buffer.from(token ?? "");
  const want = Buffer.from(setup.mcpToken());
  return given.length === want.length && timingSafeEqual(given, want);
}

/** The charger the front page is about: the one in Monta, or else the first that dialled in. */
function myCharger() {
  const monta = setup.monta();
  if (monta?.chargePointId) return store.get(`${MONTA_PREFIX}${monta.chargePointId}`) ?? store.update(`${MONTA_PREFIX}${monta.chargePointId}`, {});
  return store.list().find((c) => !isMonta(c.id));
}

const ocppBase = () => `${config.baseUrl.replace(/^http/, "ws")}${OCPP_PATH}`;
const claudeUrl = () => `${config.baseUrl}/mcp/${setup.mcpToken()}`;

function ownerOnly(req: Request, res: Response, next: NextFunction): void {
  if (setup.isOwner(req)) next();
  else res.status(403).json({ error: "not_owner" });
}

// The socket's own peer, not req.ip: with "trust proxy" req.ip comes from X-Forwarded-For, which anyone can send.
const fromLoopback = (addr: string | undefined) => addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";

export function createApp() {
  const log = (msg: string, extra?: unknown) => console.error(`[lade ${new Date().toISOString()}] ${msg}`, extra ?? "");

  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use((_req, res, next) => {
    res.set({ "X-Frame-Options": "DENY", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
    next();
  });

  const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
  app.use(express.static(publicDir, { index: false, maxAge: "1d" }));

  app.get("/healthz", (_req, res) => {
    const chargers = store.list();
    res.json({ ok: true, version: VERSION, chargers: chargers.length, online: chargers.filter((c) => isConnected(c.id)).length, problems: setupProblems() });
  });

  // The page for people; Claude uses /mcp. /api/plan only reads prices and CO2.
  app.get("/", (req, res) => {
    if (!setup.status().done) return res.redirect(303, "/setup");
    res.type("html").send(homePage(langOf(req)));
  });
  // DK | EN toggle. Only same-site paths are accepted as the way back.
  app.get("/lang/:lang", (req, res) => {
    const lang = req.params.lang === "en" ? "en" : "da";
    const back = String(req.query.back ?? "/");
    // Browsers read "/\host" as "//host", so a backslash in second place is off-site too.
    const safe = back.startsWith("/") && !/^\/[\/\\]/.test(back) ? back : "/";
    const secure = config.baseUrl.startsWith("https:") ? "; Secure" : "";
    res.set("Set-Cookie", `${LANG_COOKIE}=${lang}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`).redirect(303, safe);
  });
  // Only the owner connects chargers: the page shows the charger password.
  app.get("/connect", (req, res) => {
    if (!setup.isOwner(req)) return res.redirect(303, "/setup");
    res.set("Cache-Control", "no-store").type("html").send(
      connectPage(langOf(req), { ocppBase: ocppBase(), reachable: !isLocalUrl(config.baseUrl), password: setup.ocppPassword(), setup: !setup.status().done }),
    );
  });

  // First run: claim, price area, charger (/connect), Claude. Afterwards, what was set up.
  app.get("/setup", (req, res) => {
    const lang = langOf(req);
    res.set("Cache-Control", "no-store");
    const s = setup.status();
    if (!setup.isOwner(req)) return res.type("html").send(ownerPage(lang, s.claimed ? "login" : "claim"));
    if (!s.hasPassword) return res.type("html").send(ownerPage(lang, "password"));
    if (!s.priceArea) return res.type("html").send(areaPage(lang));
    const chargers = store.list();
    const monta = setup.monta();
    if (!setup.hasCharger(chargers.length)) return res.redirect(303, "/connect");
    const assistant = Boolean(s.assistant && s.assistant !== "skipped");
    if (!s.done) return res.type("html").send(assistantPage(lang, { claudeUrl: claudeUrl(), seen: assistant }));
    res.type("html").send(
      donePage(lang, {
        priceArea: s.priceArea,
        chargers: [
          ...chargers.filter((c) => !isMonta(c.id)).map((c) => ({ id: c.id, connected: isConnected(c.id) })),
          ...(monta?.chargePointId ? [{ id: `${monta.name ?? monta.chargePointId} (Monta)`, connected: true }] : []),
        ],
        assistant,
        ocppBase: ocppBase(),
        ocppPassword: setup.ocppPassword(),
        claudeUrl: claudeUrl(),
      }),
    );
  });
  const password = (req: Request) => String(req.body?.password ?? "");
  app.post("/setup/claim", (req, res) => {
    const result = setup.claim(password(req));
    if (result !== "ok") return res.status(result === "taken" ? 409 : 400).json({ error: result });
    res.set("Set-Cookie", setup.ownerCookie()).json({ ok: true });
  });
  app.post("/setup/login", (req, res) => {
    const result = setup.login(password(req));
    if (result !== "ok") return res.status(result === "throttled" ? 429 : 401).json({ error: result });
    res.set("Set-Cookie", setup.ownerCookie()).json({ ok: true });
  });
  // A new password changes the cookie, so the browser that set it gets the new one.
  app.post("/setup/password", ownerOnly, (req, res) => {
    const result = setup.setPassword(password(req));
    if (result !== "ok") return res.status(400).json({ error: result });
    res.set("Set-Cookie", setup.ownerCookie()).json({ ok: true });
  });
  app.post("/setup/area", ownerOnly, (req, res) => {
    const area = req.body?.area;
    if (area !== "DK1" && area !== "DK2") return res.status(400).json({ error: "bad_request" });
    setup.setPriceArea(area);
    // Chargers that dialled in before the area was chosen got the default.
    for (const c of store.list()) store.update(c.id, { priceArea: area });
    res.json({ ok: true });
  });
  // A charger that stays in Monta: check the keys, list the account's charge points, keep the keys.
  app.post("/setup/monta", ownerOnly, async (req, res) => {
    const clientId = String(req.body?.clientId ?? "").trim();
    const clientSecret = String(req.body?.clientSecret ?? "").trim();
    if (!clientId || !clientSecret) return res.status(400).json({ error: "bad_keys" });
    try {
      const points = await montaChargePoints(await montaToken(clientId, clientSecret));
      setup.setMonta({ clientId, clientSecret, ...(points.length === 1 ? { chargePointId: points[0].id, name: points[0].name } : {}) });
      res.json({ chargePoints: points.map(({ id, name, state, cablePluggedIn }) => ({ id, name, state, cablePluggedIn })) });
    } catch (err) {
      const kind = err instanceof MontaError ? err.kind : "unreachable";
      log(`monta: ${(err as Error).message}`);
      res.status(kind === "bad_keys" ? 400 : 502).json({ error: kind });
    }
  });
  app.post("/setup/monta/pick", ownerOnly, (req, res) => {
    const monta = setup.monta();
    const id = Number(req.body?.id);
    if (!monta || !Number.isInteger(id)) return res.status(400).json({ error: "bad_request" });
    setup.setMonta({ ...monta, chargePointId: id, name: String(req.body?.name ?? id).slice(0, 80) });
    res.json({ ok: true });
  });
  // For /connect's waiting step: a charger may announce itself under a slightly different id than the serial typed.
  app.get("/setup/chargers", ownerOnly, (_req, res) => {
    res.set("Cache-Control", "no-store").json(store.list().map((c) => ({ id: c.id, connected: isConnected(c.id) })));
  });
  app.get("/setup/state", ownerOnly, (_req, res) => {
    const s = setup.status();
    res.set("Cache-Control", "no-store").json({ assistant: Boolean(s.assistant && s.assistant !== "skipped") });
  });
  app.post("/setup/finish", ownerOnly, (req, res) => {
    if (!setup.status().priceArea || !setup.hasCharger(store.list().length)) return res.status(409).json({ error: "not_ready" });
    if (req.body?.skip) setup.skipAssistant();
    setup.finish();
    res.json({ ok: true });
  });
  app.get("/api/plan", planHandler);
  // The owner's own charger, so the front page shows and saves the settings the charger actually plans with.
  app.get("/api/my-charger", ownerOnly, (_req, res) => {
    const c = myCharger();
    if (!c) return res.status(404).json({ error: "no_charger" });
    const m = montaStatus(c.id);
    res.set("Cache-Control", "no-store").json({
      id: c.id,
      settings: { ready_by: c.readyBy, energy_kwh: c.energyKwh, green_weight: c.greenWeight, max_amps: c.maxAmps, phases: c.phases, price_area: c.priceArea, smart: c.smart },
      connected: isMonta(c.id) ? Boolean(m && !m.error) : isConnected(c.id),
      plugged_in: m?.pluggedIn ?? false,
      charging_now: m?.charging ?? false,
      monta_scheduling: m?.montaScheduling ?? false,
    });
  });
  app.post("/api/my-charger", ownerOnly, (req, res) => {
    const c = myCharger();
    if (!c) return res.status(404).json({ error: "no_charger" });
    const b = req.body ?? {};
    const patch: Record<string, unknown> = {};
    if (typeof b.ready_by === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(b.ready_by)) patch.readyBy = b.ready_by;
    if (Number.isFinite(b.energy_kwh) && b.energy_kwh >= 1 && b.energy_kwh <= 150) patch.energyKwh = b.energy_kwh;
    if (Number.isFinite(b.green_weight) && b.green_weight >= 0 && b.green_weight <= 1) patch.greenWeight = b.green_weight;
    if ([6, 10, 13, 16, 20, 25, 32].includes(b.max_amps)) patch.maxAmps = b.max_amps;
    if (b.phases === 1 || b.phases === 3) patch.phases = b.phases;
    if (b.price_area === "DK1" || b.price_area === "DK2") patch.priceArea = b.price_area;
    store.update(c.id, patch);
    if (isMonta(c.id)) replanMonta();
    res.json({ ok: true });
  });
  app.get("/api/charger/:id", chargerHandler);

  async function mcp(req: Request, res: Response, token: string | undefined): Promise<void> {
    // A local base URL alone is not enough: the OCPP listener shares this port and listens on every interface, so the LAN reaches /mcp too.
    const local = isLocalUrl(config.baseUrl) && fromLoopback(req.socket.remoteAddress);
    if (!local && !tokenMatches(token)) {
      res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Missing or wrong token. The address with the token is on this server's /setup page." }, id: null });
      return;
    }
    setup.assistantSeen();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    const server = createServer();
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      log("request failed:", (err as Error).message);
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
  app.post("/mcp", (req, res) => mcp(req, res, req.headers.authorization?.replace(/^Bearer\s+/i, "")));
  app.post("/mcp/:token", (req, res) => mcp(req, res, req.params.token));

  for (const method of ["get", "delete"] as const) {
    app[method](["/mcp", "/mcp/:token"], (_req, res) => {
      res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "This server is stateless; use POST /mcp." }, id: null });
    });
  }

  return app;
}
