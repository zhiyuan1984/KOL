import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { postgresDb, resetDatabase } from "../src/postgres/access.js";
import { clearStarryBinding, saveStarryBinding, starryBindingRow, starryBindingRows } from "../src/host/starry-bind.js";
import type { Row } from "../src/types.js";
import { freshTestDatabase } from "./support/pg.js";
beforeEach(async () => {
  await freshTestDatabase();
  await resetDatabase();
});
afterEach(async () => {
  await resetDatabase();
});
async function pkColumns(): Promise<string[]> {
  const rows = (await postgresDb().many(`SELECT kcu.column_name AS name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name=tc.constraint_name
       AND kcu.constraint_schema=tc.constraint_schema
       AND kcu.table_name=tc.table_name
     WHERE tc.table_schema=current_schema()
       AND tc.table_name='user_starry_bindings'
       AND tc.constraint_type='PRIMARY KEY'
     ORDER BY kcu.ordinal_position`)) as Array<{
    name: string;
  }>;
  return rows.map((row) => row.name);
}
async function seedUser(id: string): Promise<void> {
  const now = new Date().toISOString();
  await postgresDb().execute(`INSERT INTO users (id,username,name,password_hash,roles,active,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`, id, id, id, "x", "[]", 1, now, now);
}
describe("user_starry_bindings PostgreSQL 多邮箱持久化", () => {
  it("以复合主键保存首个邮箱，并将其设为默认邮箱", async () => {
    await seedUser("usr_a");
    const saved = await saveStarryBinding("usr_a", {
      mailbox_email: "first@example.com",
      mailbox_id: "mbx_1",
      owner_name: "甲",
    });
    expect(await pkColumns()).toEqual(["user_id", "mailbox_email"]);
    expect(saved).toMatchObject({ bound: true, mailbox_email: "first@example.com" });
    const rows = await starryBindingRows("usr_a");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      mailbox_email: "first@example.com",
      owner_name: "甲",
      is_default: 1,
    });
    expect((await starryBindingRow("usr_a"))?.mailbox_email).toBe("first@example.com");
  });
  it("binding a second mailbox keeps both and never moves the default", async () => {
    await seedUser("usr_b");
    const first = await saveStarryBinding("usr_b", { mailbox_email: "first@example.com", owner_name: "甲" });
    expect(first).toMatchObject({ bound: true, mailbox_email: "first@example.com" });
    const second = await saveStarryBinding("usr_b", { mailbox_email: "second@example.com", owner_name: "乙" });
    expect(second).toMatchObject({ bound: true, mailbox_email: "second@example.com" });
    const rows = await starryBindingRows("usr_b");
    expect(rows.map((row: Row) => row.mailbox_email)).toEqual(["first@example.com", "second@example.com"]);
    expect(Number(rows[0].is_default)).toBe(1);
    expect(Number(rows[1].is_default)).toBe(0);
    expect((await starryBindingRow("usr_b"))?.mailbox_email).toBe("first@example.com");
  });
  it("unbind deletes only the named mailbox and leaves remaining mailboxes without an implicit default", async () => {
    await seedUser("usr_c");
    await saveStarryBinding("usr_c", { mailbox_email: "old@example.com" });
    await saveStarryBinding("usr_c", { mailbox_email: "new@example.com" });
    const afterDeleteSecond = await clearStarryBinding("usr_c", "new@example.com");
    expect(await starryBindingRows("usr_c")).toHaveLength(1);
    expect(afterDeleteSecond.mailbox_email).toBe("old@example.com");
    const afterDeleteDefault = await clearStarryBinding("usr_c", "old@example.com");
    expect(await starryBindingRows("usr_c")).toHaveLength(0);
    expect(afterDeleteDefault.bound).toBe(false);
    await saveStarryBinding("usr_c", { mailbox_email: "a@example.com" });
    await saveStarryBinding("usr_c", { mailbox_email: "b@example.com" });
    await clearStarryBinding("usr_c", "a@example.com");
    expect(Number((await starryBindingRow("usr_c", "b@example.com"))?.is_default)).toBe(0);
    expect(await starryBindingRow("usr_c")).toBeUndefined();
  });
  it("re-selecting a mailbox restores the default after the previous default was removed", async () => {
    await seedUser("usr_d");
    await saveStarryBinding("usr_d", { mailbox_email: "first@example.com", owner_name: "甲" });
    await saveStarryBinding("usr_d", { mailbox_email: "second@example.com", owner_name: "乙" });
    await clearStarryBinding("usr_d", "first@example.com");
    expect(await starryBindingRow("usr_d")).toBeUndefined();
    const restored = await saveStarryBinding("usr_d", { mailbox_email: "second@example.com", owner_name: "乙" });
    expect(restored).toMatchObject({ bound: true, mailbox_email: "second@example.com" });
    expect(Number((await starryBindingRow("usr_d", "second@example.com"))?.is_default)).toBe(1);
    expect((await starryBindingRow("usr_d"))?.mailbox_email).toBe("second@example.com");
    await saveStarryBinding("usr_d", { mailbox_email: "third@example.com" });
    expect(Number((await starryBindingRow("usr_d", "third@example.com"))?.is_default)).toBe(0);
    expect((await starryBindingRow("usr_d"))?.mailbox_email).toBe("second@example.com");
  });
});
