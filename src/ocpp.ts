// OCPP 1.6J central system: the WebSocket chargers dial into. Zaptec, Easee,
// Wallbox and zappi all speak this version, which is why it comes first.
//
// OCPP-J frames are JSON arrays:
//   [2, id, action, payload]   call        (either side can send one)
//   [3, id, payload]           call result
//   [4, id, code, description, details]  call error
// The charger always opens the connection, to <url>/<charge point id>, and
// asks for the "ocpp1.6" subprotocol. We answer its calls (BootNotification,
// StatusNotification, …) and make our own (SetChargingProfile) on the same socket.
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { config } from "./config.ts";
import { store } from "./store.ts";

export const OCPP_PATH = "/ocpp/";

export class OcppError extends Error {
  readonly code: string;

  constructor(code: string, description: string) {
    super(`${code}: ${description}`);
    this.code = code;
  }
}

type Handler = (id: string, payload: Record<string, unknown>) => Record<string, unknown>;

interface Pending {
  resolve: (payload: Record<string, unknown>) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

const sockets = new Map<string, WebSocket>();
const pending = new Map<string, Pending>();
const now = () => new Date().toISOString();
const log = (msg: string) => console.error(`[lade ${now()}] ${msg}`);

/** Listeners the scheduler uses to re-plan when a car is plugged in or a charger reconnects. */
type Event = { type: "boot" | "status" | "disconnect"; id: string; connectorId?: number; status?: string };
const listeners = new Set<(e: Event) => void>();
export const onChargerEvent = (fn: (e: Event) => void) => void listeners.add(fn);
const emit = (e: Event) => {
  for (const fn of listeners) {
    try {
      fn(e);
    } catch (err) {
      log(`listener failed: ${(err as Error).message}`);
    }
  }
};

// --- Calls from the charger ---

const handlers: Record<string, Handler> = {
  BootNotification(id, p) {
    const state = store.state(id);
    state.vendor = String(p.chargePointVendor ?? "");
    state.model = String(p.chargePointModel ?? "");
    state.firmware = p.firmwareVersion ? String(p.firmwareVersion) : undefined;
    store.ensure(id);
    // Emitted after the reply is sent: a charger may ignore calls until it is Accepted.
    setImmediate(() => emit({ type: "boot", id }));
    return { status: "Accepted", currentTime: now(), interval: config.heartbeatSeconds };
  },
  Heartbeat: () => ({ currentTime: now() }),
  StatusNotification(id, p) {
    const connectorId = Number(p.connectorId ?? 0);
    const status = String(p.status ?? "");
    store.state(id).status[connectorId] = status;
    setImmediate(() => emit({ type: "status", id, connectorId, status }));
    return {};
  },
  // A home charger with smart charging should not demand an RFID tag, so every
  // idTag is accepted. Access control belongs to the charger's own settings.
  Authorize: () => ({ idTagInfo: { status: "Accepted" } }),
  StartTransaction(id, p) {
    const transactionId = Math.floor(Date.now() / 1000) % 2_000_000_000;
    const state = store.state(id);
    state.transactionId = transactionId;
    state.meterWh = Number(p.meterStart ?? 0);
    return { transactionId, idTagInfo: { status: "Accepted" } };
  },
  StopTransaction(id, p) {
    const state = store.state(id);
    state.transactionId = undefined;
    if (typeof p.meterStop === "number") state.meterWh = p.meterStop;
    return { idTagInfo: { status: "Accepted" } };
  },
  MeterValues(id, p) {
    // Keep only the energy register; power and current samples are noise here.
    for (const mv of (p.meterValue as { sampledValue?: { value: string; measurand?: string; unit?: string }[] }[] | undefined) ?? []) {
      for (const sv of mv.sampledValue ?? []) {
        const measurand = sv.measurand ?? "Energy.Active.Import.Register";
        if (measurand !== "Energy.Active.Import.Register") continue;
        const value = Number(sv.value);
        if (Number.isFinite(value)) store.state(id).meterWh = sv.unit === "kWh" ? value * 1000 : value;
      }
    }
    return {};
  },
  DataTransfer: () => ({ status: "UnknownVendorId" }),
  FirmwareStatusNotification: () => ({}),
  DiagnosticsStatusNotification: () => ({}),
};

function send(ws: WebSocket, frame: unknown[]): void {
  ws.send(JSON.stringify(frame));
}

function onMessage(id: string, ws: WebSocket, raw: string): void {
  store.state(id).lastSeen = now();
  let frame: unknown;
  try {
    frame = JSON.parse(raw);
  } catch {
    return send(ws, [4, "-1", "FormationViolation", "Not JSON", {}]);
  }
  if (!Array.isArray(frame)) return send(ws, [4, "-1", "FormationViolation", "Not an OCPP-J frame", {}]);
  const [type, msgId] = frame as [number, string];

  if (type === 2) {
    const [, , action, payload] = frame as [number, string, string, Record<string, unknown>];
    // Own keys only: "constructor" or "toString" would otherwise find Object.prototype and answer a CALLRESULT.
    const handler = Object.hasOwn(handlers, action) ? handlers[action] : undefined;
    if (!handler) return send(ws, [4, msgId, "NotImplemented", `${action} is not supported`, {}]);
    try {
      return send(ws, [3, msgId, handler(id, payload ?? {})]);
    } catch (err) {
      return send(ws, [4, msgId, "InternalError", (err as Error).message, {}]);
    }
  }

  const call = pending.get(msgId);
  if (!call) return;
  pending.delete(msgId);
  clearTimeout(call.timer);
  if (type === 3) call.resolve((frame[2] ?? {}) as Record<string, unknown>);
  else if (type === 4) call.reject(new OcppError(String(frame[2]), String(frame[3] ?? "")));
}

// --- Calls to the charger ---

export function isConnected(id: string): boolean {
  return sockets.has(id);
}

export function call(id: string, action: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const ws = sockets.get(id);
  if (!ws) return Promise.reject(new OcppError("NotConnected", `Charger ${id} is not connected`));
  const msgId = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(msgId);
      reject(new OcppError("Timeout", `Charger ${id} did not answer ${action} within ${config.ocppCallTimeoutMs / 1000}s`));
    }, config.ocppCallTimeoutMs);
    pending.set(msgId, { resolve, reject, timer });
    send(ws, [2, msgId, action, payload]);
  });
}

