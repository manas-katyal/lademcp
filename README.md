# LadeMCP

Smart charging for home EV chargers in Denmark. The charger connects to this server over **OCPP 1.6J**; the server picks the quarter-hours to charge in from Energinet's **day-ahead spot prices** and **CO2 prognosis**, and sends the plan to the charger as a charging schedule. An MCP server on top lets Claude show, explain and change the plan.

- **Cheapest or greenest:** `green_weight` 0 charges in the cheapest hours, 1 in the lowest-CO2 hours, anything in between blends them. Every plan says what it costs and emits compared with charging right away, the cheapest plan and the greenest plan.
- **Automatic:** a plan is made when a car is plugged in, and redone every 30 minutes while it is, so tomorrow's prices (around 13:00) and the CO2 prognosis (around 15:00) are picked up.
- **A page for people:** `/` shows tonight's plan for settings you pick (ready-by time, kWh, charger power, DK1/DK2) and a cheapest-to-greenest slider, in Danish or English. It reads prices only and does not touch a charger. The data comes from `GET /api/plan`.
- **Grid tariff:** set `NETTARIF_DKK_PER_KWH` to your grid company's 24 hourly rates, or plans use the spot price alone and say so.

## Chargers

Built for the home chargers most used in Denmark:

| Charger | OCPP 1.6J to this server |
|---|---|
| Zaptec Go / Pro | Yes: Zaptec Portal, per-charger OCPP settings. Replaces Zaptec's own smart charging. |
| Easee Home / Charge / Lite | Yes, from firmware 344 (Direct OCPP, beta since Sep 2026), Wi-Fi only. |
| Wallbox Pulsar Plus / Max | Yes: myWallbox app, OCPP settings. |
| myenergi zappi | Yes: built-in Wi-Fi models, firmware 5.114+ (charging profiles 5.5+). |
| Clever, Tesla Wall Connector Gen 3 | No: Clever is locked to its own backend; Gen 3 has no OCPP. |

Point the charger at `wss://<your host>/ocpp/<charger id>`. The `connection_guide` tool has the steps per brand.

## Run

Node 24 or newer.

```sh
npm install
npm test
npm run dev                 # HTTP: MCP on POST /mcp, OCPP on ws://localhost:8080/ocpp/<id>
npm run simulate -- ws://localhost:8080/ocpp SIM-1   # a pretend charger
```

Claude Code, local: `claude mcp add lade -s user -- node ~/lademcp/src/stdio.ts`. The stdio server also opens the OCPP listener on port 9180.

## Configuration

| Variable | |
|---|---|
| `BASE_URL` | Public URL. Chargers get `wss://…/ocpp/<id>` from it. |
| `OCPP_PASSWORD` | Shared password for chargers (OCPP security profile 1, HTTP Basic, user = charger id). Set it on anything public. |
| `MCP_BEARER_TOKEN` | Required for `POST /mcp` on a public host, because the tools start and stop charging. |
| `NETTARIF_DKK_PER_KWH` | 24 comma-separated DKK/kWh values for 00:00–23:00, Danish time. |
| `PRICE_AREA` | Default `DK1` (west of the Great Belt) or `DK2` (east). Per charger via `update_charger`. |
| `DATA_DIR` | Where charger settings are kept (`~/.lademcp` locally). |

## Tools

`list_chargers`, `connection_guide`, `preview_plan` (read-only), `update_charger`, `start_smart_charging`, `charge_now`.

## Not yet

- The car's own state of charge: `energy_kwh` is an estimate per session. Car APIs would fix that and also reach Clever and Tesla Gen 3 owners.
- OCPP 2.0.1, TLS client certificates (security profiles 2–3), OAuth on `/mcp`.
- Tested against the simulator and unit tests, not yet against a real charger.

Data: Energinet, [Energi Data Service](https://www.energidataservice.dk) (DayAheadPrices, CO2EmisProg).

MIT licence.
