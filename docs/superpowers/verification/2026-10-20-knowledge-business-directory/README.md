# 知识库与本体共用业务目录

## 审宪/审法
需求：知识库目录与本体一致，包含员工和管理两侧。角色：项目经理、UX/前端、后端、测试。
依据 CONST-04/05/06/08/10、TECH-FE-01/02/03、TECH-BE-01/02/03、TECH-TEST-01/02。结论：符合；分类只承载业务归类，不承载授权，不移动原资料、不改变审批和发布。

## 实施
同源 enterpriseTaxonomy/loadOntologyCatalog 提供业务族→业务域→业务主题。知识base保持structured/unstructured容器，通过单独映射绑定主题。员工只在服务端原授权知识结果上计算目录计数；管理端在原授权SQL投影内计算canonical facets和筛选。空主题保留。legacy容器与旧API/URL保留，不做名称猜测或自动搬迁。

## 验证边界
validation.json、组件JSON、浏览器日志及截图为实际执行的测试证据。浏览器复核由Manus代理完成，不伪称独立人类专家；development-verify只核对记录、哈希及schema，不证明独立UX人工评审或生产能力。首轮浏览器失败系测试运行中正常整合服务器新版vite.config触发开发服务重启，第二轮无源码配置变动后3例全部通过。
