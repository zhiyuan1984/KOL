# AI 发现 · 红人线索 Figma 框线交付

## Frame

- Desktop：1440 × 1024，内容宽 1200，左右留白 32。
- Tablet：1024 × 1024；筛选项换为两列，候选行隐藏次级指标。
- 页面只保留产品主导航中的 `AI发现`，删除重复页面标题和右上角工具组。

## 页面结构

1. `Search / Compact`：标题、平台切换和检索条件合并为一个紧凑区。
2. `Crawl status / Completed`：独立单行状态卡，展示完成时间、耗时、原始数量和入围数量。
3. `Result toolbar`：候选人数、排序说明、多选和批量入库。
4. `Creator lead / Row`：默认紧凑行；点击“查看详情”展开二级指标。

## 组件

### Platform chip

- 属性：`platform`、`selected`、`disabled`。
- 内容：16 px 平台图标 + 平台名称。
- 高度 36，左右内边距 12，间距 8。

### Creator lead row

- 属性：`selected`、`confidence=high|medium|low`、`library=none|pool|followed`、`expanded`。
- 一级字段：头像、昵称、平台、账号 ID、粉丝、近10均播、播放/粉丝比、推荐分、匹配理由、样本置信度。
- 一级操作：看来源、查看详情、忽略。
- 二级字段：播放中位数、稳定度、采集时间、在库状态。

### Bulk action bar

- 未选中：`已选 0 人`，主按钮禁用。
- 已选中：`入库公海（N）`。
- 批量动作只负责入库；不发信、不改阶段、不自动认领。

## 字段规则

- `近10均播`：用 `recent_views` 中有效样本求平均；不足 10 条时明确显示 `N/10 条样本`。
- `播放/粉丝比`：`view_mean / followers`，以百分比展示。
- `推荐分`：展示总分，同时允许在详情中查看构成；不单独依赖颜色传达。
- `置信度`：来自样本覆盖率，不再写成“关键字段完整度”。
- `匹配理由`：必须是可复核信号；缺失时显示“暂无足够内容证据”，不得编造。
- `采集时间`：使用 `collected_at`，显示到分钟。
- `看来源`：需要 MCP 补充 `profile_url`；无 URL 时禁用并显示“来源链接缺失”。

## Auto Layout

- 页面：Vertical，gap 20。
- 筛选区：Vertical，gap 14；平台 Chip 使用 Wrap。
- 条件行：Horizontal，gap 10；宽度不足时 Wrap 为两列。
- 候选列表：Vertical，gap 0；以 1 px 分隔线区分，不给每行套独立卡片。
- 候选行：Horizontal，垂直居中，最小高 76；展开详情后使用 Vertical。

## 视觉 Token

- 文字：12 / 14 / 16 / 18 / 20。
- 间距：4 / 8 / 12 / 16 / 20 / 24 / 32。
- 圆角：输入框与按钮 8；页面容器 14。
- 主色沿用现有玫红；成功状态使用绿色文字和圆点，同时保留状态文案。
- 正文与背景对比度至少 4.5:1；所有图标按钮必须有可读标签或 aria-label。

## MCP 补充字段

```json
{
  "profile_url": "",
  "avatar_url": "",
  "matched_keywords": [],
  "match_reason": "",
  "collected_at": "",
  "existing_library_status": "not_in_library"
}
```

