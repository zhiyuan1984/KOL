# AI 发现按参考图实现

需求：直接按用户图片修改代码，合并 main、push、部署。

主责角色：UI/UX 决定呈现，前端实施，测试经理职责收集证据；由 Codex 分职责执行。

宪法：CONST-04/07/08/10。基本法：PROD-AGENT-01/03/09，TECH-FE-01/03，TECH-TEST-01/02/03。结论：符合。条件表、空白提问框、选中标签、右栏状态和主按钮按用户图片实现；用户明确要求的窄栏指标并排和蓝色提交优先于默认样式。权限、采集确认、参数快照及入库闸门复用原契约。

实施资产：DiscoverySearchCard、DiscoveryWorkspace、discovery-workspace.css、KeywordChipField、Home、ComposerDock 及 discovery-presentation.spec.ts。重置同时清理关键词未提交草稿；自由提问草稿不被表单编辑覆盖。

验证：前端 TypeScript + Vite 构建通过；27 项领域浏览器用例通过；最终 CSS 后新增/重跑 11 项临界宽度、短屏、滚动和点击位置用例通过，无 skip；治理执行链验证通过。375/768/1101/1280/1720/1920 覆盖布局，明暗主题与确认流程由领域用例覆盖。原始 main 5ea2567140072170a20b5afe749f7b449a5c1f26 上复现已有邮件用例 “a new reply analysis round keeps the earlier unsaved human draft” 失败，未修改该邮件能力。

证据边界：以上浏览器测试使用 API fixtures；不代表真实模型、采集或外发集成通过。截图由 Codex 查看，不冒充人类专家验收。完整 loading bundle、契约、报告、哈希和浏览器记录保存在本次隔离工作树 .tmp/ai-discovery-governance。

下一步：仅提交本次资产，快进推送 main；固定提交部署后核对 release.json、原生 PostgreSQL 健康和所有运行单元。回滚点：5ea2567140072170a20b5afe749f7b449a5c1f26（保留旧 dist）。
