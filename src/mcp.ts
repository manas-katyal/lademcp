import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "./tools.ts";
import { registerPrompts } from "./prompts.ts";

export const VERSION = "0.1.0";

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "lade", title: "LadeMCP", version: VERSION },
    {
      instructions: [
        "Smart charging for home EV chargers in Denmark. Chargers connect to this server over OCPP 1.6J; it plans when they charge from Energinet's day-ahead spot prices and CO2 prognosis, and sends the plan as a charging schedule.",
        "Call list_chargers first. preview_plan is read-only and is the way to answer 'when will it charge' or 'what if'; update_charger, start_smart_charging and charge_now change what the charger does, so only call them when the user asks for that.",
        "green_weight trades cost for CO2: 0 is cheapest, 1 is greenest. When the user asks for green charging, show what it costs extra using compared_with rather than assuming it is free.",
        "Costs are spot price plus the grid tariff when one is configured. cost_basis says which; do not present the numbers as the full bill, since elafgift, Energinet tariffs and VAT come on top.",
        "Prices for tomorrow arrive around 13:00 and the CO2 prognosis around 15:00. Before that a plan only sees until midnight; say so when a plan carries a warning about it.",
        "If a charger is not connected, call connection_guide: it has the URL and where to enter it on Zaptec, Easee, Wallbox and zappi. Clever and Tesla Wall Connector Gen 3 cannot connect over OCPP.",
      ].join(" "),
    },
  );
  registerTools(server);
  registerPrompts(server);
  return server;
}
