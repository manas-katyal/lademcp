// HTTP entry point: MCP on POST /mcp and OCPP on WebSocket /ocpp/<id>, on one
// port, because a hosted deployment usually gets one. Unlike energimcp this
// server acts on a household's charger, so /mcp needs a bearer token unless it
// only listens on localhost.
import express from "express";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config, isLocalUrl, setupProblems } from "./config.ts";
import { createServer, VERSION } from "./mcp.ts";
import { isConnected, OCPP_PATH } from "./ocpp.ts";
import { store } from "./store.ts";

function tokenMatches(header: string | undefined): boolean {
  if (!config.mcpToken) return false;
  const given = Buffer.from(header?.replace(/^Bearer\s+/i, "") ?? "");
  const want = Buffer.from(config.mcpToken);
  return given.length === want.length && timingSafeEqual(given, want);
}

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

  app.get("/", (_req, res) => {
    const ws = config.baseUrl.replace(/^http/, "ws");
    res
      .type("html")
      .send(
        `<!doctype html><meta charset="utf-8"><title>${config.appName}</title>` +
          `<pre>${config.appName} ${VERSION}\n\nSmart charging over OCPP 1.6J, planned on Danish day-ahead prices and CO2.\nOCPP endpoint: ${ws}${OCPP_PATH}&lt;charge point id&gt;\nMCP endpoint: POST ${config.baseUrl}/mcp\nHealth: ${config.baseUrl}/healthz\n</pre>`,
      );
  });

  app.post("/mcp", async (req, res) => {
    if (!isLocalUrl(config.baseUrl) && !tokenMatches(req.headers.authorization)) {
      res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: config.mcpToken ? "Missing or wrong bearer token." : "MCP_BEARER_TOKEN is not set on this server, so /mcp is closed." }, id: null });
      return;
    }
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
  });

  for (const method of ["get", "delete"] as const) {
    app[method]("/mcp", (_req, res) => {
      res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "This server is stateless; use POST /mcp." }, id: null });
    });
  }

  return app;
}
