import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withScopedUser } from "../src/auth.js";
import { DEMO_USER } from "../src/config.js";
import { getConn, resetConn } from "../src/db.js";
import {
  findMailItem,
  findMailThread,
  persistItemMemory,
  threadsByCollaborationIds,
} from "../src/host/mail-memory.js";
import { seedAll } from "../src/seed.js";
import { freshTestDatabase } from "./support/pg.js";

type ItemMemoryRow = {
  summary: string | null;
  summary_zh: string | null;
  summary_source: string | null;
  translation_zh: string | null;
  translation_source: string | null;
};

const AUTHORIZED_MAILBOX = "native-authorized@example.test";
const UNAUTHORIZED_MAILBOX = "native-unbound@example.test";
const NOW = "2026-10-15T00:00:00.000Z";

async function insertThread(input: { id: string; collaborationId: string; conversationId: string; mailbox: string }): Promise<void> {
  await getConn().query(
    `INSERT INTO kol_mail_threads
       (id,collaboration_id,conversation_id,subject,mailbox,unread_count,created_at,updated_at,match_state)
     VALUES ($1,$2,$3,$4,$5,0,$6,$6,'unbound')`,
    [input.id, input.collaborationId, input.conversationId, "native mail memory", input.mailbox, NOW],
  );
}

async function insertItem(id: string, threadId: string, conversationId: string): Promise<void> {
  await getConn().query(
    `INSERT INTO kol_mail_items
       (id,thread_id,conversation_id,provider_message_id,direction,subject,body_text,summary,summary_zh,
        summary_source,translation_zh,translation_source,created_at)
     VALUES ($1,$2,$3,$4,'inbound','native mail memory','The original source body.',
        'old summary','旧摘要','old-source','old translation','old-translation',$5)`,
    [id, threadId, conversationId, `provider-${id}`, NOW],
  );
}

beforeEach(async () => {
  await freshTestDatabase();
  await resetConn();
  await seedAll();
  await getConn().query(
    `INSERT INTO user_starry_bindings(user_id,mailbox_email,is_default,status,updated_at)
     VALUES ($1,$2,1,'connected',$3)
     ON CONFLICT (user_id,mailbox_email) DO UPDATE
       SET is_default=EXCLUDED.is_default,status=EXCLUDED.status,updated_at=EXCLUDED.updated_at`,
    [DEMO_USER.id, AUTHORIZED_MAILBOX, NOW],
  );
});

afterEach(async () => {
  await resetConn();
});

describe("mail-memory native PostgreSQL repository", () => {
  it("reads collaboration threads with ANY($1), handles empty/duplicate inputs, and never exposes an unbound mailbox", async () => {
    await insertThread({ id: "native-thread-authorized", collaborationId: "native-collaboration", conversationId: "native-conversation", mailbox: AUTHORIZED_MAILBOX });
    await insertThread({ id: "native-thread-unbound", collaborationId: "native-collaboration", conversationId: "native-unbound-conversation", mailbox: UNAUTHORIZED_MAILBOX });
    await insertItem("native-item-authorized", "native-thread-authorized", "native-conversation");
    await insertItem("native-item-unbound", "native-thread-unbound", "native-unbound-conversation");

    const grouped = await threadsByCollaborationIds(["native-collaboration", "native-collaboration", "", "missing"]);
    expect(grouped.get("native-collaboration")?.map((row) => row.id).sort()).toEqual([
      "native-thread-authorized",
      "native-thread-unbound",
    ]);
    await expect(threadsByCollaborationIds([])).resolves.toEqual(new Map());

    await withScopedUser(DEMO_USER, async () => {
      await expect(findMailThread("native-thread-authorized")).resolves.toMatchObject({ mailbox: AUTHORIZED_MAILBOX });
      await expect(findMailThread("native-conversation")).resolves.toMatchObject({ id: "native-thread-authorized" });
      await expect(findMailThread("native-thread-unbound")).resolves.toBeUndefined();
      await expect(findMailItem("native-item-authorized")).resolves.toMatchObject({ id: "native-item-authorized" });
      await expect(findMailItem("native-item-unbound")).resolves.toBeUndefined();
    });
  });

  it("asynchronously updates only supplied summary or translation fields", async () => {
    await insertThread({ id: "native-thread-memory", collaborationId: "native-memory-collaboration", conversationId: "native-memory-conversation", mailbox: AUTHORIZED_MAILBOX });
    await insertItem("native-item-memory", "native-thread-memory", "native-memory-conversation");

    await persistItemMemory("native-item-memory", { summary: "new summary", summary_source: "test-summary" });
    let row = (await getConn().query<ItemMemoryRow>(
      "SELECT summary,summary_zh,summary_source,translation_zh,translation_source FROM kol_mail_items WHERE id=$1",
      ["native-item-memory"],
    )).rows[0];
    expect(row).toEqual({
      summary: "new summary",
      summary_zh: "旧摘要",
      summary_source: "test-summary",
      translation_zh: "old translation",
      translation_source: "old-translation",
    });

    await persistItemMemory("native-item-memory", { translation_zh: "新译文", translation_source: "test-translation" });
    row = (await getConn().query<ItemMemoryRow>(
      "SELECT summary,summary_zh,summary_source,translation_zh,translation_source FROM kol_mail_items WHERE id=$1",
      ["native-item-memory"],
    )).rows[0];
    expect(row).toEqual({
      summary: "new summary",
      summary_zh: "旧摘要",
      summary_source: "test-summary",
      translation_zh: "新译文",
      translation_source: "test-translation",
    });
  });
});
