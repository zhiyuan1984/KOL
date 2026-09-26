# 四栏邮件谈判工作台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `/mail` 从“传统邮箱 + 整條会话铺开”改成四栏工作台：会话列表 → 会话内邮件时间线 → 当前一封邮件 → AI（会话摘要 + 当前邮件翻译）。

**Architecture:** 纯前端改造，复用现有 `GET /api/mail/conversations` 与 `GET /api/mail/conversations/:id`（后者已同时返回会话级 `digest_text` 与 message 级 `messages[]`，每封自带 `translation_zh`）。把选中逻辑抽成纯函数，`Mail.tsx` 只编排状态，渲染下沉到组件。

**Tech Stack:** React 18 + TypeScript + react-router (`useSearchParams`)、Vitest（纯函数）、Playwright（e2e，viewport 1440×900，`page.route` mock `/api/**`）。

**Spec:** `docs/superpowers/specs/2026-09-21-mail-workbench-4col-design.md`

## Global Constraints

- 四栏宽度基准：左导航（全局，不改）/ 列表 **330px** / 正文 **540px** / AI **350px**；`<1024px` 退化为单栏 + 顶部 tabs。
- 配色：页面 `#F7F7F8`、面板 `#FFFFFF`、分隔线 `#ECECF0`、圆角 `8px`、选中背景 `#FFF0F6` + 左侧 `3px` 品牌粉指示条。
- 数据绑定：**会话摘要跟 Conversation ID**（会话内切邮件不刷新）；**原文与翻译跟 Message ID**。
- URL 状态：`?c=<conversation_id>&m=<message_id>`；`m` 缺失或非法时回退该会话最新一封。
- 一级筛选固定为 收件箱 / 发件箱 / 未读 / 已读，不得引入 CRM 阶段。
- 不新增后端接口；不改同步、摘要生成、翻译生成逻辑。
- 测试命令（前端测试经 backend vitest 运行）：
  - 单测：`cd backend && npm test -- frontend/src/mail/<file>.test.ts`
  - e2e：`cd frontend && npx playwright test e2e/mail.spec.ts`
  - 类型检查：`cd frontend && npm run typecheck`

---

### Task 1: 选中解析与时间线纯函数

**Files:**
- Create: `frontend/src/mail/selection.ts`
- Test: `frontend/src/mail/selection.test.ts`

**Interfaces:**
- Consumes: `MailConversation` / `MailMessage`（`frontend/src/mail/types.ts`）。
- Produces:
  - `timelineOf(messages: MailMessage[]): MailMessage[]` — 会话内邮件按 `occurred_at` **新的在前**（缺失时间排最后，稳定保序）。
  - `selectedMessageOf(messages: MailMessage[], focusId: string): MailMessage | null` — 命中 `id` 或 `provider_message_id` 时返回该封，否则返回最新一封（`timelineOf` 的首个），空数组返回 `null`。
  - `selectedConversationOf(conversations: MailConversation[], focusId: string): MailConversation | null` — 命中 `conversation_id` 或 `id` 时返回，否则返回第一个，空数组返回 `null`。

- [ ] **Step 1: 写失败测试**

```ts
// frontend/src/mail/selection.test.ts
import { describe, expect, it } from "vitest";
import { selectedConversationOf, selectedMessageOf, timelineOf } from "./selection";
import type { MailConversation, MailMessage } from "./types";

const msg = (id: string, at: string | null): MailMessage => ({
  id, conversation_id: "3901", direction: "inbound", occurred_at: at,
  from_addr: "amy@example.com", subject: "Re: LiTime collab", snippet: "",
  letter_summary: "", summary_source: "",
});

const conv = (cid: string): MailConversation => ({
  id: `thr_${cid}`, mailbox: "larry.zhao@amperetime.com", conversation_id: cid,
  collaboration_id: null, match_state: "unbound", subject: "s", peer_email: "",
  peer_name: "", last_at: null, last_direction: "", last_preview: "",
  unread_count: 0, digest_source: "",
});

describe("mail selection", () => {
  it("orders the in-conversation timeline newest first", () => {
    const rows = timelineOf([
      msg("m1", "2026-05-20T10:24:00.000Z"),
      msg("m3", "2026-05-22T10:24:00.000Z"),
      msg("m2", "2026-05-21T15:36:00.000Z"),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["m3", "m2", "m1"]);
  });

  it("keeps messages without a timestamp last", () => {
    const rows = timelineOf([msg("m1", null), msg("m2", "2026-05-22T10:24:00.000Z")]);
    expect(rows.map((r) => r.id)).toEqual(["m2", "m1"]);
  });

  it("resolves the focused message, else the newest one", () => {
    const rows = [msg("m3", "2026-05-22T10:24:00.000Z"), msg("m2", "2026-05-21T15:36:00.000Z")];
    expect(selectedMessageOf(rows, "m2")?.id).toBe("m2");
    expect(selectedMessageOf(rows, "missing")?.id).toBe("m3");
    expect(selectedMessageOf([], "m1")).toBeNull();
  });

  it("resolves the focused conversation, else the first one", () => {
    const rows = [conv("3901"), conv("3902")];
    expect(selectedConversationOf(rows, "3902")?.conversation_id).toBe("3902");
    expect(selectedConversationOf(rows, "nope")?.conversation_id).toBe("3901");
    expect(selectedConversationOf([], "3901")).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npm test -- frontend/src/mail/selection.test.ts`
