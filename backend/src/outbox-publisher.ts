import { runOutboxPublisher } from "./queue/outbox-publisher.js";

void runOutboxPublisher().catch((error) => {
  console.error("[outbox-publisher] fatal", error);
  process.exitCode = 1;
});
