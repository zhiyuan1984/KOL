# KOL 知识库与首次建联模板验收

日期：2026-10-04。环境：http://47.88.94.205/ 。环境入口依据主仓库 `e2e-test-context.md`；本次沿用浏览器已登录账号，未读取或更改凭据。

## 审查记录

需求：当前账号使用 KOL 智能体，绑定 KOL合作知识库，管理侧撰写首次建联模板并验证应用。

主责角色：平台配置（账号与 Agent 装配）、KOL 业务（模板内容）、前端实现（结构化字段契约修复）、测试（实际页面验收）。

宪法：CONST-02、CONST-05、CONST-06、CONST-08、CONST-10。

基本法：PROD-PLAT-04/05、BIZ-11、TECH-ARCH-04、TECH-FE-01/03、TECH-TEST-01/03。

结论：符合。分类不承载人员权限，账号复用既有 Agent 绑定，知识库经已装配技能绑定，发布经过页面版本确认。未发送邮件、未变更合作阶段。

## 实际配置与证据

| 对象 | 结果 |
| --- | --- |
| 当前账号 | 鄢棽（sriphy）；导航显示姓名，创建、发布及绑定审计显示账号 |
| KOL 智能体 | 已发布 v1；已有鄢棽直接绑定，覆盖 3 人（含规则继承的黄启友、陆海军）；未新增人员授权 |
| 业务族 | IPMS，code=ipms |
| 业务域 | Marketing（市场推广），code=marketing，隶属 IPMS |
| 知识库 | KOL合作，code=kol_cooperation，id=kbase_dfbf4c998fe4，结构化、启用中 |
| 技能依赖 | KOL 智能体已装配的 email_compose（写合作邮件）→ KOL合作；绑定 id=kbind_2bd9c5da6587，页面审计 admin.agent.knowledge.bind |
| 模板 | 首次建联，id=kb_2870fb46e267，第 2 版已审批发布，14:35，sriphy |
| 适用 | 全品牌、英文、INITIAL_CONTACT；creator_name / sender_name / brand_name / product_name 占位符 |

页面旧目录把 family/domain 分别称为“业务域/业务主题”，员工首页称为“业务族/业务域”；本次依据实际父子关系配置，未新建重复层级。

## 发现与修复

管理页新建与编辑把 `structuredPayload()` 展开到了请求顶层，而后端与详情使用 `structured` 对象。第 1 版详情出现四个结构化字段均未填写；不能据此宣布模板完成。草稿详情又只有审批入口，没有编辑入口。

修复资产：

- `frontend/src/admin/knowledge/BaseView.tsx`：以 `structured` 提交结构化字段。
- `frontend/src/admin/knowledge/EntryView.tsx`：同样修复编辑载荷；为待发布条目提供次要“编辑草稿”入口，发布仍使用原有确认流程。

修复只覆盖前端两文件。服务器基线为 49de285，补丁在服务器工作区应用；未提交或推送 Git。构建先写入 `frontend/dist.knowledge-20261004`，类型检查与 Vite 生产构建通过后更新静态资源与 index。旧产物保存在服务器 `frontend/dist.before-knowledge-20261004`，未重启后端、未修改数据库或认证配置。

## 验收结果与边界

1. 管理页面成功创建分类及知识库，并回读父子关系。
2. 保存原模板的第 2 版，主题、英文正文、占位符及中文内部译稿全部完整回读。
3. 发布确认指向第 2 版，页面返回“已审批发布”，保留第 1 版历史。
4. 员工 `/kb` 出现 IPMS / Marketing（市场推广） / KOL合作，库内 1 条知识；能读取第 2 版英文内容与占位符。
5. 点击“用于当前任务”，工作台显示“已锁定邮件底稿：首次建联”，主题与英文正文进入未提交输入草稿，附有知识引用。
6. `git diff --check`、服务器 `npm run build`（含 `tsc --noEmit`）通过。未运行全量 E2E 套件。

本次验证范围为真实管理配置、发布、员工检索和模板应用。未运行 Codex 生成、未填入真实收件人、未发信；不能把本次验收描述为邮件发送或模型端到端成功。

截图在本机 `C:/Users/admin/.codex/visualizations/2026/10/04/01a10571-aab5-7012-a2af-3ca27a815bd1/`：`kol-template-published.png`、`kol-template-applied.png`。

下一步：需要实际建联时补齐四个变量、核实联系方式与发件箱，并由员工确认最终邮件版本。