Expected: FAIL（`Failed to resolve import "./selection"`）

- [ ] **Step 3: 实现纯函数**

```ts
// frontend/src/mail/selection.ts
import { occurredAtMs } from "../mail-time";
import type { MailConversation, MailMessage } from "./types";

export function timelineOf(messages: MailMessage[]): MailMessage[] {
  return messages
    .map((message, index) => ({ message, index, at: occurredAtMs(message.occurred_at) }))
    .sort((a, b) => {
      if (a.at === b.at) return a.index - b.index;
      if (!a.at) return 1;
      if (!b.at) return -1;
      return b.at - a.at;
    })
    .map((row) => row.message);
}

export function selectedMessageOf(messages: MailMessage[], focusId: string): MailMessage | null {
  const rows = timelineOf(messages);
  if (!rows.length) return null;
  const key = String(focusId || "").trim();
  if (!key) return rows[0];
  return rows.find((row) => row.id === key || row.provider_message_id === key) || rows[0];
}

export function selectedConversationOf(
  conversations: MailConversation[],
  focusId: string,
): MailConversation | null {
  if (!conversations.length) return null;
  const key = String(focusId || "").trim();
  if (!key) return conversations[0];
  return conversations.find((row) => row.conversation_id === key || row.id === key) || conversations[0];
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && npm test -- frontend/src/mail/selection.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 5: 提交**

```bash
git add frontend/src/mail/selection.ts frontend/src/mail/selection.test.ts
git commit -m "feat(mail): pure selection + timeline helpers for the workbench"
```

---

### Task 2: 第二栏 — 会话行与内联邮件时间线

**Files:**
- Create: `frontend/src/mail/format.ts`（从 `Mail.tsx` 抽出 `formatMailTime` / `initialsOf` / `avatarTone`，供新组件复用）
- Create: `frontend/src/mail/components/ConversationItem.tsx`
- Create: `frontend/src/mail/components/MailTimelineItem.tsx`
- Modify: `frontend/src/pages/Mail.tsx`（列表渲染改为复用这两个组件；新增 `expandedId` 状态与 `?m=` 同步；改为从 `../mail/format` 导入三个工具函数）
- Test: `frontend/e2e/mail.spec.ts`（新增用例）

**Interfaces:**
- Consumes: `timelineOf`（Task 1）、`MailConversation` / `MailMessage`、`formatMailTime` / `initialsOf` / `avatarTone`（本任务抽出）。
- Produces:
  - `frontend/src/mail/format.ts`：`formatMailTime(value?: string | null): string`、`initialsOf(name: string): string`、`avatarTone(seed: string): number`（实现照搬 `Mail.tsx` 现有版本，不改行为）。
  - `ConversationItem({ row, expanded, selected, timeLabel, onToggle })`
  - `MailTimelineItem({ message, selected, timeLabel, onSelect })`
  - `Mail.tsx` 新增 URL 参数 `m`，展开态由 `expandedId` 控制，点击会话行 toggle 展开，点击时间线项写 `?m=`。

- [ ] **Step 1: 写 e2e 失败用例（展开会话露出邮件时间线）**

```ts
// 追加到 frontend/e2e/mail.spec.ts
test("expanding a conversation reveals its mail timeline in the list column", async ({ page }) => {
  await page.route("**/api/mail/box**", async (route) => { await route.fulfill({ json: FORMAL_BOX }); });
  await page.route("**/api/mail/conversations/3901", async (route) => { await route.fulfill({ json: FORMAL_THREAD }); });
  await page.route("**/api/mail/conversations**", async (route) => {
    await route.fulfill({ json: { conversations: [FORMAL_CONVERSATION] } });
  });
  await page.goto("/mail?c=3901");

  const row = page.locator('[data-mail-thread-row="3901"]');
  await expect(row).toBeVisible();
  await expect(page.locator("[data-mail-timeline-item]")).toHaveCount(0);

  await row.click();
  await expect(page.locator("[data-mail-timeline-item]")).toHaveCount(2);
  await expect(page.locator("[data-mail-timeline-item]").first()).toHaveAttribute("data-mail-selected", "true");
});
```

说明：`FORMAL_THREAD` 需要有两封 message 且带 `id` / `occurred_at`；实现本任务时把 `FORMAL_THREAD.messages` 补成两封（见 Step 3）。

- [ ] **Step 2: 跑 e2e 确认失败**

Run: `cd frontend && npx playwright test e2e/mail.spec.ts -g "expanding a conversation"`
Expected: FAIL（`[data-mail-timeline-item]` 计数为 0）

- [ ] **Step 3: 实现两个组件并接入列表**

先把 e2e 的 `FORMAL_THREAD` 补成两封 message（供时间线断言使用）：

```ts
// 更新 frontend/e2e/mail.spec.ts 中已有的 FORMAL_THREAD 常量
const FORMAL_THREAD = {
  entry: "memory",
  kind: "memory",
  creates_session: false,
  creates_turn: false,
  calls_model: false,
  conversation: FORMAL_CONVERSATION,
  digest_text: "对方已确认档期",
  digest_source: "codex_memory",
  hydrating: false,
  messages: [
    {
      id: "m2", conversation_id: "3901", direction: "inbound",
      occurred_at: "2026-09-12T10:00:00.000Z", from_addr: "amy@example.com",
      to_addr: "larry.zhao@amperetime.com", subject: "Re: LiTime collab",
      snippet: "", body_text: "想和贵品牌合作", letter_summary: "", summary_source: "",
      translation_zh: "想和贵品牌合作",
    },
    {
      id: "m1", conversation_id: "3901", direction: "outbound",
      occurred_at: "2026-09-10T09:00:00.000Z", from_addr: "larry.zhao@amperetime.com",
      to_addr: "amy@example.com", subject: "LiTime collab",
      snippet: "", body_text: "Thanks for reaching out.", letter_summary: "", summary_source: "",
      translation_zh: "感谢联系。",
    },
  ],
  digest: { text: "对方已确认档期", source: "codex_memory", mail_count: 2 },
};
```

然后新增两个组件：
```tsx
// frontend/src/mail/components/MailTimelineItem.tsx
import type { MailMessage } from "../types";

