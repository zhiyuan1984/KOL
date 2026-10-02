// Test stub for the synchronous PostgreSQL bridge. It speaks the same
// SharedArrayBuffer response protocol as ../src/postgres/sync-worker.mjs but
// replies from a script instead of a real PostgreSQL connection, so bridge
// buffer management can be exercised without a database. The script entry for
// a message is either "drop" (never answer) or { afterMs, payload }.
import { parentPort, workerData } from "node:worker_threads";

if (!parentPort) throw new Error("PostgreSQL bridge stub worker requires a parent port");

const HEADER_BYTES = 16;
const STATUS = 0;
const LENGTH = 1;
const script = Array.isArray(workerData?.script) ? workerData.script : [];
let index = 0;

parentPort.on("message", (message) => {
  const step = script[index] ?? script[script.length - 1] ?? { payload: { ok: true, rows: [], rowCount: 0 } };
  index += 1;
  if (step === "drop") return;
  const deliver = () => {
    const header = new Int32Array(message.shared, 0, 4);
    const bytes = new TextEncoder().encode(JSON.stringify(step.payload));
    new Uint8Array(message.shared, HEADER_BYTES, bytes.length).set(bytes);
    Atomics.store(header, LENGTH, bytes.length);
    Atomics.store(header, STATUS, 1);
    Atomics.notify(header, STATUS, 1);
  };
  const delay = Number(step.afterMs || 0);
  if (delay > 0) setTimeout(deliver, delay);
  else deliver();
});
