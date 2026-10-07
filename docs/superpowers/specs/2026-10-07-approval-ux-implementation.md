# 审批工作台体验修正

日期：2026-10-07。状态：实现完成，待合并与生产发布。范围承接审批评审建议，重点为员工审批、流程定义、检查和发布页面；不改变审批规则、权限或流程版本执行方式。

## 审宪记录

| 需求 | 主责角色 | 宪法条款 | 基本法条款 | 结论与证据 | 下一步 |
|---|---|---|---|---|---|
| 审批角标反映新版工作台中当前员工可处理的申请 | 平台产品经理、后端专家 | CONST-03/05/10 | PROD-PLAT-05；TECH-BE-01 | **符合**：新增 V2 角标查询，服务端按当前组织、用户参与关系及现存 `allowedActions` 汇总；前端不计算权限 | 用发布门禁验证隔离 PostgreSQL 接口与部署版本 |
| 流程状态、动作名称及提交要求表达准确 | 平台产品经理、KOL 业务专家、前后端专家 | CONST-03/05/08 | BIZ-14/15；TECH-BE-02；TECH-FE-03 | **符合**：展示已发布版本与未发布修改；办理和征询从服务端预览摘要返回对应文案；理由输入在选择动作后展开，并与服务端必填规则一致 | 保留服务端动作判定与确认流程 |
| 编辑窄容器内的流程步骤时仍能看清画布和配置 | UI/UX 专家、前端专家 | CONST-04/07 | TECH-FE-03；DESIGN §1/11/13 | **符合**：属性栏按容器空间收起，分支在窄容器内纵向排列；间距使用已定义 token | 通过发布 UI 门禁验证真实视口 |
| 切换、分享或恢复员工审批申请时保留稳定定位 | 平台产品经理、前端专家 | CONST-07/10 | PROD-PLAT-07；TECH-FE-03 | **符合**：详情使用 `/reviews/:id` 路由；切换流程前提示现有草稿材料将清空；草稿详情按字段名与格式显示 | 随发布端到端用例验证深链恢复 |

## 实现资产

- `backend/src/approval/review-service.ts`、`backend/src/routers/reviews.ts`：按权限上下文统计 V2 可处理申请；动作确认摘要返回办理/征询专属标签。
- `frontend/src/layout/Workbench.tsx`、`frontend/src/reviews/api.ts`：角标使用 V2 接口和当前公司请求头。
- `frontend/src/pages/Reviews.tsx`、`frontend/src/reviews/ReviewDetail.tsx`、`frontend/src/reviews/ReviewActions.tsx`、`frontend/src/reviews/useReviewCommand.ts`：稳定详情路由、责任人、材料字段展示及动作专属确认。
- `frontend/src/pages/ReviewTypes.tsx`、`frontend/src/reviews/FlowDesigner.tsx`、`frontend/src/reviews/ReviewPublishPanel.tsx`、`frontend/src/reviews/reviews.css`：版本状态、发布影响、窄容器流程布局、候选人员搜索、可选试运行折叠。

## 验证与限制

- 前端 `npm run build`：通过。
- 后端 `npm run typecheck` 和 `npm run validate:contracts`：通过。
- 审批服务 `npx vitest run tests/review-service.test.ts`：29 项通过。
- 完整后端测试需要隔离 PostgreSQL；当前执行环境没有 `TEST_DATABASE_URL`、`DATABASE_URL`、Docker 或本地 PostgreSQL。PostgreSQL 相关审批 API 集成测试不能通过，不能据此声称生产权限、通知或完整审批链已验证。
- 本记录不把模拟路径试运行或局部单测当作生产审批闭环证据。CI 的隔离 PostgreSQL E2E 与部署后的版本/健康回执仍为合并和发布证据。
