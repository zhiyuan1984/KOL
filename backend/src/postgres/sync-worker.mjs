import { parentPort, workerData } from "node:worker_threads";
import { Client } from "pg";

if (!parentPort) throw new Error("PostgreSQL sync bridge requires a worker parent port");

const client = new Client({ connectionString: String(workerData.connectionString) });
const encoder = new TextEncoder();
const HEADER_BYTES = 16;

function respond(shared, payload) {
  const header = new Int32Array(shared, 0, 4);
  const bytes = encoder.encode(JSON.stringify(payload));
  const target = new Uint8Array(shared, HEADER_BYTES);
  if (bytes.length > target.length) {
    const fallback = encoder.encode(JSON.stringify({
      ok: false,
      error: { message: `PostgreSQL bridge response exceeds PG_SYNC_BUFFER_BYTES (${bytes.length})` },
    }));
    target.set(fallback.subarray(0, target.length));
    Atomics.store(header, 1, Math.min(fallback.length, target.length));
  } else {
    target.set(bytes);
    Atomics.store(header, 1, bytes.length);
  }
  Atomics.store(header, 0, 1);
  Atomics.notify(header, 0, 1);
}

await client.connect();

parentPort.on("message", async (message) => {
  try {
    const result = await client.query({ text: message.sql, values: message.params });
    const last = Array.isArray(result) ? result[result.length - 1] : result;
    respond(message.shared, { ok: true, rows: last?.rows || [], rowCount: last?.rowCount || 0 });
  } catch (error) {
    respond(message.shared, {
      ok: false,
      error: {
        message: error?.message || String(error),
        code: error?.code,
        detail: error?.detail,
        constraint: error?.constraint,
      },
    });
  }
});
