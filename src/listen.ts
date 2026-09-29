// Starts the HTTP server with the OCPP WebSocket attached and the re-planning
// scheduler running. Shared by the hosted entry point and the stdio one, since
// in both cases the charger needs something to dial into.
import type { Server } from "node:http";
import { createApp } from "./app.ts";
import { config, setupProblems } from "./config.ts";
import { createOcppServer } from "./ocpp.ts";
import { startScheduler } from "./smart.ts";
import { setup } from "./setup.ts";

export function listen(port = config.port): Promise<{ server: Server; close: () => void }> {
  const ocpp = createOcppServer();
  const stopScheduler = startScheduler();
  const server = createApp().listen(port);
  server.on("upgrade", (req, socket, head) => {
    if (!ocpp.handleUpgrade(req, socket, head)) socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.once("listening", () => {
      console.error(`[lade ${new Date().toISOString()}] listening on port ${port}, public URL ${config.baseUrl}`);
      for (const problem of setupProblems()) console.error(`[lade] ${problem}`);
      // The owner claims the server with this; it is only ever printed here.
      const code = setup.claimCode();
      if (code && !config.localMode) console.error(`[lade] Setup: open ${config.baseUrl}/setup?code=${code} to set up this server (code ${code})`);
      resolve({
        server,
        close: () => {
          stopScheduler();
          ocpp.close();
          server.close();
        },
      });
    });
  });
}
