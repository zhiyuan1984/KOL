# 提问框与两个菜单的 UI/UX 评审（105px · 档位控件 · + 菜单）

> 评审记录，不是现行法。规则本体：`docs/DESIGN.md`（密度档 / §控件尺寸 / §三轴适配 / §不变量 1–5 / §验收矩阵）与
> `specs/UX-EMPLOYEE.md`（员工禁词、L1–L3）。参考形态：所有者给的图 1（模型面板）、图 4（插件列表）。

## 1. 现状取证（文件:行）

| 对象 | 现状 | 位置 |
|---|---|---|
| 提问框默认高度 | `--composer-default-min: clamp(150px, 30dvh, 240px)` → 900px 高视口下**渲染 240px** | `frontend/src/composer.css`（§10b 外壳） |
| 盒子内部几何 | 内边距 `22px 24px 12px`、编辑器地板 `60px`、工具行 `var(--composer-toolbar-h)`=44px、列 gap 6px | 同上 |
| 键位提示 | 「Enter 发送 · Shift+Enter 换行」只在 workspace 渲染；样式 2 条 | `components/ComposerDock.tsx:1176`、`styles.css:3544` |
| 模型档位控件 | **原生 `<select>`**（快速/均衡/高质量），透明底、12px、`#6b6b6b`、`min-height: 24px` | `composer/ModelTierControl.tsx:31`、`composer.css:466-473` |
| 档位的实际作用 | 随请求发后端：`model_tier`；持久化在 `localStorage["composer:model-tier"]`；另有同名控件在设置页 | `ComposerDock.tsx:776`、`api.ts:1020`、`pages/AccountSettings.tsx:156` |
| + 菜单结构 | 五组：添加 / 能力 / 岗位 / 作业 / 更多；每行只有「图标 + 文本」，两列一组 | `composer/PlusMenu.tsx:79-116` |
| + 菜单面板 | 宽 300px、radius 16、**`overflow: visible` 且无 max-height**（子面板才有 360px 滚动） | `composer.css:274-284` |
| 图 3 末两条 | 「打开 /kb」「打开 /connectors」——**把路由路径当文案** | `composer/PlusMenu.tsx:108-115` |

## 2. 逐条评审

### 2.1 默认高度 105px（按要求已实施）

240px 是「30dvh 地板」的产物：900px 高视口里空框就占掉 27% 屏高，而它服务的是下方清单/会话 ——
与 `DESIGN.md` §三轴适配「页脚控件必须给内容让路」的方向相反。105px 要精确到像素必须同时收三处：

```
上内边距 21 + 编辑器 22（一行 line-height 20）＋ gap 6 ＋ 工具行 44 ＋ 下内边距 12 = 105px
```

- 编辑器地板 60px（三行）→ **22px**；长文本仍在编辑器内部滚动、盒子长到 `--composer-max-height` 540px ✓ 行为不变。
- 命中区不变：工具行仍 44px（触摸 ≥44px，§控件尺寸）。
- 两条把 240–250px 钉死的 e2e 判据同步改为 105–112px（**产品要求变更，不是放宽**）。

### 2.2 「Enter 发送 · Shift+Enter 换行」不展示（按要求已实施）

`ComposerDock.tsx` 那一行与 `styles.css` 两条样式已删。

**评审意见（待你定）**：键位约定仍建议「可发现但不占视野」——挂到输入框的 `aria-keyshortcuts` 与
`title`（读屏 / 悬停可见），或在设置页写一条。否则新同事只能靠试。

### 2.3 模型档位控件：图 2 → 图 1（已实施）

**图 2 为什么不合格**：它是浏览器**原生 select**，外观与键盘行为由系统决定 ——
① 三个选项没有任何代价信息（「快速/均衡/高质量」不说明贵不贵、慢不慢）；
② 没有「当前值」标记；③ 面板长相与产品无关，且 Windows/macOS/触摸三种形态（跨端不一致）；
④ 它紧挨 Send 按钮 —— 一个会改变成本/质量的设置放在最容易误触的位置。

**图 1 值得学的三点**：用一个面板承载「我选了什么 + 别的选项各意味着什么」；选中项打 ✓（非颜色信号，§不变量 4）；
变更后果一句话讲清。

**不建议照搬的两点**：
- 图 1 有**两个维度**（模型 / 思考 Off-Low）。我们只有「档位」一维；为了像参考图而拆成两个控件，
  等于凭空造出第二套成本语义 —— **不做**。
- 图 1 的「切换模型或思考程度会使提示词缓存失效」是**它的**后果说明。我们的 `model_tier` 只是随请求发给后端
  （`api.ts:1020`），**是否影响缓存我没有后端证据** → 不写。要有这句，先让后端确认档位与缓存/计费的关系
  （否则就是编造后果）。

