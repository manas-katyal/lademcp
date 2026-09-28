// /mcp without a token is only for the machine itself: a local base URL must
// not open it to the rest of the network the OCPP listener is reachable on.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "lademcp-"));
delete process.env.BASE_URL;
delete process.env.MCP_BEARER_TOKEN;

const { listen } = await import("../src/listen.ts");

let port = 0;
let close: () => void;
before(async () => {
  const s = await listen(0);
  port = (s.server.address() as { port: number }).port;
  close = s.close;
});
after(() => close());

const listTools = (host: string) =>
  fetch(`http://${host}:${port}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });

test("local base URL: /mcp answers the machine itself without a token", async () => {
  assert.equal((await listTools("127.0.0.1")).status, 200);
});

const lan = Object.values(networkInterfaces()).flat().find((a) => a && a.family === "IPv4" && !a.internal)?.address;

test("local base URL: /mcp refuses the network without a token", { skip: !lan && "no non-loopback interface" }, async () => {
  assert.equal((await listTools(lan!)).status, 401);
});