// --- Connection handling ---

function authorized(id: string, req: IncomingMessage): boolean {
  if (!config.ocppPassword) return true;
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Basic ")) return false;
  const [user, ...rest] = Buffer.from(header.slice(6), "base64").toString("utf8").split(":");
  const given = Buffer.from(rest.join(":"));
  const want = Buffer.from(config.ocppPassword);
  // Constant time, like the MCP token: a plain === lets response timing reveal the password bit by bit.
  return user === id && given.length === want.length && timingSafeEqual(given, want);
}

export function createOcppServer() {
  const wss = new WebSocketServer({
    noServer: true,
    // Refuse a charger that does not offer 1.6: talking 2.0.1 at it would fail in confusing ways later.
    handleProtocols: (protocols) => (protocols.has("ocpp1.6") ? "ocpp1.6" : false),
  });

  wss.on("connection", (ws: WebSocket, _req: IncomingMessage, id: string) => {
    // A charger that reconnects replaces its old socket; the old one is dead anyway.
    sockets.get(id)?.terminate();
    sockets.set(id, ws);
    const state = store.state(id);
    state.connected = true;
    state.lastSeen = now();
    store.ensure(id);
    log(`charger ${id} connected`);

    ws.on("message", (data) => onMessage(id, ws, data.toString()));
    // A bad frame (invalid UTF-8, reserved bits) emits "error"; unheard, it would take the process down.
    ws.on("error", (err) => log(`charger ${id}: ${err.message}`));
    ws.on("close", () => {
      if (sockets.get(id) !== ws) return;
      sockets.delete(id);
      state.connected = false;
      log(`charger ${id} disconnected`);
      emit({ type: "disconnect", id });
    });
  });

  /** Hook for the HTTP server's upgrade event, so OCPP shares the port with MCP. */
  function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    // Both throw on a malformed request line ("//", "%E0%A4%A"); a throw here is uncaught and ends the process.
    let pathname: string;
    try {
      pathname = new URL(req.url ?? "/", "http://x").pathname;
    } catch {
      return false;
    }
    if (!pathname.startsWith(OCPP_PATH)) return false;
    let id: string;
    try {
      id = decodeURIComponent(pathname.slice(OCPP_PATH.length)).replace(/\/+$/, "");
    } catch {
      id = "";
    }
    if (!id || id.includes("/")) {
      socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
      return true;
    }
    if (!authorized(id, req)) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm="ocpp"\r\n\r\n');
      return true;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req, id));
    return true;
  }

  function close(): void {
    for (const ws of sockets.values()) ws.terminate();
    sockets.clear();
    wss.close();
  }

  return { handleUpgrade, close };
}
