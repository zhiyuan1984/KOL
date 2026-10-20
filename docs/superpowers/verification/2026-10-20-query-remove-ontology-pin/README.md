# 达人库查询取消固定本体版本依赖

需求：用户明确要求“不合理改掉，去掉版本要求，或者最新版本”。本次采用删除该技能的强制本体依赖，不新增全平台 latest 语义，不伪造第 2 版发布。

审宪：需求 → 智能体产品经理/后端专家 → CONST-02/03/04/05/08/10 → PROD-AGENT-01、PROD-PLAT-04、BIZ-02/03、TECH-ARCH-03/04、TECH-BE-01、TECH-TEST-01 → 符合。用户已明确裁定该前置条件不合理；技能依赖属于实施资产，不反向作为业务法律。保留 Agent 发布与使用资格、技能装配与生命周期、creator.query@1、工具授权、来源与数据范围；其他技能显式声明的本体版本校验保持不变。

变更：删除 backend/skills/creator_library_query/SKILL.md 中 kol_profile@2/read_profile 的 ontology 声明。查询继续通过已登记能力和既有受控工具链读取真实来源。不改今日任务导航，不改人员权限，不改本体发布数据，不改基本法。

证据：tests.json 记录 11 个通过；validation.json 记录类型、契约、registry 检查；prior-live-diagnosis.json 是修改前线上事实。机器验证不是实际远端查询验收；部署后须复核识别和真实执行，starrykol 配置未就绪仍须如实报告。

发布授权：本会话用户已明确授权“合并main分支，push，部署”，本次为同一达人库故障的后续修复。下一步：验证交付、合并推送 main、部署与线上复核。
