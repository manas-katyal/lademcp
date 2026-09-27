// HTTP entry point for a hosted deployment: MCP and OCPP on one port.
import { listen } from "./listen.ts";

await listen();
