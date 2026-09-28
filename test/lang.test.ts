// The DK | EN toggle sends the visitor back where they were, and only there.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "lademcp-"));

const { listen } = await import("../src/listen.ts");

let port = 0;
let close: () => void;
before(async () => {
  const s = await listen(0);
  port = (s.server.address() as { port: number }).port;
  close = s.close;
});
after(() => close());

const backTo = async (back: string) => (await fetch(`http://localhost:${port}/lang/en?back=${encodeURIComponent(back)}`, { redirect: "manual" })).headers.get("location");

test("the language toggle goes back to a path on this site", async () => {
  assert.equal(await backTo("/connect"), "/connect");
});

test("the language toggle never sends the visitor to another site", async () => {
  for (const back of ["//evil.example", "/\\evil.example", "https://evil.example"]) assert.equal(await backTo(back), "/", back);
});
