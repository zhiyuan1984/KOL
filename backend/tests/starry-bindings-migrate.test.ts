import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";
import { clearStarryBinding, saveStarryBinding, starryBindingRow, starryBindingRows } from "../src/host/starry-bind.js";
import type { Row } from "../src/types.js";
import { freshTestDatabase } from "./support/pg.js";

let tmp = "";

beforeEach(async () => {
  await freshTestDatabase();
  await resetConn();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-bind-migrate-"));
  process.env.LINGONG_DB = path.join(tmp, "test.db");
  process.env.LINGONG_DATA = tmp;
});

afterEach(async () => {
  (await resetConn());
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function pkColumns(): Promise<string[]> {
  const rows = (await getConn().query<{ name: string }>(`SELECT k.column_name AS name
    FROM information_schema.table_constraints AS c
    JOIN information_schema.key_column_usage AS k
      USING (constraint_catalog,constraint_schema,constraint_name)
    WHERE c.constraint_type='PRIMARY KEY' AND c.table_schema=current_schema()
      AND c.table_name=$1 ORDER BY k.ordinal_position`, ["user_starry_bindings"])).rows;
  return rows.map(row => row.name);
}

async function seedUser(id: string): Promise<Awaited<void>> {
  const now = new Date().toISOString();
  (await getConn().query("INSERT INTO users (id,username,name,password_hash,roles,active,created_at,updated_at)\n     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING",[id,id,id,"x","[]",1,now,now]));
}

describe("user_starry_bindings multi-mailbox migration", () => {
  it("preserves an existing mailbox across native pool reopen and verifies the composite key", async () => {
    await seedUser("usr_a");
    await getConn().query(`INSERT INTO user_starry_bindings
      (user_id,mailbox_email,mailbox_id,owner_name,status,is_default,updated_at,synced_at,last_error)
      VALUES($1,$2,$3,$4,'connected',1,$5,$6,'')`,
      ["usr_a","first@example.com","mbx_1","甲","2026-01-01T00:00:00.000Z","2026-01-02T00:00:00.000Z"]);
    await resetConn();
    expect(await pkColumns()).toEqual(["user_id","mailbox_email"]);
    const rows = await starryBindingRows("usr_a");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ mailbox_email: "first@example.com",owner_name: "甲",is_default: 1 });
    expect(new Date(String(rows[0].synced_at)).toISOString()).toBe("2026-01-02T00:00:00.000Z");
    expect((await starryBindingRow("usr_a"))?.mailbox_email).toBe("first@example.com");
  });

  it("binding a second mailbox keeps both and never moves the default", async () => {
    getConn();
    (await seedUser("usr_b"));
    const first = (await saveStarryBinding("usr_b", { mailbox_email: "first@example.com", owner_name: "甲" }));
    expect(first).toMatchObject({ bound: true, mailbox_email: "first@example.com" });
    const second = (await saveStarryBinding("usr_b", { mailbox_email: "second@example.com", owner_name: "乙" }));
    expect(second).toMatchObject({ bound: true, mailbox_email: "second@example.com" });

    const rows = (await starryBindingRows("usr_b"));
    expect(rows.map((row: Row) => row.mailbox_email)).toEqual(["first@example.com", "second@example.com"]);
    expect(Number(rows[0].is_default)).toBe(1);
    expect(Number(rows[1].is_default)).toBe(0);
    expect((await starryBindingRow("usr_b"))?.mailbox_email).toBe("first@example.com");
  });

  it("unbind deletes only the named mailbox and leaves remaining mailboxes without an implicit default", async () => {
    getConn();
    (await seedUser("usr_c"));
    (await saveStarryBinding("usr_c", { mailbox_email: "old@example.com" }));
    (await saveStarryBinding("usr_c", { mailbox_email: "new@example.com" }));

    const afterDeleteSecond = (await clearStarryBinding("usr_c", "new@example.com"));
    expect((await starryBindingRows("usr_c"))).toHaveLength(1);
    expect(afterDeleteSecond.mailbox_email).toBe("old@example.com");

    // Unbind without a mailbox targets the current default.
    const afterDeleteDefault = (await clearStarryBinding("usr_c", "old@example.com"));
    expect((await starryBindingRows("usr_c"))).toHaveLength(0);
    expect(afterDeleteDefault.bound).toBe(false);

    (await saveStarryBinding("usr_c", { mailbox_email: "a@example.com" }));
    (await saveStarryBinding("usr_c", { mailbox_email: "b@example.com" }));
    (await clearStarryBinding("usr_c", "a@example.com"));
    expect(Number((await starryBindingRow("usr_c", "b@example.com"))?.is_default)).toBe(0);
    expect((await starryBindingRow("usr_c"))).toBeUndefined();
  });

  it("re-selecting a mailbox restores the default after the previous default was removed", async () => {
    getConn();
    (await seedUser("usr_d"));
    (await saveStarryBinding("usr_d", { mailbox_email: "first@example.com", owner_name: "甲" }));
    (await saveStarryBinding("usr_d", { mailbox_email: "second@example.com", owner_name: "乙" }));
    (await clearStarryBinding("usr_d", "first@example.com"));
    expect((await starryBindingRow("usr_d"))).toBeUndefined();

    // 无默认时的显式保存：本次所选成为默认，不再卡在未绑定。
    const restored = (await saveStarryBinding("usr_d", { mailbox_email: "second@example.com", owner_name: "乙" }));
    expect(restored).toMatchObject({ bound: true, mailbox_email: "second@example.com" });
    expect(Number((await starryBindingRow("usr_d", "second@example.com"))?.is_default)).toBe(1);
    expect((await starryBindingRow("usr_d"))?.mailbox_email).toBe("second@example.com");

    // 已有默认时再加一只：不移动默认。
    (await saveStarryBinding("usr_d", { mailbox_email: "third@example.com" }));
    expect(Number((await starryBindingRow("usr_d", "third@example.com"))?.is_default)).toBe(0);
    expect((await starryBindingRow("usr_d"))?.mailbox_email).toBe("second@example.com");
  });
});
