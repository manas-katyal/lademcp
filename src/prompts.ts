import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "tonights_charge",
    {
      title: "Tonight's charge",
      description: "When the car will charge tonight, what it costs, and what greener charging would cost extra",
      argsSchema: { ready_by: z.string().optional().describe("When the car has to be ready, HH:MM") },
    },
    ({ ready_by }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Call list_chargers, then preview_plan for my charger${ready_by ? ` with ready_by ${ready_by}` : ""}. ` +
              "Tell me when it will charge, what it costs and the CO2, and compare it with charging right away. " +
              "Then preview it once more with green_weight 1 and tell me what the greenest plan costs extra and how much CO2 it saves. Do not change any settings.",
          },
        },
      ],
    }),
  );
}
