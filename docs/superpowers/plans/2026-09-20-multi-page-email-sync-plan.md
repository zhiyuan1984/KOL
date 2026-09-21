# Multi-Page Historical Email Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `syncFollowedKolMail` so it can background-sync historical email conversations across multiple pages while keeping the initial response fast.

**Architecture:** Add `sync_page_no` to `user_starry_bindings` for resumable pagination. The foreground path syncs the first 5 conversations of the current page and returns; a background task hydrates the rest of the current page and then iterates subsequent pages until no more data or a page cap is reached.

**Tech Stack:** TypeScript, better-sqlite3/node:sqlite, Vitest, internal MCP mock framework.

**Spec:** `docs/superpowers/specs/2026-09-20-multi-page-email-sync-design.md`

## Global Constraints

- Keep the foreground `syncFollowedKolMail()` return time under ~3 seconds for 1000 ms remote reads.
- Default background page cap: 20 pages (1000 conversations).
- Existing `sync_cursor_at` / `sync_cursor_id` semantics remain unchanged; `sync_page_no` is an additional resumption pointer.
- Must pass `backend/tests/mail-sync-perf.test.ts` and `backend/tests/mail-memory.test.ts`.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `backend/src/db.ts` | Schema + migration for `user_starry_bindings.sync_page_no`. |
| `backend/src/host/mail-memory.ts` | `updateBindingSyncCursor` accepts `pageNo`; `mailboxBoxStatus` exposes `cursor_page_no`. |
| `backend/src/starrykol/mail-sync.ts` | Core multi-page foreground/background sync logic. |
| `backend/tests/mail-sync-perf.test.ts` | New multi-page background-sync test cases. |

---

### Task 1: Add `sync_page_no` column and expose it

**Files:**
- Modify: `backend/src/db.ts:1419-1428`
- Modify: `backend/src/host/mail-memory.ts:264-342`
- Test: `backend/tests/mail-memory.test.ts` (existing tests should still pass)

**Interfaces:**
- Consumes: existing `user_starry_bindings` table.
- Produces: `sync_page_no INTEGER NOT NULL DEFAULT 1` column; `updateBindingSyncCursor({ pageNo?: number })`; `mailboxBoxStatus()` returns `{ ..., cursor_page_no: number | null }`.

- [ ] **Step 1: Add column to schema and migration**

  In `backend/src/db.ts`, in the `CREATE TABLE IF NOT EXISTS user_starry_bindings` block, add:

  ```sql
  sync_page_no INTEGER NOT NULL DEFAULT 1
  ```

  After the existing `add(...)` calls for `sync_cursor_at` / `sync_cursor_id`, add:

  ```ts
  add(db, "user_starry_bindings", "sync_page_no", "INTEGER NOT NULL DEFAULT 1");
  ```

- [ ] **Step 2: Update `updateBindingSyncCursor` to accept and persist `pageNo`**

  In `backend/src/host/mail-memory.ts`:

  ```ts
  export function updateBindingSyncCursor(input: {
    userId?: string;
    mailbox?: string;
    syncedAt: string;
    cursorAt?: string;
    cursorId?: string;
    pageNo?: number;
    error?: string;
    tool?: string;
  }): void {
    // ... existing lookup ...
    getConn().prepare(
      `UPDATE user_starry_bindings
       SET sync_cursor_at=?, sync_cursor_id=?, sync_page_no=?, synced_at=?, last_error=?, last_tool=?, updated_at=?
       WHERE user_id=?`
    ).run(
      input.cursorAt || existing.sync_cursor_at || "",
      input.cursorId || existing.sync_cursor_id || "",
      Number.isFinite(input.pageNo) ? input.pageNo : (existing.sync_page_no ?? 1),
      input.syncedAt,
      input.error || "",
      input.tool || "pageEmailConversations",
      nowIso(),
      userId,
    );
  }
  ```

  Add `page_no?: number` to `StarryBindingRow` type and update `starryBindingRow` select if needed (only if it does not already select `*`).