export function MailTimelineItem({
  message, selected, timeLabel, onSelect,
}: {
  message: MailMessage;
  selected: boolean;
  timeLabel: string;
  onSelect: () => void;
}) {
  const outbound = message.direction === "outbound";
  return (
    <button
      type="button"
      className={"mail-timeline-item" + (selected ? " is-selected" : "")}
      data-mail-timeline-item={message.id}
      data-mail-selected={selected ? "true" : "false"}
      data-mail-direction={outbound ? "outbound" : "inbound"}
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
    >
      <time className="muted" data-mail-time dateTime={message.occurred_at || undefined}>{timeLabel}</time>
      <span className="mail-timeline-subject" data-mail-timeline-subject>
        {message.subject || "(无主题)"}
      </span>
    </button>
  );
}
```

```tsx
// frontend/src/mail/components/ConversationItem.tsx
import type { MailConversation } from "../types";

export function ConversationItem({
  row, expanded, selected, timeLabel, onToggle,
}: {
  row: MailConversation;
  expanded: boolean;
  selected: boolean;
  timeLabel: string;
  onToggle: () => void;
}) {
  const name = row.peer_name || row.peer_email || "未知对方";
  return (
    <button
      type="button"
      className={"mail-thread-row" + (selected ? " is-selected" : "") + (expanded ? " is-expanded" : "")}
      data-mail-thread-row={row.conversation_id}
      data-mail-match-state={row.match_state}
      data-mail-expanded={expanded ? "true" : "false"}
      aria-expanded={expanded}
      onClick={onToggle}
    >
      <span className="mail-row-avatar" aria-hidden="true">{initialsOf(name)}</span>
      <span className="mail-thread-main">
        <span className="mail-thread-top">
          <strong>{name}</strong>
          <time className="muted" dateTime={row.last_at || undefined}>{timeLabel}</time>
        </span>
        <span className="mail-thread-subject">{row.subject || "(无主题)"}</span>
        <span className="muted mail-thread-preview">{row.last_preview}</span>
      </span>
      {row.unread_count > 0 ? <span className="mail-unread-dot" aria-label="未读" /> : null}
    </button>
  );
}
```

`Mail.tsx` 列表区把现有内联的会话行渲染替换为：

```tsx
{visibleConversations.map((row) => {
  const expanded = expandedId === row.conversation_id;
  return (
    <div key={row.conversation_id} className="mail-thread-block">
      <ConversationItem
        row={row}
        expanded={expanded}
        selected={selected?.conversation_id === row.conversation_id}
        timeLabel={formatMailTime(row.last_at)}
        onToggle={() => setExpandedId(expanded ? "" : row.conversation_id)}
      />
      {expanded ? (
        <div className="mail-timeline" data-mail-timeline>
          {timelineOf(thread?.messages || []).map((message) => (
            <MailTimelineItem
              key={message.id}
              message={message}
              selected={currentMessage?.id === message.id}
              timeLabel={formatMailTime(message.occurred_at)}
              onSelect={() => selectMessage(message)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
})}
```

`selectMessage` / `currentMessage` 见 Task 3；本任务先接 `expandedId` 与时间线渲染，`selectMessage` 暂写 URL：

```tsx
const selectMessage = (message: MailMessage) => {
  const next = new URLSearchParams(params);
  next.set("c", message.conversation_id);
  next.set("m", message.id);
  setParams(next, { replace: true });
};
```

- [ ] **Step 4: 跑 e2e 确认通过**

Run: `cd frontend && npx playwright test e2e/mail.spec.ts -g "expanding a conversation"`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add frontend/src/mail/components frontend/src/pages/Mail.tsx frontend/e2e/mail.spec.ts
git commit -m "feat(mail): conversation list with inline in-conversation mail timeline"
```

---

### Task 3: 第三栏 — 只渲染当前一封邮件

**Files:**
- Create: `frontend/src/mail/components/MailContent.tsx`
- Modify: `frontend/src/pages/Mail.tsx`（正文区改为单封；`currentMessage` 由 `selectedMessageOf` 解析；`?m=` 驱动）
- Test: `frontend/e2e/mail.spec.ts`

**Interfaces:**
- Consumes: `selectedMessageOf`（Task 1）。
- Produces: `MailContent({ message, peerName, peerEmail, ownerName, mailbox })`；`Mail.tsx` 暴露 `data-mail-content` 与 `data-mail-content-id`（= 当前邮件 id）。

- [ ] **Step 1: 写 e2e 失败用例（切邮件只换第三栏，摘要不动）**

```ts
test("selecting another mail switches only the content and translation columns", async ({ page }) => {
  await page.route("**/api/mail/box**", async (route) => { await route.fulfill({ json: FORMAL_BOX }); });
  await page.route("**/api/mail/conversations/3901", async (route) => { await route.fulfill({ json: FORMAL_THREAD }); });
  await page.route("**/api/mail/conversations**", async (route) => {
    await route.fulfill({ json: { conversations: [FORMAL_CONVERSATION] } });
  });
  await page.goto("/mail?c=3901");

  await page.locator('[data-mail-thread-row="3901"]').click();
  await expect(page.locator("[data-mail-content]")).toHaveCount(1);

  const summaryBefore = await page.locator("[data-mail-summary-body]").innerText();
  const firstId = await page.locator("[data-mail-content]").getAttribute("data-mail-content-id");

  await page.locator("[data-mail-timeline-item]").nth(1).click();
  await expect(page.locator("[data-mail-content]")).not.toHaveAttribute("data-mail-content-id", firstId || "");
  await expect(page.locator("[data-mail-summary-body]")).toHaveText(summaryBefore);
});
```

- [ ] **Step 2: 跑 e2e 确认失败**

Run: `cd frontend && npx playwright test e2e/mail.spec.ts -g "switches only the content"`
Expected: FAIL（`[data-mail-content]` 拿到多封或不存在）

- [ ] **Step 3: 实现 MailContent 并替换正文区**

```tsx
// frontend/src/mail/components/MailContent.tsx
import type { MailMessage } from "../types";

export function MailContent({
  message, peerName, peerEmail, ownerName, mailbox, timeLabel,
}: {
  message: MailMessage;
  peerName: string;
  peerEmail: string;
  ownerName: string;
  mailbox: string;
  timeLabel: string;
}) {
  const inbound = message.direction !== "outbound";
  const body = String(message.body_text || "").trim();
  const senderName = inbound ? peerName || mailbox || "对方" : ownerName || mailbox || "我方";
  const senderEmail = message.from_addr || (inbound ? peerEmail : mailbox);
  const toAddr = message.to_addr || (inbound ? mailbox : peerEmail);
  return (
    <article
      className={"mail-content" + (inbound ? " is-in" : " is-out")}
      data-mail-content
      data-mail-content-id={message.id}
      data-mail-direction={inbound ? "inbound" : "outbound"}
    >
      <h2 className="mail-content-subject" data-mail-content-subject>{message.subject || "(无主题)"}</h2>
      <header className="mail-content-meta">
        <span className="mail-row-avatar" aria-hidden="true">{initialsOf(senderName)}</span>
        <div className="mail-content-who">
          <strong>{senderName}</strong>
          {senderEmail ? <span className="muted">{`<${senderEmail}>`}</span> : null}
          <span className="muted">发送给: {toAddr || "—"}</span>
        </div>
        <time className="muted" dateTime={message.occurred_at || undefined}>{timeLabel}</time>
      </header>
      {message.letter_summary ? <p className="mail-content-summary">{message.letter_summary}</p> : null}
      {body ? (
        <div className="mail-content-body" data-mail-body><p>{body}</p></div>
      ) : (
        <p className="muted" data-mail-empty>正文未缓存。点「收取」后可再打开，不会现场拉 Starry。</p>
      )}
    </article>
  );
}
```

`Mail.tsx` 正文区：

```tsx
{currentMessage ? (
  <MailContent
    message={currentMessage}
    peerName={selected?.peer_name || ""}
    peerEmail={selected?.peer_email || ""}
    ownerName={box?.owner_name || ""}
    mailbox={selected?.mailbox || box?.mailbox || ""}
    timeLabel={formatMailTime(currentMessage.occurred_at)}
  />
) : (
  <p className="muted" data-mail-thread-empty>{threadError || "选择左侧会话查看时间线。"}</p>
)}
```

`currentMessage` 改为：

```tsx
const currentMessage = useMemo(
  () => selectedMessageOf(thread?.messages || [], params.get("m") || ""),
  [thread, params],
);
```

删除 `MailMessageCard` 与本任务被替换的旧正文渲染代码；`MailDigestStrip` 若不再被引用则一并删除。

- [ ] **Step 4: 跑 e2e 确认通过（含既有断言更新）**

既有断言 `await expect(page.locator("[data-mail-body]")).toHaveCount(1)` 仍然成立（单封）。

Run: `cd frontend && npx playwright test e2e/mail.spec.ts`
Expected: PASS（若其他用例断言多封 body，按“当前一封”更新计数）

- [ ] **Step 5: 提交**

```bash
git add frontend/src/mail/components/MailContent.tsx frontend/src/pages/Mail.tsx frontend/e2e/mail.spec.ts
git commit -m "feat(mail): content column renders only the selected mail"
```

---

### Task 4: 第四栏 — 会话摘要文案与语义修正

**Files:**
- Create: `frontend/src/mail/components/ConversationSummary.tsx`
- Create: `frontend/src/mail/components/TranslationPanel.tsx`
- Modify: `frontend/src/pages/Mail.tsx`（侧栏改用这两个组件；`summary` 传 `thread.digest`，`translation` 传 `currentMessage`）
- Test: `frontend/e2e/mail.spec.ts`

**Interfaces:**
- Consumes: `MailDigest`、`MailMessage.translation_zh`、`mailDigestView`。
- Produces: `ConversationSummary({ digest, updatedLabel })`、`TranslationPanel({ message })`；`data-mail-summary-card` / `data-mail-translation` 契约保持不变，标题文案改为「✦ 会话摘要」。

- [ ] **Step 1: 写 e2e 失败用例（标题为会话摘要，且不随邮件切换）**

```ts
test("the assistant column titles the summary as conversation-level", async ({ page }) => {
  await page.route("**/api/mail/box**", async (route) => { await route.fulfill({ json: FORMAL_BOX }); });
  await page.route("**/api/mail/conversations/3901", async (route) => { await route.fulfill({ json: FORMAL_THREAD }); });
  await page.route("**/api/mail/conversations**", async (route) => {
    await route.fulfill({ json: { conversations: [FORMAL_CONVERSATION] } });
  });
  await page.goto("/mail?c=3901");
  await page.locator('[data-mail-thread-row="3901"]').click();

  await expect(page.locator("[data-mail-summary-card]")).toContainText("会话摘要");
  await expect(page.locator("[data-mail-summary-card]")).not.toContainText("中文摘要");
  const summaryBefore = await page.locator("[data-mail-summary-body]").innerText();

  await page.locator("[data-mail-timeline-item]").nth(1).click();
  await expect(page.locator("[data-mail-summary-card]")).toContainText("会话摘要");
  await expect(page.locator("[data-mail-summary-body]")).toHaveText(summaryBefore);
});
```

- [ ] **Step 2: 跑 e2e 确认失败**

Run: `cd frontend && npx playwright test e2e/mail.spec.ts -g "conversation-level"`
Expected: FAIL（仍含「中文摘要」）

- [ ] **Step 3: 实现两个组件并替换侧栏**

```tsx
// frontend/src/mail/components/ConversationSummary.tsx
import Markdown from "../../components/Markdown";
import type { MailDigest } from "../types";

export function ConversationSummary({ digest, updatedLabel }: { digest: MailDigest | null; updatedLabel?: string }) {
  const text = String(digest?.text || "").trim();
  return (
    <section className="mail-side-card" data-mail-summary-card>
      <header className="mail-side-card-head">
        <strong>✦ 会话摘要</strong>
        <span className="mail-side-tag">AI 生成</span>
      </header>
      {text ? (
        <div className="mail-side-body" data-mail-summary-body><Markdown>{text}</Markdown></div>
      ) : (
        <p className="muted" data-mail-summary-pending>摘要生成中…点「收取」后可再试。</p>
      )}
      {updatedLabel ? <small className="muted" data-mail-summary-updated>更新于 {updatedLabel}</small> : null}
    </section>
  );
}
```

```tsx
// frontend/src/mail/components/TranslationPanel.tsx
import { useMemo, useState } from "react";
import type { MailMessage } from "../types";

export function TranslationPanel({ message }: { message: MailMessage | null }) {
  const [copied, setCopied] = useState(false);
  const translation = String(message?.translation_zh || "").trim();
  const paragraphs = useMemo(
    () => translation.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean),
    [translation],
  );
  const copy = () => {
    if (!translation) return;
    void navigator.clipboard?.writeText(translation)
      .then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600); })
      .catch(() => undefined);
  };
  return (
    <section className="mail-side-card mail-translation" data-mail-translation data-mail-translation-for={message?.id || ""}>
      <header className="mail-side-card-head">
        <strong>译 中文翻译</strong>
        <button type="button" className="mail-copy-btn" data-mail-copy-translation disabled={!translation} onClick={copy}>
          {copied ? "已复制" : "复制翻译"}
        </button>
      </header>
      {paragraphs.length ? (
        <div className="mail-side-body" data-mail-translation-body>
          {paragraphs.map((p, i) => <p key={i}>{p}</p>)}
        </div>
      ) : (
        <p className="muted" data-mail-translation-pending>翻译生成中…</p>
      )}
    </section>
  );
}
```

`Mail.tsx` 侧栏：

```tsx
<aside className="mail-side" data-mail-side>
  <ConversationSummary digest={thread?.digest || null} updatedLabel={formatMailTime(selected?.last_at)} />
  <TranslationPanel message={currentMessage} />
</aside>
```

删除旧的 `MailSummaryCard` / `MailTranslationCard`。

- [ ] **Step 4: 跑 e2e 确认通过**

Run: `cd frontend && npx playwright test e2e/mail.spec.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add frontend/src/mail/components frontend/src/pages/Mail.tsx frontend/e2e/mail.spec.ts
git commit -m "feat(mail): conversation-level summary card and message-level translation panel"
```

---

### Task 5: 顶部 MailboxSwitcher 下拉

**Files:**
- Create: `frontend/src/mail/components/MailboxSwitcher.tsx`
- Modify: `frontend/src/pages/Mail.tsx`（替换平铺 chips 与 `mail-boxbar-actions`）
- Modify: `frontend/src/styles.css`（`mail-boxbar` 相关规则收敛为切换器样式）
- Test: `frontend/e2e/mail.spec.ts`

**Interfaces:**
- Consumes: `MailBoxBinding[]`、`activeBox`、`onSelect(binding)`、`onSync()`、`syncing`、`loadState`。
- Produces: `MailboxSwitcher`；渲染 `data-mail-box-current`（当前邮箱行）、`data-mail-box-menu`（展开菜单）、`data-mail-addbox` / `data-mail-boxsettings` 保持不变。

- [ ] **Step 1: 写 e2e 失败用例（默认只显示当前邮箱，展开菜单列出全部）**

```ts
const TWO_BOXES = {
  ...FORMAL_BOX,
  bindings: [
    { mailbox: "larry.zhao@amperetime.com", label: "美国邮箱", owner_name: "赵良玉", unread: 12, bound: true, synced_at: FORMAL_BOX.synced_at, error: null },
    { mailbox: "eu@litime.com", label: "欧洲邮箱", owner_name: "李四", unread: 3, bound: true, synced_at: FORMAL_BOX.synced_at, error: null },
  ],
};

test("the mailbox switcher shows only the current mailbox until opened", async ({ page }) => {
  await page.route("**/api/mail/box**", async (route) => { await route.fulfill({ json: TWO_BOXES }); });
  await page.route("**/api/mail/conversations**", async (route) => { await route.fulfill({ json: { conversations: [] } }); });
  await page.goto("/mail");

  await expect(page.locator("[data-mail-box-current]")).toContainText("larry.zhao@amperetime.com");
  await expect(page.locator("[data-mail-box-menu]")).toHaveCount(0);

  await page.locator("[data-mail-box-current]").click();
  await expect(page.locator("[data-mail-box-menu]")).toBeVisible();
  await expect(page.locator('[data-mail-box-option="eu@litime.com"]')).toContainText("欧洲邮箱");
});
```

- [ ] **Step 2: 跑 e2e 确认失败**

Run: `cd frontend && npx playwright test e2e/mail.spec.ts -g "mailbox switcher"`
Expected: FAIL（`[data-mail-box-current]` 不存在）

- [ ] **Step 3: 实现 MailboxSwitcher 并替换顶部邮箱区**

```tsx
// frontend/src/mail/components/MailboxSwitcher.tsx
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { MailBoxBinding } from "../types";

export function MailboxSwitcher({
  current, bindings, syncing, onSelect, onSync,
}: {
  current: string;
  bindings: MailBoxBinding[];
  syncing: boolean;
  onSelect: (binding: MailBoxBinding) => void;
  onSync: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const active = bindings.find((b) => b.mailbox === current) || bindings[0];
  return (
    <div className="mail-switcher" ref={ref}>
      <button
        type="button"
        className="mail-switcher-current"
        data-mail-box-current
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={"mail-box-dot" + (active?.error ? " is-error" : " is-ok")} aria-hidden="true" />
        <span className="mail-switcher-name">{active?.label || active?.mailbox || "选择邮箱"}</span>
        <span className="muted mail-switcher-addr">{active?.mailbox || ""}</span>
        {active && active.unread > 0 ? <span className="mail-count-pill">{active.unread}</span> : null}
        <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div className="mail-switcher-menu" data-mail-box-menu>
          <p className="muted mail-switcher-title">切换邮箱</p>
          {bindings.map((binding) => (
            <button
              key={binding.mailbox}
              type="button"
              className={"mail-switcher-option" + (binding.mailbox === current ? " is-active" : "")}
              data-mail-box-option={binding.mailbox}
              onClick={() => { onSelect(binding); setOpen(false); }}
            >
              <span className={"mail-box-dot" + (binding.error ? " is-error" : " is-ok")} aria-hidden="true" />
              <span className="mail-switcher-option-main">
                <strong>{binding.label || binding.mailbox}</strong>
                <span className="muted">{binding.mailbox}</span>
              </span>
              {binding.unread > 0 ? <span className="mail-count-pill">{binding.unread}</span> : null}
            </button>
          ))}
          <div className="mail-switcher-foot">
            <Link className="btn ghost" to="/settings?tab=starry" data-mail-addbox>＋ 添加邮箱</Link>
            <Link className="btn ghost" to="/settings?tab=starry" data-mail-boxsettings>⚙ 邮箱设置</Link>
          </div>
        </div>
      ) : null}
      <button type="button" className="btn work" data-mail-sync data-mail-entry="sync-mailbox-mail" disabled={syncing} onClick={onSync}>
        {syncing ? "正在收取…" : "收取"}
      </button>
    </div>
  );
}
```

`Mail.tsx` 顶部用 `<MailboxSwitcher current={activeBox} bindings={bindings} syncing={syncing} onSelect={openBox} onSync={sync} />` 替换原 `mail-boxbar` 区块；`openBox` 保持写 `?box=`。

- [ ] **Step 4: 跑 e2e 确认通过**

Run: `cd frontend && npx playwright test e2e/mail.spec.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add frontend/src/mail/components/MailboxSwitcher.tsx frontend/src/pages/Mail.tsx frontend/src/styles.css frontend/e2e/mail.spec.ts
git commit -m "feat(mail): mailbox switcher replaces the flat chip row"
```

---

### Task 6: 四栏布局、配色与选中态

**Files:**
- Modify: `frontend/src/styles.css`（`.mail-split` 栅格、`.mail-thread-row` / `.mail-timeline-item` 选中态、去嵌套卡片、四栏分隔线）
- Test: `frontend/e2e/mail.spec.ts`（几何断言）

**Interfaces:**
- Consumes: Task 2–5 产出的 `data-mail-*` 契约。
- Produces: 四栏宽度 330 / 540 / 350（1440 viewport）；选中行背景 `rgb(255, 240, 246)` 与 3px 左指示条。

- [ ] **Step 1: 写 e2e 失败用例（栏宽与选中态）**

```ts
test("four-column workbench geometry and selected state", async ({ page }) => {
  await page.route("**/api/mail/box**", async (route) => { await route.fulfill({ json: FORMAL_BOX }); });
  await page.route("**/api/mail/conversations/3901", async (route) => { await route.fulfill({ json: FORMAL_THREAD }); });
  await page.route("**/api/mail/conversations**", async (route) => {
    await route.fulfill({ json: { conversations: [FORMAL_CONVERSATION] } });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/mail?c=3901");
  await page.locator('[data-mail-thread-row="3901"]').click();

  const list = await page.locator("[data-mail-list]").boundingBox();
  const content = await page.locator("[data-mail-content]").boundingBox();
  const side = await page.locator("[data-mail-side]").boundingBox();
  expect(list?.width).toBeGreaterThanOrEqual(320);
  expect(list?.width).toBeLessThanOrEqual(345);
  expect(content?.width).toBeGreaterThanOrEqual(500);
  expect(side?.width).toBeGreaterThanOrEqual(340);

  const selected = page.locator("[data-mail-timeline-item][data-mail-selected='true']");
  await expect(selected).toHaveCount(1);
  const bg = await selected.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe("rgb(255, 240, 246)");
  const border = await selected.evaluate((el) => getComputedStyle(el).borderLeftWidth);
  expect(border).toBe("3px");
});
```

- [ ] **Step 2: 跑 e2e 确认失败**

Run: `cd frontend && npx playwright test e2e/mail.spec.ts -g "four-column workbench"`
Expected: FAIL（宽度或选中样式不符）

- [ ] **Step 3: 调整样式**

```css
.mail-split {
  display: grid;
  grid-template-columns: 330px minmax(0, 1fr) 350px; /* 1440 基准：540 给正文 */
  gap: 0;
  border: 1px solid #ECECF0;
  border-radius: 8px;
  background: #FFFFFF;
  overflow: hidden;
}
.mail-list { border-right: 1px solid #ECECF0; }
.mail-side { border-left: 1px solid #ECECF0; padding: 12px; background: #FFFFFF; }
.mail-thread-row.is-selected,
.mail-timeline-item.is-selected {
  background: #FFF0F6;
  box-shadow: inset 3px 0 0 var(--brand, #E8407A);
}
.mail-timeline-item {
  display: grid;
  gap: 2px;
  width: 100%;
  text-align: left;
  padding: 8px 12px 8px 22px;
  border: 0;
  border-left: 3px solid transparent;
  background: none;
  cursor: pointer;
}
.mail-page { background: #F7F7F8; }

@media (max-width: 1439px) {
  .mail-split { grid-template-columns: 300px minmax(0, 1fr) 320px; }
}
@media (max-width: 1023px) {
  .mail-split { grid-template-columns: minmax(0, 1fr); }
  .mail-side { display: none; }
}
```

同时移除 `mail-message` 卡片嵌套样式与旧 `mail-hero` 内多余容器（保留标题与副标题）。

- [ ] **Step 4: 跑 e2e 确认通过**

Run: `cd frontend && npx playwright test e2e/mail.spec.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add frontend/src/styles.css frontend/e2e/mail.spec.ts
git commit -m "style(mail): four-column geometry, flat surfaces and selected-row treatment"
```

---

### Task 7: 关键链路 e2e 与全量回归

**Files:**
- Modify: `frontend/e2e/mail.spec.ts`（新增完整链路用例）
- Test: 全部相关套件

**Interfaces:**
- Consumes: Tasks 1–6 的全部契约。
- Produces: 覆盖“切换邮箱 → 选择会话 → 展开时间线 → 选择邮件 → 原文/翻译切换、摘要不动”的单条端到端用例。

- [ ] **Step 1: 写完整链路 e2e 用例**

说明：`TWO_BOXES` 在 Task 5 的用例中已定义，直接复用同一常量。

```ts
test("mail negotiation workbench: mailbox to conversation to mail, summary stays", async ({ page }) => {
  await page.route("**/api/mail/box**", async (route) => { await route.fulfill({ json: TWO_BOXES }); });
  await page.route("**/api/mail/conversations/3901", async (route) => { await route.fulfill({ json: FORMAL_THREAD }); });
  await page.route("**/api/mail/conversations**", async (route) => {
    await route.fulfill({ json: { conversations: [FORMAL_CONVERSATION] } });
  });
  await page.goto("/mail");

  // 1) 切换邮箱
  await page.locator("[data-mail-box-current]").click();
  await page.locator('[data-mail-box-option="larry.zhao@amperetime.com"]').click();
  await expect(page).toHaveURL(/box=larry\.zhao%40amperetime\.com/);

  // 2) 选择会话并展开时间线
  await page.locator('[data-mail-thread-row="3901"]').click();
  await expect(page.locator("[data-mail-timeline-item]")).toHaveCount(2);

  // 3) 选择第二封 → 原文与翻译切换
  const summaryBefore = await page.locator("[data-mail-summary-body]").innerText();
  await page.locator("[data-mail-timeline-item]").nth(1).click();
  await expect(page).toHaveURL(/m=/);
  await expect(page.locator("[data-mail-content]")).toHaveCount(1);
  await expect(page.locator("[data-mail-translation]")).toHaveAttribute("data-mail-translation-for", /.+/);

  // 4) 会话摘要不随邮件切换
  await expect(page.locator("[data-mail-summary-body]")).toHaveText(summaryBefore);
});
```

- [ ] **Step 2: 跑该用例确认失败（若前面任务已完备则应直接通过；失败则修到通过）**

Run: `cd frontend && npx playwright test e2e/mail.spec.ts -g "negotiation workbench"`
Expected: PASS

- [ ] **Step 3: 全量回归**

Run: `cd frontend && npx playwright test e2e/mail.spec.ts`
Run: `cd backend && npm test -- frontend/src/mail/client.test.ts frontend/src/mail/selection.test.ts frontend/src/mail/fallback.test.ts frontend/src/mail/digestView.test.ts`
Run: `cd frontend && npm run typecheck`
Expected: 全部 PASS

- [ ] **Step 4: 提交**

```bash
git add frontend/e2e/mail.spec.ts
git commit -m "test(mail): end-to-end coverage for the negotiation workbench flow"
```

---

### Task 8: 部署与真机验证

**Files:** 无代码改动（部署 + 验证）

- [ ] **Step 1: 推送并部署**

```bash
git push github HEAD:main
ssh kol "cd ~/kol && ./scripts/deploy.sh --sync"
```

说明：服务器由 systemd 托管。`scripts/deploy.sh` 会先同步 `github/main`，在旧进程仍对外服务时把前端构建到 `frontend/dist.new` 并原子替换 `frontend/dist`，最后 `sudo systemctl restart lingong`；重启只花几秒，期间 nginx 返回 `ops/nginx/booting.html` 等待页。不要直接跑 `scripts/start.sh`，也不要用 `kill` 释放 8765（会和 systemd 互杀，并把重启拖成 60–90 秒）。

- [ ] **Step 2: 验证接口与页面**

```bash
curl -s http://47.88.94.205/api/version
curl -s -b ext.cookie -H "Accept-Encoding: gzip" -o /dev/null -w "%{time_total}s %{size_download}B\n" http://47.88.94.205/api/mail/conversations
```

- [ ] **Step 3: 浏览器验证四栏与交互**

打开 `http://47.88.94.205/mail`，确认：四栏宽度、展开会话时间线、点击邮件后第三/四栏切换、会话摘要不变、邮箱下拉只显示当前邮箱。

- [ ] **Step 4: 汇报**

报告版本号、接口耗时/体积、e2e 结果与截图结论。