**形态建议（落在既有 token 上）**：
- 触发器：工具栏 chip 按钮 `档位 · 均衡 ⌄`（高度走 `--composer-toolbar-h`，圆角 `--radius-control`，
  `aria-haspopup="menu"` + `aria-expanded`），替代原生 `<select>`。
- 面板：标题「回答档位」；三行「快速 / 均衡 / 高质量」，每行 **名称 + 一句话说明**（说明的措辞需与后端对齐
  「档位到底改了什么」，属业务口径）；当前项右侧 ✓；底部一条粗分割 + 「更多设置…」链到
  `个人设置 → 模型档位`（那份保留为持久化入口）。
- 键盘 / 触摸：↑↓ 移动、Enter 选中、Esc 关闭、点外关闭；焦点环走 `--focus-ring`；面板宽 240–260px、
  `--radius-section`、发丝线分组、`max-height` + 内部滚动（§不变量 5：浮层不吃过内容）。
- 员工禁词：面板里**不出现**模型/厂商名（图 1 的「OpenAI / ChatGPT 5.6 Sol」不能照抄）。

### 2.4 + 菜单：图 3 → 图 4（已实施）

**图 3 的问题**：
1. 两列一组（上传文件 | 上传图片）把每行压窄，而菜单项最需要的是「这是什么」；
   根因见 §5.2：行样式写成 `.cascade-menu > button`（直接子节点）从未命中，行退化成 inline 流；
2. 末两条是**路由路径当文案**（`打开 /kb`、`打开 /connectors`）—— 撞员工禁词，且与「从知识库引用」「连接器」
   重复：同一能力两个入口、两种说法（IA 冗余）；
3. 根面板 `overflow: visible` 且无 `max-height`，分组再多就溢出视口（反倒是子面板有 360px 滚动）。

**图 4 值得学的**：单列、每行 `图标 + 名称 + 一句话说明`（说明用 muted）、面板有上限并内部滚动、
条目仍是纯列表（不是卡片墙 ✓ 符合 §密度档）。

**建议**：`MenuButton` 增加 `hint` 字段并改单列；面板加 `max-height: min(60dvh, 420px)` + `overflow-y: auto`；
删掉「打开 /kb」「打开 /connectors」，能力入口只留「从知识库引用 / 连接器 / 技能」；
「更多」组只保留 `添加到项目`。说明文案示例（**待业务确认**）：上传文件＝把本地文件加进这次提问；
最近的文件＝从你最近用过的文件里选；从知识库引用＝引用知识库里的 SOP / 模板；技能＝给这次提问挂一项技能；
连接器＝查看已授权的平台连接；数字员工＝换一位数字员工来回答。

## 3. 与条款的关系

- 105px、删提示：`DESIGN.md` §三轴适配（高度轴）与 §控件尺寸（命中区不变）✓
- 两个面板重构：§不变量 1（不新增实底 CTA）、§不变量 4（选中不只靠颜色）、§不变量 5（浮层不吃过内容）、
  §控件尺寸（圆角 / 焦点环走 token）、`specs/UX-EMPLOYEE.md` 员工禁词 ✓
- 没有条款依据的部分（例如各档位说明的具体措辞）明确标注为业务口径，须业务专家确认。

## 4. 结论与优先级

| 级别 | 项 | 状态 |
|---|---|---|
| P0 | 提问框默认 105px；不展示键位提示 | **已实施**（含两条门禁判据同步） |
| P1 | 档位控件：原生 select → 面板（图 1 形态） | **已实施**（2026-09-22 二轮） |
| P1 | + 菜单：单列 + 说明行 + 面板滚动 + 去掉路由路径文案（图 4 形态） | **已实施**（2026-09-22 二轮） |
| P2 | 键位约定的可发现性（aria-keyshortcuts / title / 设置页） | 待定 |
| 不做 | 照搬图 1 的第二维（思考档）；无后端证据的缓存提示 | — |

## 5. 实施记录（2026-09-22 二轮）

### 5.1 档位控件（`composer/ModelTierControl.tsx` 重写）

- 触发器：`<button class="tier-trigger" data-tier-trigger aria-haspopup="menu" aria-expanded>`，文案
  「档位 · <当前档> ⌄」；高度走 `--control-h-lg`、圆角 `--radius-control`、焦点环 `--focus-ring*`。
  原 `compact` 入参随原生 select 一并删除（唯一调用点 `ComposerDock.tsx:1177`）。