- [ ] **Step 3: Expose `cursor_page_no` in `mailboxBoxStatus`**

  ```ts
  return {
    // ... existing fields ...
    cursor_page_no: bind?.sync_page_no ?? 1,
  };
  ```

- [ ] **Step 4: Run mail-memory tests**

  Run: `cd backend && npm test -- mail-memory.test.ts`
  Expected: PASS

- [ ] **Step 5: Commit**

  ```bash
  git add backend/src/db.ts backend/src/host/mail-memory.ts
  git commit -m "feat(mail): add sync_page_no binding column and cursor helper"
  ```

---

### Task 2: Refactor mail-sync to read and use `sync_page_no`

**Files:**
- Modify: `backend/src/starrykol/mail-sync.ts:106-155, 591-770`
- Test: `backend/tests/mail-sync-perf.test.ts`

**Interfaces:**
- Consumes: `updateBindingSyncCursor({ pageNo })`, `mailboxBoxStatus().cursor_page_no`.
- Produces: `syncFollowedKolMail()` reads `sync_page_no` as starting page; `scheduleBackgroundSync` receives starting page and pages through results.

- [ ] **Step 1: Read starting page in `syncFollowedKolMail`**

  Near the top of `syncFollowedKolMail`, after reading `mailbox`, read the binding row to get `sync_page_no`:

  ```ts
  const binding = userId
    ? getConn().prepare("SELECT sync_page_no FROM user_starry_bindings WHERE user_id=?").get(userId) as { sync_page_no?: number } | undefined
    : undefined;
  const startPageNo = Number(binding?.sync_page_no ?? 1);
  ```

- [ ] **Step 2: Extract a page-list helper**

  Add inside `mail-sync.ts`:

  ```ts
  async function fetchConversationPage(pageNo: number, pageSize: number, mailbox: string): Promise<{ pageNo: number; pageSize: number; total: number; conversations: Json[] }> {
    const listed = await executeStarryKolTask("email_conversation_list", {
      pageNo,
      pageSize,
      ...(mailbox ? { mailboxEmail: mailbox } : {}),
    }, "host");
    const total = Number(listed.total ?? 0);
    const conversations = listOf(listed.data).filter((conv) => {
      const remoteMailbox = conversationMailboxOf(conv);
      return !mailbox || !remoteMailbox || remoteMailbox.toLowerCase() === mailbox.toLowerCase();
    });
    return { pageNo, pageSize, total, conversations };
  }
  ```

- [ ] **Step 3: Replace single `email_conversation_list` call with the helper for the starting page**

  In `syncFollowedKolMail`, replace:

  ```ts
  const listed = await executeStarryKolTask("email_conversation_list", { pageNo: 1, pageSize: 50, ... }, "host");
  const conversations = listOf(listed.data).filter(...);
  ```

  with:

  ```ts
  const { conversations, total: firstPageTotal } = await fetchConversationPage(startPageNo, 50, mailbox);
  ```

- [ ] **Step 4: Pass remaining pages to background sync**

  Change `scheduleBackgroundSync(remainingCandidates, mailbox)` to `scheduleBackgroundSync(remainingCandidates, mailbox, startPageNo, userId, syncedAt)`.

- [ ] **Step 5: Update `scheduleBackgroundSync` / `syncRemainingConversations` signature**

  ```ts
  function scheduleBackgroundSync(
    remaining: Json[],
    mailbox: string,
    startPageNo: number,
    userId: string,
    syncedAt: string,
  ): Promise<void> { ... }
  ```

  ```ts
  async function syncRemainingConversations(
    remaining: Json[],
    mailbox: string,
    startPageNo: number,
    userId: string,
    syncedAt: string,
  ): Promise<void> { ... }
  ```

- [ ] **Step 6: Run perf tests to confirm no regression**

  Run: `cd backend && npm test -- mail-sync-perf.test.ts`
  Expected: PASS (background still only handles current-page remainder)

- [ ] **Step 7: Commit**

  ```bash
  git add backend/src/starrykol/mail-sync.ts
  git commit -m "refactor(mail): plumb sync_page_no and fetchConversationPage helper"
  ```

