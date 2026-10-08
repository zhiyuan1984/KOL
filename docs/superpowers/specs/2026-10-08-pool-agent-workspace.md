# 公海中栏 Agent 决策工作台

## 审宪与审法

| 需求 | 主责角色 | 宪法条款 | 基本法条款 | 结论与证据 | 下一步 |
|---|---|---|---|---|---|
| 右栏选人，中栏持续分析；选择不覆盖正文 | UI/UX 专家、智能体产品经理、前端专家 | CONST-01/04/07/08 | PROD-AGENT-01/03/09、TECH-FE-01/02/03 | 符合。复用已登记的分析入队、任务运行、会话消息和 SSE；快捷意图只预填已发布知识问题模板 | 验证页内分析、范围快照、草稿保留与原任务重试 |
| 红人评分独立确认并在原位呈现回执 | KOL 业务专家、前后端专家 | CONST-05/06/10 | BIZ-02/07/10/18、TECH-BE-02/03、TECH-FE-03 | 符合。只提交已选 UID，确认固定对象与条件；每批最多 8 位，回执后刷新公海索引；成功、失败与后台等待分开呈现 | 验证确认失效、取消、批次结果、失败范围与等待恢复 |
| 紧凑三段式工作面 | UI/UX 专家、前端专家 | CONST-04/09 | TECH-FE-02，实施细则 DESIGN.md §1/4/5/9.2/10/11/24.5 | 符合。固定范围头、唯一 feed 滚动区与底部 composer；统一 token；确认时 composer 降低强调；右栏总数与筛选数来自同一分页读模型 | 验证短视口、焦点与唯一实底主动作 |
| 定向验证、合并与推送 | 测试经理、项目经理 | CONST-08/10 | TECH-TEST-03/04 | 符合。用户明确要求只跑修改功能的 E2E，授权合并 main 与 push | 保存定向质量证据后合并推送 |

## 实施资产

- `frontend/src/home/PoolInteraction.tsx`：固定范围、前三位摘要、展开完整范围与四个文字快捷意图。
- `frontend/src/home/PoolAgentFeed.tsx`、`usePoolAgentWorkspace.ts`：连续历史、会话输出与失败恢复；每轮冻结范围，后续选择不改历史。
- `frontend/src/pages/Home.tsx`、`ObjectWorkspace.tsx`：接入 header/feed/composer 插槽；公海分析沿现有任务链在页内执行。
- `frontend/src/home/kolSurfaceApi.ts`、`usePoolWorkspace.ts`：评分回执与索引刷新；超时只读原评分状态，避免盲目重新提交。
- `frontend/src/api.ts`、`backend/src/routers/kol-memory.ts`：显式 `criteria: null` 表示确认的通用口径，避免服务端隐式继承旧发现条件；省略字段的旧调用保持原契约。
- `frontend/src/home/pool-agent.css`、`PoolPane.tsx`、`poolView.ts`：组件样式与员工评分用语。

## 证据与边界

状态：verified（代码及定向验证；生产部署另行确认）。

2026-10-08 验证结果：

- 前端 `npm run build`（含类型检查）：通过，本地与独立预发测试工作树结果一致。
- 后端 `npm run typecheck`：通过。
- 后端 `kol-memory.test.ts`：25 项通过，包含显式通用评分口径不继承旧发现条件。
- 前端 `poolView.test.ts`：5 项通过。
- 定向 Playwright：19 项通过，0 重试；仅执行 `home-pool-agent.spec.ts` 与受影响的公海选择、评分、分页用例。
- 覆盖空选择、草稿保留、已发布模板、SSE 更新、页内分析、历史范围、原任务重试、确认取消及失效、8+2 批次、失败范围、后台等待只读恢复、跨页选择和全库搜索。
- 1280×630 截图及几何断言：范围头、评分确认、composer 均可见，无水平溢出，评分确认时只有一个实底主 CTA。
- `validate:design-tokens` 与 `git diff --check`：通过。

回滚范围为本次提交的公海工作面与显式空评分口径变更；没有数据库迁移。回滚代码不会撤销已写入的评分事实。

验证范围为公海选择、问题模板、页内分析、评分确认、结果与恢复；测试中的 Codex/Jev 响应使用夹具。真实输出仍由生产中的原会话与评分服务提供，本记录不宣称真实模型或外部集成已验证。