- 面板：`[data-tier-panel]` —— 宽 240px、圆角 `--radius-card`、`max-height: min(60dvh, 320px)` 内部滚动；
  三行「名称 + 一句话说明」；当前档 `aria-checked` + 右侧 ✓ + `--ds-selected-bg` / `--ds-selected-border`；
  底部发丝线 + 「更多设置…」→ `/settings?tab=preferences`（保留为持久化入口）。
- 键盘：展开即聚焦当前档；↑↓ 循环；Enter/Space 选中；Esc 关闭并回焦触发器；Tab 关闭；点外关闭。
- 档位说明只写快慢与深浅 —— 依据 `backend/src/worker/runner.ts:754-755`（档位映射 `effort` low/medium/high）。
  不写模型名或厂商名，也不写「切换会使缓存失效」（无后端证据，属编造后果）。
- 删掉的死 CSS：`styles.css` 三处 `select` 规则（`.home-composer-dock .tier-control select`、
  `.composer .tier-control select`、`.tier-control select`）与 `.tier-control-icon`。

### 5.2 + 菜单（`composer/PlusMenu.tsx`）

- **两列一组的根因**：根菜单行样式写的是 `.cascade-menu > button`（直接子节点），而按钮一直在
  `.composer-menu-section` 里 —— 规则从未命中，行退化成 inline 流，两个按钮于是挤在同一行，也没有整行命中区。
  已改为 `.cascade-menu .composer-menu-section > button`（`styles.css` + `composer.css`），行才成为整行 flex。
- 行结构：`图标 + 名称 + 一句话说明`（说明 `--ds-font-helper` + `--text-muted`，`title` 兜底截断），单列、整行可点。
- 根面板加 `.cascade-scroll`（`max-height: min(60dvh, 420px)` + `overflow-y: auto`）。子面板是它的兄弟节点，
  仍绝对定位挂在根面板上，所以根面板保持 `overflow: visible`（§不变量 5：不得溢出后被静默裁切）。
- 删除「打开 /kb」「打开 /connectors」（路由路径当文案，且与「从知识库引用」「连接器」重复），
  连带删掉已无用的 `.cascade-link` 样式。
- 图标字形由 `--muted` 改 `--accent-text`（`DESIGN.md` §颜色把图标字形归 `--accent*`）。
- 触摸：`@media (pointer: coarse)` 下菜单行 / 档位触发器 / 面板脚注命中区 ≥44px。

### 5.3 门禁与实测

- `workbench.spec.ts`「composer sends the selected model tier」改为面板交互，并断言 `aria-checked`、
  ✓ 只出现在当前档、选后触发器文案。
- `composer-prompt-input.spec.ts` 增加：触发器带当前值、`title` 说明存在、`.cascade-scroll` 存在、菜单内无 `<a>`。
- Playwright 探针（1280×720）实测：菜单单列 300px、行高 40px、`.cascade-scroll` 420px 上限（内容 550px 内部滚动）、
  菜单内 `<a>` = 0；档位面板 240px、圆角 8px、当前行 52px、✓ 14px 可见、触发器 84×32；
  `ArrowDown + Enter` 后触发器变「高质量」、`localStorage["composer:model-tier"]` 同步、焦点回触发器。

### 5.4 业务口径与键位可发现性（2026-09-22 三轮）

- 档位说明改**业务口径**（写「适合哪类活」，不写 effort / 模型 / 计费）：快速＝查数据、看进度这类快问快答；
  均衡＝日常跟进与草稿的默认档；高质量＝写邮件、写话术等要打磨的产出。语义依据仍是
  `backend/src/worker/runner.ts:754-755` 的档位 → effort 映射；三项说明实测均不截断（面板 240px、行高 52px）。
- + 菜单的说明本来就是业务语言（「把本地文件加进提问」等），未改。
- P2 落地：提问框 `aria-keyshortcuts="Enter Shift+Enter"`（不占视野、读屏可发现），并在
  个人设置 → 偏好 增加一条 muted「提问框快捷键：Enter 发送，Shift+Enter 换行。」（`[data-settings-keyshortcuts]`）。

### 5.5 环境里的既有红灯（本轮复核，**非本次改动引入**）

- `workbench.spec.ts:551`「composer plus menu…」失败在 `skillLayout`：它断言技能行有 `.cascade-icon`，
  而 `SkillMenu.tsx`（HEAD 同样）不渲染图标。
- `workbench.spec.ts:2676` 在 `waitForURL(/\/s\//)` 超时：**把本次改动 `git stash` 全部移走、用 HEAD 代码跑同样失败**
  （HEAD 是 select 版档位），属首页发送 → 会话导航的既有问题。
- `composer-prompt-input.spec.ts:72`（提问框宽度 766）与 `:248`（焦点环底色口径）仍是既有红灯，
  与另一会话的 Home 收敛改动（`11f183b`）及 token 口径有关，未在本轮处理。
