// A pretend charger for trying the server without real hardware:
//   node scripts/simulate.ts [ws://localhost:9180/ocpp] [charger-id] [password]
// It boots, reports a car plugged in, answers every call with Accepted, and
// prints the charging schedule the server sends.
import WebSocket from "ws";

const [base = "ws://localhost:9180/ocpp", id = "SIM-0001", password] = process.argv.slice(2);
const headers: Record<string, string> = password ? { authorization: `Basic ${Buffer.from(`${id}:${password}`).toString("base64")}` } : {};
const ws = new WebSocket(`${base.replace(/\/+$/, "")}/${id}`, "ocpp1.6", { headers });
let n = 0;
const callCp = (action: string, payload: object) => ws.send(JSON.stringify([2, String(++n), action, payload]));

ws.on("open", () => {
  console.log(`connected as ${id}`);
  callCp("BootNotification", { chargePointVendor: "Simulator", chargePointModel: "Sim 11kW" });
  setTimeout(() => callCp("StatusNotification", { connectorId: 1, status: "Preparing", errorCode: "NoError" }), 500);
});

ws.on("message", (data) => {
  const frame = JSON.parse(data.toString());
  if (frame[0] === 2) {
    const [, msgId, action, payload] = frame;
    console.log(`\n<- ${action}`);
    console.dir(payload, { depth: null });
    ws.send(JSON.stringify([3, msgId, action === "ClearChargingProfile" ? { status: "Accepted" } : { status: "Accepted" }]));
  } else if (frame[0] === 3) {
    console.log(`reply to ${frame[1]}:`, JSON.stringify(frame[2]));
  }
});

ws.on("unexpected-response", (_req, res) => {
  console.error(`server refused the connection: ${res.statusCode}`);
  process.exit(1);
});
ws.on("close", () => process.exit(0));
