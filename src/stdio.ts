// Local entry point for Claude Code, Claude Desktop and other stdio MCP
// clients. The OCPP listener still starts, on PORT (default 9180), because the
// charger needs something to connect to. Nothing may write to stdout except
// the MCP transport, so all logging goes to stderr.
process.env.LADEMCP_LOCAL ??= "1";
const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
const { createServer } = await import("./mcp.ts");
const { listen } = await import("./listen.ts");

try {
  await listen();
} catch (err) {
  // Another copy may already hold the port; the MCP tools still answer from
  // saved settings, they just cannot reach chargers from this process.
  console.error(`[lade] OCPP listener not started: ${(err as Error).message}`);
}

const transport = new StdioServerTransport();
transport.onclose = () => process.exit(0);
process.stdin.on("end", () => process.exit(0));
await createServer().connect(transport);