---

### Task 3: Implement multi-page background hydration

**Files:**
- Modify: `backend/src/starrykol/mail-sync.ts`
- Test: `backend/tests/mail-sync-perf.test.ts`

**Interfaces:**
- Consumes: `fetchConversationPage`, `hydrateConversationById`, `updateBindingSyncCursor`, `syncRemainingConversations`.
- Produces: background loop that hydrates current-page remainder, then pages forward until exhausted or capped.

- [ ] **Step 1: Hydrate current-page remainder in background**

  In `syncRemainingConversations`, before page-loop, process `remaining` array using existing batch logic (5 at a time).

- [ ] **Step 2: Add page loop after current-page remainder**

  ```ts
  const MAX_BACKGROUND_PAGES = 20;
  const pageSize = 50;
  let pageNo = startPageNo + 1;
  let pagesProcessed = 1; // startPage already counted by foreground
  while (pagesProcessed < MAX_BACKGROUND_PAGES) {
    const { conversations } = await fetchConversationPage(pageNo, pageSize, mailbox);
    if (!conversations.length) break;

    // Persist the fact that we are about to process this page
    updateBindingSyncCursor({ userId, mailbox, syncedAt, pageNo, tool: "pageEmailConversations" });

    const pageCandidates = conversations.filter((conv) => {
      const conversationId = conversationIdOf(conv);
      if (!conversationId) return false;
      // Same logic as foreground detailCandidates filter
      const lookupMailbox = mailbox || conversationMailboxOf(conv);
      const existing = getConn().prepare(
        "SELECT last_at FROM kol_mail_threads WHERE conversation_id=? ORDER BY updated_at DESC LIMIT 1",
      ).get(conversationId) as { last_at?: string } | undefined;
      const bindingRow = lookupMailbox
        ? getConn().prepare("SELECT sync_cursor_at FROM user_starry_bindings WHERE lower(mailbox_email)=lower(?) LIMIT 1")
            .get(lookupMailbox) as { sync_cursor_at?: string } | undefined
        : undefined;
      const unread = Number(conv.unreadCount ?? conv.unread_count);
      const remoteAt = remoteConversationTime(conv);
      const rememberedAt = Math.max(timestampMs(existing?.last_at), timestampMs(bindingRow?.sync_cursor_at));
      return !existing || (Number.isFinite(unread) && unread > 0) || (timestampMs(remoteAt) > rememberedAt);
    });

    for (let i = 0; i < pageCandidates.length; i += 5) {
      const batch = pageCandidates.slice(i, i + 5);
      await mapLimited(batch, 5, async (conv) => {
        const conversationId = conversationIdOf(conv);
        if (!conversationId) return;
        await hydrateConversationById(conversationId);
      });
    }

    if (conversations.length < pageSize) break;
    pageNo += 1;
    pagesProcessed += 1;
  }
  ```

- [ ] **Step 3: Reset page number when background completes**

  After the loop, reset `sync_page_no` to 1 and update cursor:

  ```ts
  updateBindingSyncCursor({ userId, mailbox, syncedAt, pageNo: 1, tool: "pageEmailConversations" });
  ```

- [ ] **Step 4: Handle errors without losing page pointer**

  In `scheduleBackgroundSync`, keep the existing try/catch that logs `starrykol.followed_mail_sync_background_failed`. The `sync_page_no` already written inside the loop will survive, so the next sync resumes from there.

- [ ] **Step 5: Commit**

  ```bash
  git add backend/src/starrykol/mail-sync.ts
  git commit -m "feat(mail): background sync walks multiple conversation pages"
  ```

---

### Task 4: Add multi-page tests

**Files:**
- Modify: `backend/tests/mail-sync-perf.test.ts`
- Modify: `backend/src/starrykol/mail-sync.ts` (if internal helper exports needed for tests)

**Interfaces:**
- Consumes: `syncFollowedKolMail`, `waitForBackgroundSync`, mock MCP.
- Produces: passing tests that prove 3 pages of conversations are all hydrated in background.

