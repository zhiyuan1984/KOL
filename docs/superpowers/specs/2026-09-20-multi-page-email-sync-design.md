# 多页历史邮件同步设计

## 目标

让通讯模块能够后台完整记忆超过当前 50 条列表页的历史往来邮件，同时保持首次打开页面时的响应速度。

## 当前状态

- `syncFollowedKolMail()` 只拉 `pageNo=1, pageSize=50` 的会话列表。
- 对第 1 页中的候选会话，前 5 个立即拉完整详情并返回；剩余部分由 `scheduleBackgroundSync` 分批补全。
- `user_starry_bindings` 已存在 `sync_cursor_at` / `sync_cursor_id` 字段，用于记录最近一次同步的时间游标。
- 没有持久化的分页状态：后台同步一旦中断，下次只能从第 1 页重新开始。

## 设计方案

### 1. 数据模型变化

在 `user_starry_bindings` 表新增字段：

```sql
sync_page_no INTEGER NOT NULL DEFAULT 1
```

语义：下一次同步应当从哪一页开始拉取列表。

- 首次同步或重置后：`sync_page_no = 1`
- 第 1 页前 5 个立即同步返回后：后台任务继续处理第 1 页剩余会话；第 1 页处理完，**列表**进入第 2 页时，将 `sync_page_no` 更新为 `2`
- 所有页处理完成或达到上限后：将 `sync_page_no` 重置为 `1`，并更新时间游标

### 2. 同步流程

#### 首次/前台路径 `syncFollowedKolMail()`

1. 从 `user_starry_bindings` 读取当前 `sync_page_no`（默认 1）。
2. 拉取该页列表。
3. 按现有规则筛选 `detailCandidates`。
4. 前 5 个立即拉详情，执行主循环写入 `kol_mail_threads` / `kol_mail_items`。
5. 返回结果给前端。
6. 启动后台任务：
   - 先补全当前页剩余会话；
   - 然后循环拉取 `sync_page_no + 1, sync_page_no + 2, ...` 各页列表，每页都筛选候选并同步详情；
   - 每进入新页，更新 `sync_page_no`；
   - 直到 `rows.length < pageSize` 或 `pageNo * pageSize >= total` 或达到上限（默认 20 页）。
7. 全部完成后，重置 `sync_page_no = 1`，并写入新的 `cursor_at` / `cursor_id`。

#### 后台任务 `scheduleBackgroundSync()`

- 仍使用模块级 `backgroundSyncTask` 保证单实例。
- 后台任务接收当前页剩余候选 + 当前页码 + 邮箱 + 用户上下文。
- 对每一新页，复用现有 `detailCandidates` 筛选逻辑和 `hydrateConversationById` 补全逻辑。
- 错误处理：单页失败记录 audit 日志，不中断后续页面；整体失败也记录 audit 并保留当前 `sync_page_no`。

### 3. 边界与限制

- **页数上限**：默认最多 20 页（1000 个会话），防止远端数据量过大或 rate limit。
- **单页详情上限**：每页仍只处理前 5 个详情立即返回；后台处理该页剩余 + 后续各页。
- **并发**：每页内部仍使用 5 并发拉详情。
- **排序假设**：假设 `pageEmailConversations` 按时间倒序返回，后续页越来越旧。
- **mailbox 过滤**：每页列表仍需按 `mailboxEmail` 过滤（现有逻辑保留）。

### 4. 接口变化

- `updateBindingSyncCursor` 增加可选 `pageNo?: number` 参数。
- `MailBoxStatus` 增加可选 `cursor_page_no?: number` 字段（便于前端/调试查看）。
- 新增内部函数 `syncPageConversations(pageNo, pageSize, mailbox)` 封装单页列表拉取。

### 5. 测试计划

- 扩展 `backend/tests/mail-sync-perf.test.ts`：
  - mock `pageEmailConversations` 支持多页返回；
  - 验证 `syncFollowedKolMail()` 仍快速返回（<3s）；
  - 等待 `waitForBackgroundSync()` 后，验证所有页（如 3 页 × 10 条 = 30 条）的详情都被拉取；
  - 验证 `sync_page_no` 最终被重置为 1。
- 验证 `user_starry_bindings.sync_page_no` 在后台进入新页时被正确更新。

### 6. 文件改动

- `backend/src/db.ts`：新增 `sync_page_no` 字段及迁移。
- `backend/src/host/mail-memory.ts`：`updateBindingSyncCursor` / `mailboxBoxStatus` 支持 page_no。
- `backend/src/starrykol/mail-sync.ts`：核心多页同步逻辑。
- `backend/tests/mail-sync-perf.test.ts`：多页测试用例。

## 风险

- 远端 `pageEmailConversations` 的 `total` 字段可能不准确，需同时判断 `rows.length < pageSize`。
- 后台任务运行时间变长；若服务重启，依赖 `sync_page_no` 断点续传。
- 多页同步时，每页都需要重新筛选 `detailCandidates`，可能重复处理跨页边界会话（取决于远端分页稳定性）。
