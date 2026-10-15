import { beforeEach, expect, it } from "vitest";
import { freshTestDatabase } from "./support/pg.js";
import { postgresPool } from "../src/postgres/pool.js";
import { observeReplyMail, type ReplyMailObservation } from "../src/mail/reply-source.js";

const observations: ReplyMailObservation[] = [];
beforeEach(async () => {
  await freshTestDatabase({ reclaimPrevious: true });
  observations.length = 0;
  const now = new Date().toISOString();
  for (let i = 0; i < 30; i++) {
    await postgresPool().query(`INSERT INTO kol_mail_threads(id,conversation_id,subject,mailbox,created_at,updated_at,match_state)
      VALUES($1,$2,'Concurrency','owned@example.test',$3,$3,'unmatched')`, [`parallel-thread-${i}`, `parallel-conversation-${i}`, now]);
    observations.push({ thread_id: `parallel-thread-${i}`, collaboration_id: null,
      conversation_id: `parallel-conversation-${i}`, mailbox: "owned@example.test", provider_message_id: `parallel-message-${i}`,
      direction: "inbound", subject: "Concurrent source", title: "Concurrent source", body: `Exact body ${i}`,
      from: `creator-${i}@example.test`, from_name: "Creator", to: "owned@example.test", occurred_at: "2026-10-15T01:00:00Z",
      unread: true, summary: "", summary_zh: "", summary_source: "" });
  }
});

it("commits all 30 independent bodies with five concurrent writers and no partial failed batch", async () => {
  const errors: string[] = [];
  for (let start = 0; start < observations.length; start += 5) {
    const results = await Promise.allSettled(observations.slice(start, start + 5).map(observeReplyMail));
    for (const result of results) if (result.status === "rejected") errors.push(String(result.reason?.code || result.reason));
  }
  expect(errors, `SQL errors: ${errors.join(",")}`).toEqual([]);
  const counts = (await postgresPool().query(`SELECT
    (SELECT count(*)::int FROM kol_mail_items WHERE provider_message_id LIKE 'parallel-message-%') AS items,
    (SELECT count(*)::int FROM reply_mail_revisions WHERE provider_message_id LIKE 'parallel-message-%') AS revisions,
    (SELECT count(*)::int FROM business_events WHERE event_type='email.received') AS events`)).rows[0];
  expect(counts).toEqual({ items: 30, revisions: 30, events: 30 });
  await Promise.all(Array.from({ length: 10 }, () => observeReplyMail(observations[0]!)));
  expect((await postgresPool().query("SELECT count(*)::int AS n FROM reply_mail_revisions WHERE provider_message_id='parallel-message-0'")).rows[0].n).toBe(1);
  expect((await postgresPool().query("SELECT count(*)::int AS n FROM business_events WHERE event_type='email.received'")).rows[0].n).toBe(30);
});