- [ ] **Step 1: Update `mockMcp` to support multiple pages**

  Change `mockMcp(readMs, count)` to accept page parameters:

  ```ts
  function mockMcp(readMs: number, totalCount: number, pageSize = 10) {
    conversationId = 1000;
    const allConversations = Array.from({ length: totalCount }, nextConversation);
    const counters = { getEmailConversation: 0 };
    return {
      counters,
      async callTool(name: string, args: Json = {}): Promise<Json> {
        await new Promise((resolve) => setTimeout(resolve, readMs));
        if (name === "pageEmailConversations") {
          const pageNo = Number(args.pageNo ?? 1);
          const ps = Number(args.pageSize ?? pageSize);
          const start = (pageNo - 1) * ps;
          const list = allConversations.slice(start, start + ps);
          return { data: { pageNo, pageSize: ps, total: totalCount, list } };
        }
        // ... getEmailConversation unchanged ...
      },
      async close() {},
    };
  }
  ```

  Update existing `it.each` cases to pass `pageSize` if needed; the default `pageSize=10` keeps tests fast.

- [ ] **Step 2: Add multi-page background test**

  ```ts
  it("hydrates conversations across multiple pages in the background", async () => {
    const mcp = mockMcp(50, 30, 10); // 3 pages of 10
    setEmailMcpClientFactory(() => mcp);
    const start = Date.now();
    const result = await syncFollowedKolMail();
    const elapsed = Date.now() - start;
    expect(result.conversations).toBe(10); // first page list length
    expect(elapsed).toBeLessThan(1000);    // foreground only
    expect(mcp.counters.getEmailConversation).toBe(5);

    await waitForBackgroundSync();
    expect(mcp.counters.getEmailConversation).toBe(30);

    const items = getConn().prepare("SELECT COUNT(*) as c FROM kol_mail_items").get() as { c: number };
    expect(items.c).toBeGreaterThanOrEqual(30);

    const pageNo = getConn().prepare("SELECT sync_page_no FROM user_starry_bindings LIMIT 1").get() as { sync_page_no: number };
    expect(pageNo.sync_page_no).toBe(1);
  });
  ```

- [ ] **Step 3: Add resume-from-page test**

  ```ts
  it("resumes background sync from the last page pointer", async () => {
    const mcp = mockMcp(50, 30, 10);
    setEmailMcpClientFactory(() => mcp);
    // Simulate an interrupted previous run stopped at page 2
    getConn().prepare("UPDATE user_starry_bindings SET sync_page_no=?").run(2);

    await syncFollowedKolMail();
    expect(mcp.counters.getEmailConversation).toBe(5); // page 2 first 5

    await waitForBackgroundSync();
    // page 2 remainder (5) + page 3 (10)
    expect(mcp.counters.getEmailConversation).toBe(20);
  });
  ```

- [ ] **Step 4: Run perf tests**

  Run: `cd backend && npm test -- mail-sync-perf.test.ts`
  Expected: PASS

- [ ] **Step 5: Commit**

  ```bash
  git add backend/tests/mail-sync-perf.test.ts
  git commit -m "test(mail): cover multi-page background sync and resume"
  ```

---

### Task 5: Full verification

**Files:**
- All files above.

- [ ] **Step 1: Run focused mail tests**

  Run: `cd backend && npm test -- mail-sync-perf.test.ts mail-memory.test.ts frontend/src/mail/client.test.ts frontend/src/mail/fallback.test.ts frontend/src/mail/digestView.test.ts mail-fields.test.ts`
  Expected: PASS

- [ ] **Step 2: Self-review spec coverage**

  Check that each spec requirement has a task:
  - [x] `sync_page_no` column — Task 1
  - [x] Foreground still fast — Tasks 2 & 4
  - [x] Background hydrates remainder + subsequent pages — Task 3
  - [x] Page cap / stop conditions — Task 3
  - [x] Resume / reset page pointer — Tasks 1 & 3
  - [x] Tests — Task 4

- [ ] **Step 3: Report completion**

  Summarize changes and test results to the user.
