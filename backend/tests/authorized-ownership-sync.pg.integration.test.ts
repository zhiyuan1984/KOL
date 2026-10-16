import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const transport = vi.hoisted(() => ({ page: vi.fn() }));
vi.mock("../src/host/starry-connectors.js", () => ({ pageKolProfiles: transport.page }));
import { mapUser, withScopedUser, type AppUser } from "../src/auth.js";
import { getConn, resetConn } from "../src/db.js";
import { clearStarryBinding, saveStarryBinding } from "../src/host/starry-bind.js";
import { readAuthorizedOwnershipSnapshot } from "../src/starrykol/authorized-ownership.js";
import { updateBindingSyncCursorPg } from "../src/starrykol/mail-sync-pg.js";
import { freshTestDatabase } from "./support/pg.js";

const employeeId = "ownership_sync_employee";
const mailbox = "larry.zhao@amperetime.com";
const bindingVersion = "2026-01-01T00:00:00.000Z";
const syncedAt = "2026-10-16T00:00:00.000Z";
let user: AppUser;
const previousAuthMode = process.env.AUTH_MODE;
const previousMasterKey = process.env.RUNTIME_CREDENTIAL_MASTER_KEY;

async function binding() {
  return (await getConn().query("SELECT * FROM user_starry_bindings WHERE user_id=$1 AND mailbox_email=$2", [employeeId, mailbox])).rows[0];
}
function read() {
  return withScopedUser(user, () => readAuthorizedOwnershipSnapshot(employeeId));
}

beforeEach(async () => {
  await freshTestDatabase({ reclaimPrevious: true });
  process.env.AUTH_MODE = "enabled";
  process.env.RUNTIME_CREDENTIAL_MASTER_KEY = "52".repeat(32);
  transport.page.mockReset();
  const now = new Date().toISOString();
  const result = await getConn().query(`INSERT INTO users
    (id,username,name,password_hash,roles,brands,active,created_at,updated_at)
    VALUES($1,$1,'Ownership regression','test-only','["employee"]','[]',1,$2,$2) RETURNING *`, [employeeId, now]);
  user = await mapUser(result.rows[0]);
  await saveStarryBinding(employeeId, {
    mailbox_email: mailbox, mailbox_id: "6", owner_name: "Larry",
    owner_open_id: "273", bearer: "test-only-before-rotation",
  });
  // Ensure a real cursor write has a different timestamp even on a fast host.
  await getConn().query("UPDATE user_starry_bindings SET updated_at=$1 WHERE user_id=$2", [bindingVersion, employeeId]);
});
afterEach(async () => {
  transport.page.mockReset();
  await resetConn();
  if (previousAuthMode === undefined) delete process.env.AUTH_MODE;
  else process.env.AUTH_MODE = previousAuthMode;
  if (previousMasterKey === undefined) delete process.env.RUNTIME_CREDENTIAL_MASTER_KEY;
  else process.env.RUNTIME_CREDENTIAL_MASTER_KEY = previousMasterKey;
});

describe("authorized ownership while native mail progress changes", () => {
  it.each(["", "temporary provider failure"])("does not treat a real cursor/receipt write as a rebind (%s)", async (error) => {
    const before = await binding();
    transport.page.mockImplementation(async () => {
      await updateBindingSyncCursorPg({ userId: employeeId, mailbox, syncedAt,
        cursorId: "message-42", pageNo: 2, error, tool: "pageEmailConversations" });
      return { total: 1, list: [{ kolUid: "KOL-A", ownerOpenId: "273", ownerMailbox: mailbox }] };
    });
    await expect(read()).resolves.toMatchObject({ total: 1, scope: "current-user-authorized", rows: [
      { kol_uid: "KOL-A", owner_open_id: "273", owner_mailbox: mailbox },
    ] });
    const after = await binding();
    expect(after.updated_at).toEqual(before.updated_at);
    expect(after.bearer_token).toEqual(before.bearer_token);
    expect(after.owner_open_id).toBe("273");
    expect(after.sync_cursor_id).toBe("message-42");
    expect(Number(after.sync_page_no)).toBe(2);
    expect(after.last_error).toBe(error);
    expect(after.last_tool).toBe("pageEmailConversations");
    expect(after.synced_at).toBeTruthy();
    expect(transport.page).toHaveBeenCalledTimes(2);
  });

  it("still rejects a genuine owner rebind during pagination", async () => {
    transport.page.mockImplementation(async () => {
      await saveStarryBinding(employeeId, { mailbox_email: mailbox, owner_open_id: "197" });
      return { total: 1, list: [{ kolUid: "KOL-A", ownerOpenId: "273" }] };
    });
    await expect(read()).rejects.toThrow("binding_changed");
    expect(transport.page).toHaveBeenCalledTimes(1);
  });

  it("still rejects same-owner credential replacement during pagination", async () => {
    const before = await binding();
    transport.page.mockImplementation(async () => {
      await saveStarryBinding(employeeId, { mailbox_email: mailbox, owner_open_id: "273", bearer: "test-only-after-rotation" });
      return { total: 1, list: [{ kolUid: "KOL-A", ownerOpenId: "273" }] };
    });
    await expect(read()).rejects.toThrow("binding_changed");
    expect((await binding()).bearer_token).not.toEqual(before.bearer_token);
    expect(transport.page).toHaveBeenCalledTimes(1);
  });

  it("still rejects unbinding during pagination before accepting any snapshot", async () => {
    transport.page.mockImplementation(async () => {
      await clearStarryBinding(employeeId, mailbox);
      return { total: 1, list: [{ kolUid: "KOL-A", ownerOpenId: "273" }] };
    });
    await expect(read()).rejects.toThrow("binding_unverified");
    expect(transport.page).toHaveBeenCalledTimes(1);
  });
});
