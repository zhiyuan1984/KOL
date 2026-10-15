# 知识范围异步状态交接契约（前后端协作）

**状态：实现中；本文件是 `GET /api/admin/knowledge/documents/:id/scope` 的前端交接说明，不改变审批、发布或权限规则。**

`ScopeDetail` 将在保持既有字段兼容的基础上扩展如下：

```ts
type ScopeJobStatus =
  | 'queued' | 'running' | 'retrying'
  | 'succeeded' | 'failed' | 'uncertain' | 'cancelled';

type ScopeDetail = {
  // existing fields remain unchanged
  job: {
    id: string;
    status: ScopeJobStatus;
    error_summary?: string;
    attempts?: number;
    max_attempts?: number;
    started_at?: string;
    terminal_at?: string;
    progress: {
      done: number;                    // 已真实完成的提炼批次；同一次 attempt 内单调递增
      total: number | null;            // 真实批次数；未知时为 null，前端不得计算或展示百分比
      unit: 'batches';
      last_progress_at?: string;       // 仅业务批次完成时更新；不是 worker 心跳，也不是本次读取时间
    };
  } | null;
  handoff: {
    // 后端授权的自动提炼意图及其入原生 PG 队列的交接状态
    status: 'pending' | 'queued' | 'failed' | 'none';
    requested_at?: string;
    error?: string;
  };
  actions: {
    edit: boolean;
    generate: boolean;
    check: boolean;
  };
};
```

## 呈现与动作语义

| 服务端事实 | 前端呈现 / 行为 |
|---|---|
| `handoff.status === 'pending'`、`job === null` | 后端已持久化自动提炼意图，仍在等待索引完成或等待后端恢复交接；可有界刷新。不可把它伪装成正在执行。|
| `handoff.status === 'queued'` + `job.status` 为 `queued` / `running` / `retrying` | 队列交接已成功；显示 job 的真实状态。|
| `job.progress.total === null` | 显示“批次数尚未确定”或等效文字；**不得**显示百分比。|
| `job.status === 'failed'` | 展示 `error_summary`；仅当 `actions.generate` 为 `true` 时提供重新提炼入口。|
| `job.status === 'uncertain'` | 显示“结果需要人工核查/接管”；`actions.generate` 必须为 `false`，不得自动轮询重跑或把它当作失败。|
| `job.status === 'cancelled'` | 如实显示已取消；是否重新生成只以 `actions.generate` 为准。|
| `handoff.status === 'none'` 且 `job === null` | 旧资料或未请求自动提炼的资料；前端**不得**假设后端将自动入队或无限等待。需要时只显示后端允许的 `generate` 动作。|

## 幂等与恢复边界

- 自动提炼意图由已授权的后端资料处理动作持久化；前端不构造或推断该意图。
- 后端将意图、`execution_jobs` 权威作业和原生 PG outbox 在事务边界内交接；重复读取、重试投递和重复点击不会创建并发活动作业。
- 读取投影会从已持久化的 `pending` 意图恢复遗漏的“索引完成 → enqueue”交接；前端只读服务端返回，不以页面计时器作为执行时钟。
- `last_progress_at` 与 worker heartbeat、HTTP 读取时间是不同事实；请勿以任一种替换另一种。

## 最终试点补充：不能让页面代替调度器

迁移 043 同时保存 `scope_handoff_actor`。worker 启动与已有心跳周期运行 `recoverPendingScopeHandoffs`（默认 15 秒，每批最多 20 项）；只消费明确 pending、具备原始授权人的意图，重新做该用户/组织权限检查，使用既有 PG execution job + outbox 事务。GET scope 仍可补偿，但离开页面并不会取消后台恢复。权限撤销记录 failed，不跨组织或改用系统权限重跑。

源版本失效触发器保留 **同一原件已授权首次解析** 的 pending 意图（draft→uploaded→normalizing→indexing→pending_review），而源文件替换、后续重新上传、已存在 job 的产物改变仍清除旧范围/进度和旧意图。旧行没有意图不自动获得新授权。

`uncertain` 不仅禁用前端动作：后端 `enqueueScope` 和 `saveScope` 也拒绝直接重跑、清除或覆盖，`scopeSnapshot` 拒绝将未确定终态的新提炼与旧核对结果混作审批输入。

前端：仅无 job 时等待 handoff.pending/queued；终态 succeeded/failed/uncertain/cancelled 不被历史 queued handoff 锁住。读取窗口区分活跃作业 15 分钟无进展、交接 2 分钟和连续读取错误 8 次；权限错误停止，保留重新读取入口。结束读取窗口不是失败、取消或完成。

复核新增长批次组件测试、真实 PG 初始解析意图存活/换原件清除测试、实际 generateScope 的多批次 SQL 与旧 lease/attempt 拒绝测试。后者使用确定性模型夹具；真实模型、生产 Redis/worker 及全量资料质量必须另行验收。
