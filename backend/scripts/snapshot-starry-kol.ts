/**
 * Refresh Starry KOL MCP fixtures used by real-data acceptance tests.
 * Does not call decryptKolContact.
 *
 *   cd backend && npx tsx scripts/snapshot-starry-kol.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RemoteMcpClient } from "../src/mcp/remote.js";
import type { Json } from "../src/types.js";

const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../tests/fixtures/real-data");
const url = process.env.STARRY_KOL_MCP_URL || "http://47.251.65.112:9091/mcp";
const apiKey = process.env.STARRY_KOL_MCP_API_KEY || "email-agent-mcp-dev";

function unwrap(value: Json): Json {
  if (value.data && typeof value.data === "object") return value.data as Json;
  return value;
}

function writeJson(name: string, value: unknown): void {
  const target = path.join(outDir, name);
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
  console.log(`wrote ${target}`);
}

const client = new RemoteMcpClient({
  url,
  headers: { "X-MCP-API-KEY": apiKey },
  timeoutMs: 30000,
});

try {
  const profiles = unwrap(await client.callTool("listAllKolProfiles", {}));
  const mailboxes = unwrap(await client.callTool("pageMailboxes", { pageNo: 1, pageSize: 50 }));
  const stages = unwrap(await client.callTool("listCooperationStageOptions", {}));
  writeJson("starry-kol-profiles.json", profiles);
  writeJson("starry-kol-mailboxes.json", mailboxes);
  writeJson("starry-kol-stages.json", Array.isArray(stages) ? stages : (stages as { list?: unknown }).list || stages);
} finally {
  await client.close().catch(() => undefined);
}
