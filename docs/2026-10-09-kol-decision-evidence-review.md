# KOL 阶段判断与邮件证据展示改造

日期：2026-10-09。实施范围：本地前端代码；未发布到生产。

用户问题：这位达人合作到了哪一步、判断依据是什么、现在该做什么。保留现有导航与栏位，将已有阶段判断、邮件证据和下一步操作形成连续路径。

## 审宪与审法记录

| 需求 | 主责角色 | 宪法条款 | 基本法与细则 | 结论与证据 | 下一步 |
|---|---|---|---|---|---|
| 判断、依据、动作在第一屏连续展示 | UI/UX 专家、前端专家 | CONST-01、04、07、08 | PROD-AGENT-03；TECH-FE-01/02；DESIGN §1/8/9/18 | 符合。消费既有判断与推荐动作，页面不计算新阶段、不替模型新增结论；推荐动作只预填。 | 前端构建与界面回归 |
| 邮件紧凑展示、引用定位、完整来源保留 | UI/UX 专家、前端专家 | CONST-04、06、10 | BIZ-02/13/18；PROD-AGENT-05；TECH-FE-02；DESIGN §9/18 | 符合。引用必须在对应原文中精确匹配；不匹配、缺正文、缺来源版本均显式标注；收发邮件与冲突判断保留。 | 验证完整原文、键盘焦点及缺失场景 |
| 回复准备与正式阶段变更独立 | 前端专家、测试经理；业务口径沿用 KOL 业务专家现行规则 | CONST-03、04、05 | BIZ-11/12/14；TECH-FE-01、TECH-BE-02/03、TECH-TEST-02/03；07-mcp-data-contract 工具风险目录 | 符合。R2 草稿准备只预填；R3 仍提交现有确认接口，保留目标、证据、版本和审批反馈。 | 验证未确认零写入、等待审批不报成功 |
| 密度与三轴适配 | UI/UX 专家、前端专家 | CONST-04、09 | DESIGN §1/4/5/11/13 | 符合。字号、间距、命中区使用既有 token；讨论稿中的字号建议不覆盖 DESIGN；确认区展开时输入框提交降低视觉强调。 | 核对默认、展开、缺失和反馈状态 |
| 合入当前 main、推送及发布准备 | 前端专家、测试经理 | CONST-04、08、10 | TECH-FE-03；TECH-TEST-03/04；IA §1.1 | 符合。只移植本次邮件变更，沿用当前 main 的独立会话和工作台结构；当前生产目录存在其他未提交修复，已保存源文件备份，自动发布增加脏目录检查，禁止覆盖。 | 完成发布门禁并核验实际发布结果 |

规范来源：[宪法](CONSTITUTION.md)、[产品](PRODUCT.md)、[业务](BUSINESS.md)、[技术](TECHNOLOGY.md)、[设计](DESIGN.md)、[工具契约](07-mcp-data-contract.md)。未修改任何法条、业务阶段判定或权限政策。

## 实施资产

- `frontend/src/components/ChatBlocks.tsx`：阶段建议摘要、原文引用、下一步准备反馈与统一邮件工作区。
- `frontend/src/components/SideWorkbench.tsx`：推荐动作前置、额外建议折叠、全量会话邮件证据、阶段确认入口及自动进入视口。
- `frontend/src/components/ResultArtifact.tsx`、`frontend/src/pages/Chat.tsx`：接入当前 main 的共享结果渲染，等待会话读取及滚动恢复就绪后定位确认卡；保留原地址。
- `frontend/src/home/workspace/workspace-shell.css`：补齐独立会话结果栏折叠按钮的定位和 token 尺寸，防止未加载 Home 页面样式时 SVG 撑满结果栏。
- `.github/workflows/release-gate.yml`：生产目录有本地改动时明确失败，避免自动部署的硬重置丢弃其他修复。
- `frontend/src/mail/evidence.ts`、`frontend/src/mail/components/MailEvidenceItem.tsx`：原文摘录、精确匹配、来源与版本、签名/历史/译文分层、完整正文保留。
- `frontend/src/mail/ReplyContextPanel.tsx`：复用证据条目，保留同步失败、依据变化和撤权反馈。
- `frontend/src/styles.css`：工作台密度与确认区单一实底 CTA。

邮件依据快查仍读取现有授权接口；新增界面不发起外部邮件、阶段写入、解密或采集。没有正文时，已有 snippet 仅标为预览；没有版本时，不生成版本。没有可定位引用时，不将正文第一句包装为关键证据。

## 验证证据与边界

前端 `npm run build`（包含 `tsc --noEmit`）与类型检查通过。界面回归命令：

```text
npx playwright test --config playwright.presentation.config.ts mail-evidence-presentation.spec.ts --workers=1 --timeout=60000
npx playwright test --config playwright.presentation.config.ts discovery-presentation.spec.ts --grep "reply revisions|reply source failure|a new reply analysis" --workers=1 --timeout=60000
```

15 项界面回归通过：第一屏判断与动作、收发与冲突证据保留、引用定位与焦点、完整正文与安全转义、回复预填零写入、独立阶段确认与审批等待、已有推荐动作前置、正文缺失、引用不匹配、短高度与窄宽度键盘操作、触摸命中区、主动请求的阶段确认自动进入视口，以及既有人工草稿在依据更新/撤权/新分析轮次后保留。写信任务仍优先展示当前人工草稿，阶段与证据作为可展开上下文，避免旧证据挤占当前写信任务。

这是拦截 API 夹具的界面回归，未替代真实 Codex harness 或外部集成验收。原讨论链接 `http://47.88.94.205/s/ses_6f8648e60031` 本次读取返回 502；尚未在线核对该会话。原有依赖后端的 E2E 选择器已对齐新的汇总/明细位置，未声称运行了该全量集成套件。

状态截图（界面夹具）：

- [默认态](../artifacts/review/mail-decision/default.png)
- [原文展开态](../artifacts/review/mail-decision/expanded.png)
- [证据不足态](../artifacts/review/mail-decision/insufficient.png)
- [动作反馈态](../artifacts/review/mail-decision/action-feedback.png)

交付状态：局部界面实现及回归已验证；生产发布与线上会话验收未执行。
