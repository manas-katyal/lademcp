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
import { areaPage, assistantPage, claimPage, donePage } from "./setup-page.ts";
import type { Request, Response, NextFunction } from "express";

function tokenMatches(token: string | undefined): boolean {
  const given = Buffer.from(token ?? "");
  const want = Buffer.from(setup.mcpToken());
  return given.length === want.length && timingSafeEqual(given, want);
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
    if (!setup.isOwner(req)) return res.type("html").send(claimPage(lang));
    const s = setup.status();
    if (!s.priceArea) return res.type("html").send(areaPage(lang));
    const chargers = store.list();
    if (!chargers.length) return res.redirect(303, "/connect");
    const assistant = Boolean(s.assistant && s.assistant !== "skipped");
    if (!s.done) return res.type("html").send(assistantPage(lang, { claudeUrl: claudeUrl(), seen: assistant }));
    res.type("html").send(
      donePage(lang, {
        priceArea: s.priceArea,
        chargers: chargers.map((c) => ({ id: c.id, connected: isConnected(c.id) })),
        assistant,
        ocppBase: ocppBase(),
        ocppPassword: setup.ocppPassword(),
        claudeUrl: claudeUrl(),
      }),
    );
  });
  app.post("/setup/claim", (req, res) => {
    const result = setup.claim(String(req.body?.code ?? ""));
    if (result !== "ok") return res.status(result === "locked" ? 429 : 400).json({ error: result });
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
  app.get("/setup/state", ownerOnly, (_req, res) => {
    const s = setup.status();
    res.set("Cache-Control", "no-store").json({ assistant: Boolean(s.assistant && s.assistant !== "skipped") });
  });
  app.post("/setup/finish", ownerOnly, (req, res) => {
    if (!setup.status().priceArea || !store.list().length) return res.status(409).json({ error: "not_ready" });
    if (req.body?.skip) setup.skipAssistant();
    setup.finish();
    res.json({ ok: true });
  });
  app.get("/api/plan", planHandler);
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
