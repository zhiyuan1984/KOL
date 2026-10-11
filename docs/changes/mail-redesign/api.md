# 邮件会话私有手工标签 API

**实现资产：** `backend/src/mail/labels.ts`，PostgreSQL migration `035_20261012_mail_private_labels.sql`。这是当前人员对已绑定邮箱中已授权会话的**私有整理偏好**，不是共享部门标签，也不读取或修改合作阶段、发信、Agent session、turn 或模型。

## 访问前提

每个请求都从当前 `scopedUser` 取人员身份；此接口没有 `AUTH_MODE=disabled` 或演示账号回退。服务端在读取和写入前均会检查：

1. 请求的 `box` 是当前用户状态为 `connected` 的邮箱绑定；
2. 若给出/写入 `conversation_id`，该会话当前存在于此邮箱；
3. 标签 ID 同时属于当前用户和该邮箱。跨用户或跨邮箱 ID 以 `404 label_not_found` 返回，避免字典探测。

撤销邮箱绑定后，读、写都会返回 `403 mailbox_access_denied`。

## 查询

`GET /api/queries/mail.labels?box=<邮箱>[&conversation_id=<会话ID>]`

成功响应是 memory envelope：

```json
{
  "entry": "memory",
  "kind": "memory",
  "creates_session": false,
  "creates_turn": false,
  "calls_model": false,
  "mailbox": "operator@example.com",
  "labels": [{ "id": "mlbl_…", "name": "待跟进", "count": 2 }],
  "assignments": [{ "conversation_id": "conv_1", "label_ids": ["mlbl_…"] }],
  "selected_label_ids": ["mlbl_…"],
  "version": 3
}
```

`labels` 仅为该人员、该邮箱的真实字典。`count` 与 `assignments` 仅计算当前仍存在于该邮箱的会话；历史残留赋标不会显示。`version` 是**人员 + 邮箱级** revision（不是会话级）：未传 `conversation_id` 时，`selected_label_ids` 为 `[]`，并返回该邮箱当前 revision；若该邮箱没有状态行则为 `0`。读取在一致 PostgreSQL snapshot 中投影，不混用不同 revision 的目录、赋标和版本。

## 写入

`POST /api/actions/mail.label`

```json
{
  "box": "operator@example.com",
  "conversation_id": "conv_1",
  "mode": "add",
  "name": "待跟进",
  "expected_version": 0,
  "confirm": true
}
```

字段：

| 字段 | 规则 |
|---|---|
| `box` / `conversation_id` | 必填，必须是当前人员已绑定邮箱和其中现存会话。|
| `mode` | 只能是 `add` 或 `remove`。|
| `name` / `label_id` | 二选一。`name` 经 `trim`、NFKC 归一，不能为空、不含控制字符、最多 40 Unicode code points；按大小写归一去重。`label_id` 必须是本人员本邮箱的字典项。|
| `expected_version` | 必填非负整数；与此人员此邮箱的当前版本不一致时返回 `409 version_conflict`。|
| `confirm` | 必须严格为 `true`，否则返回 `400 confirmation_required`。|

成功响应是 command envelope，附带 `{ok:true, mailbox, conversation_id, labels, assignments, label_ids, version}`；`labels`、`assignments` 是写后该邮箱的完整当前投影，`label_ids` 是当前会话选择。

`add` 同一标签与 `remove` 已不存在的赋标都不会创建重复记录或删除字典/邮件；在当前版本下它们不增加版本。新建字典或实际赋标/解绑会使该人员该邮箱的版本加一。写入事务会锁定当前邮箱绑定、会话与邮箱版本行，校验版本后在**同一事务 snapshot** 中形成回执，再将操作者、邮箱、会话、标签、前后版本写入 `mail_sync_audit`；因此成功回执的目录、赋标、`label_ids` 和 `version` 对应本次提交，不会被另一请求插队改写。

## 部署

部署前以目标环境的 `DATABASE_URL` 执行：

```bash
cd backend
npm run db:apply:postgres-schema
```

迁移 runner 会将 ID `20261012_mail_private_labels` 和 checksum 写入 schema ledger；不可用 SQLite bridge 或运行时 DDL 代替。
