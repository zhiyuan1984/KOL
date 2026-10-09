# 任务中心紧凑列表改版

## 设计决策
- 模式：Redesign · Preserve。范围仅任务明细列表；保持路由、数据源、状态规则、权限与确认行为。
- 视觉：现有 Ant Design 企业后台 / data-grid，高密度、无卡片墙、无额外装饰。
- 校准：视觉变化 2/10、动效 1/10、信息密度 9/10、素材依赖 1/10、品牌保留 10/10。
- 定位：任务检索与扫描；桌面近距离阅读；克制、理性；主名称列吸收剩余空间。
- 颜色：现有 --text / --text-quiet / --bg / --bg-subtle / --border；交互 --accent-text；状态沿用现有语义。
- 字体：现有字体；正文 13px，时间/辅助说明 12px；数字沿用 --mono。
- 间距：现有 --space-*（4/8/12/16/24px）；紧凑行采用 --table-row-h-compact 32px；表头 --table-header-h 36px。
- 按钮：Ant Design text / small，24px；仅 hover 淡底，无阴影；展开箭头使用 Ant Design 图标。
- 圆角：控件沿用 --radius-control；列表不添加圆角卡片。
- 操作区：详情固定槽、会话与取消固定上下文槽、展开固定槽；缺操作用隐藏的 Ant Design disabled Button 占位，不可聚焦和点击。
- 回退：修改前源文件和前端 dist 保留于服务器独立备份目录；不使用 deploy --sync，避免破坏其他未提交工作。

## 审查记录
需求 → UI/UX 专家、前端专家、测试经理 → CONST-04/05/08/10 → TECH-FE-01/03、TECH-TEST-01/02/03/04 → 符合：仅修正呈现与交互布局，真实数据取自既有后端；不触发正式业务变更 → 构建、相关回归、真实页面截图。

## 发现
现有 colgroup 为 4 列、tbody 为 4 列，但 thead 为 5 列（残留“类型”），浏览器会生成无宽度约束的第五列；截图中“类型”下出现详情且末列大片空白。移除残留表头，不新增字段；技能/类型仍可在展开内容查看。
外层 tasks-page 存在 max-width 限制；本页解除限制，用合理边距铺满可用内容区。

## 参考
- https://ant.design/components/table/ ：紧凑表格、固定列、名称 ellipsis。
- https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables ：默认列优先级、稳定行内操作、密度与展开明细。

## 用户批准
2026-10-09：用户明确确认执行紧凑商务 BI 方案，并要求提供截图。
