> **I-layer path:** this file remains `docs/design-system/kol-workbench/MASTER.md` (KOL workbench path name; token/source slot). Do not rename or move it.
>
> **Content:** 下方仍保留 OpenAI-quiet mood 正文（与 `docs/references/openai-style.md` 同源）。**产品 token 以本文件顶部「Product tokens」为准。** LAW-MAP / `design.md` 仍把本路径当 I 层 token 源。`design.md` 禁止抄 hex。
>
> **ADR-031 / 2026-09-16：** mood（安静白底 / 发丝边 / 胶囊 / 排版）跟 OpenAI。~~浅色填充主 CTA = Obsidian `#000000`~~ **废止。** 填充主 CTA = 产品粉红 `--primary`。
>
> **2026-09-16 壳刷新：** 员工 Workbench 锁定紧凑页框（侧栏 264、Logo 左上、账户底座、15/24 正文、Composer 22px 圆角矩形）。与 OpenAI 17px / Inter / 胶囊输入冲突时，本轮 FE 跟用户锁定壳 brief；硬不变量仍高于审美。

# Product tokens（唯一可审计 hex）

浅色主题填充主 CTA。白字。同一视口 0–1 个实底。对照建议 `#E85A9B` 对 14px/500 白字只有约 3.3:1，不满足 WCAG AA 正文对比；本表取同色相、更安静、白字 ≥4.5:1 的法律目标。

| Token | Hex | Role |
|---|---|---|
| `--primary` | `#C73B7A` | Light filled primary CTA（产品粉红实底） |
| `--primary-fg` | `#FFFFFF` | Label on filled primary |
| `--primary-hover` | `#A82F66` | Hover / pressed of the same hue；不是第二主色 |
| `--color-obsidian` | `#000000` | **正文 / 近黑字 / 发丝源 only**。不再是填充主按钮 |
| `--font-sans` | `ui-sans-serif, system-ui, "PingFang SC", "Noto Sans SC", …` | 紧凑壳 live 栈；Linux 追加 WenQuanYi / Droid Sans Fallback。ADR-031 Inter-first 让位于本轮锁定 brief |
| `--color-ink` | `#1a1a1a` | 正文。不是纯 `#000` |
| `--font-body` | `15px / 24px / 400` | 紧凑壳正文。冲突：ADR-020 16px / OpenAI 17px |
| `--font-section` | `15px / 500–600` | 节标题 |
| `--font-page-title` | `18–20px / 600` | 页结论 / Home 主标题。禁止 24px+700 |
| `--font-meta` | `13px / 20px / 400` `#6b6b6b` | 元信息 |
| `--left-width` | `264px` | 桌面侧栏。折叠=图标。手机不强制 264 |
| `--composer-radius` | `22px` | 圆角矩形，不是胶囊 9999 |

`--focus-ring` 可用 `--primary` 的低透明描边，或保持发丝近黑；不要另发明第二品牌色。

**本轮壳/字号冲突（记录，不改硬不变量）：** 用户锁定紧凑壳（15px / `#1a1a1a` / 侧栏 Logo / Composer 圆角矩形）。ADR-020 16px 底、ADR-031 Inter + OpenAI 17px/Obsidian 正文、MASTER 胶囊输入让位给该 brief。SEND≠STAGE / L3 / 同一视口 0–1 实底主 CTA / 禁止引擎行话不变。`--primary` 仍是产品粉红。

# OpenAI — Style Reference（mood；主填充以 Product tokens 为准）

> 本段是 OpenAI mood 对照。产品填充主 CTA **不**用本段的 Obsidian 黑钮，改读上方 `--primary` `#C73B7A`。

> Research lab notebook at noon.

**Theme:** light

OpenAI's interface operates as a typographic, editorial canvas — pure white surfaces, near-black type, and almost no chromatic identity. The system is defined by restraint: the only filled element on the page is the product-pink primary button (`--primary`), which functions as a single period at the end of an otherwise quiet sentence. ~~black 'Try ChatGPT' button~~ **废止为产品 CTA。** Hairline borders at 12% black opacity create structure without weight; cards carry a barely-perceptible 6px radius that whispers geometry rather than announcing it. Typography does the heavy lifting: a custom sans (OpenAI Sans) set at a Major Second scale with progressively tighter tracking — -0.03em at display, normal at body — gives headlines a compressed, almost newsprint authority. Components feel deliberately lightweight: pill-shaped controls, ghost buttons, transparent surfaces, and minimal elevation. The visual mood is 'research lab notebook' — quiet, confident, and trusting the reader to focus on content rather than chrome.

## Tokens — Colors

| Name | Value | Token | Role |
|------|-------|-------|------|
| Obsidian | `#000000` | `--color-obsidian` | Primary **text** and hairline source. ~~filled action button~~ **废止（ADR-031）：** 填充主按钮改 `--primary` `#C73B7A` |
| Product pink | `#C73B7A` | `--primary` | Light filled primary CTA + white `--primary-fg`. The single chromatic punctuation in an otherwise quiet system |
| Graphite | `#666666` | `--color-graphite` | Muted captions, helper text, and de-emphasized UI labels. |
| Smoke | `#8f8f8f` | `--color-smoke` | Tertiary text, disabled states, icon strokes, placeholder text — the dimmest readable voice |
| Paper | `#ffffff` | `--color-paper` | Page canvas, card surfaces, input fills — the infinite background that lets type and imagery carry all weight |
| Ash | `#f1f1f1` | `--color-ash` | Subtle surface elevation, hover states, language selector background — a barely-visible plane shift from Paper |
| Hairline | `#0000001f` | `--color-hairline` | All borders, dividers, card outlines, button outlines — structure without weight, defined as a semi-transparent black rather than a gray hex |
| Whisper | `#0000000a` | `--color-whisper` | Supporting palette color for small decorative accents when the core palette needs contrast. Do not promote it to the primary CTA color（主 CTA 是 `--primary`，不是 Whisper） |

## Tokens — Typography

### Inter / OpenAI Sans — Primary typeface for all UI text
现行栈：`Inter, "OpenAI Sans", "PingFang SC", "Noto Sans SC", …`（`--font-sans`）。OpenAI Sans 待许可后再切主脸。Weight 400 for body, 500 for nav/labels/headings, 600 only for the largest headings.
- **Substitute:** Inter (current), OpenAI Sans (licensed later), Söhne, or system-ui sans-serif
- **Weights:** 400, 500, 600
- **Sizes:** 13px, 14px, 16px, 17px, 18px, 22px, 28px, 48px
- **Line height:** 1.00–1.65
- **Letter spacing:** -0.03em at 48px, 0.011em at 28px, -0.01em at 22px and below
- **OpenType features:** `'calt' on, 'liga' on`
- **Role:** Primary typeface for all UI text — custom geometric sans with humanist warmth, used at weight 400 for body, 500 for nav/labels/headings, 600 only for the largest headings. Signature: -0.03em tracking at display sizes creates compressed authority; +0.011em at 28px adds subtle breathing for subheads. Font features: 'calt' and 'liga' enable contextual alternates and ligatures.

### Type Scale

| Role | Size | Line Height | Letter Spacing | Token |
|------|------|-------------|----------------|-------|
| caption | 13px | 1.51 | -0.13px | `--text-caption` |
| input | 16px | 1.5 | -0.16px | `--text-input` |
| body-lg | 18px | 1.32 | -0.18px | `--text-body-lg` |
| subheading | 22px | 1.26 | -0.22px | `--text-subheading` |
| heading | 28px | 1.21 | 0.31px | `--text-heading` |
| display | 48px | 1.16 | -1.44px | `--text-display` |

## Tokens — Spacing & Shapes

**Base unit:** 4px

**Density:** comfortable

### Spacing Scale

| Name | Value | Token |
|------|-------|-------|
| 4 | 4px | `--spacing-4` |
| 8 | 8px | `--spacing-8` |
| 12 | 12px | `--spacing-12` |
| 16 | 16px | `--spacing-16` |
| 20 | 20px | `--spacing-20` |
| 24 | 24px | `--spacing-24` |
| 32 | 32px | `--spacing-32` |
| 40 | 40px | `--spacing-40` |
| 52 | 52px | `--spacing-52` |
| 64 | 64px | `--spacing-64` |
| 80 | 80px | `--spacing-80` |
| 120 | 120px | `--spacing-120` |

### Border Radius

| Element | Value |
|---------|-------|
| tags | 9999px |
| cards | 6px |
| links | 4px |
| inputs | 9999px |
| buttons | 9999px |

### Shadows

| Name | Value | Token |
|------|-------|-------|
| sm | `rgba(0, 0, 0, 0.02) 0px 4px 6px 0px, rgba(0, 0, 0, 0.05) ...` | `--shadow-sm` |

### Layout

- **Page max-width:** 1200px
- **Section gap:** 32-64px
- **Card padding:** 12px
- **Element gap:** 12-16px

## Components

### Filled Action Button
**Role:** Primary conversion — the only filled button in the system

Solid `--primary` `#C73B7A` background, `--primary-fg` `#FFFFFF` text at 14px weight 500, full pill radius (9999px), 8px vertical / 20px horizontal padding. Used sparingly — 0–1 filled primary per viewport. ~~Solid #000000 / Obsidian~~ is **not** the product filled CTA. This pink fill is the system's only chromatic punctuation.

### Outlined Pill Button
**Role:** Secondary actions and category filters

Transparent background, #000000 text at 14px weight 500, 1px solid border at rgba(0,0,0,0.12), full pill radius (9999px), 8px vertical / 20px horizontal padding. The default for tag chips like 'Talk with ChatGPT', 'Research', 'API Platform'.

### Ghost Text Button
**Role:** Lowest-emphasis actions and navigation

No background, no border, #000000 text at 13-14px weight 500. Used for nav items, breadcrumb-style links, and the 'Log in' control. Relies on hover state (Whisper background) for affordance.

### Search Input
**Role:** Primary interaction surface — the ChatGPT prompt bar

Transparent background, #000000 text at 16px weight 400, 1px solid border at rgb(229,231,235), full pill radius (9999px), 10px vertical / 24px right / 52px left padding (left padding reserves space for an icon). Placeholder at #666666. No visible focus ring — system relies on the cursor.

### Article Card
**Role:** Content cards in the news/stories grid

Transparent background, 6px border-radius, no shadow, no padding — the card is defined entirely by its image and text block. The 6px radius applies to images, creating softly clipped photographic edges. Text sits directly below or overlaid on the image.

### Featured Article Hero Card
**Role:** Large editorial card — one per grid section

Full-width or two-column span, large photographic header (planets, space, etc.), 48px display headline in weight 500 with -0.03em tracking below, metadata at 14px weight 500 in Graphite (#666666). The image does the visual work; type provides editorial gravity.

### Section Header
**Role:** Dividing labels between content zones

Small caps-style labels at 14px weight 500 in Graphite, generous top margin (32-64px), often accompanied by a 'View more' ghost link. Functions as a section anchor without using a colored bar or rule.

### Top Navigation Bar
**Role:** Global site navigation

Fixed or sticky top bar, Paper (#ffffff) background, OpenAI wordmark left, nav items (Research, Products, Business, Developers, Company, Foundation) at 14px weight 500 in #000, search icon, Log in ghost button, Try ChatGPT filled button right. Total height ~64px. No border-bottom — separation is whitespace alone.

### Tag Chip Row
**Role:** Suggested prompts below the search input

Horizontal row of outlined pill buttons (see Outlined Pill Button) at 13-14px, spaced 8px apart. Functions as quick-action shortcuts. Sits centered below the prompt input on the hero.

### Footer
**Role:** Site footer with legal and secondary navigation

Paper background, multi-column layout with link groups at 13-14px weight 500, Graphite text color, generous top padding (64px+). No social icons, no newsletter signup — utilitarian and quiet.

## Do's and Don'ts

### Do
- Use `--primary` `#C73B7A` as the sole filled button color — one filled primary per viewport. ~~Use #000000 as the sole filled button color~~ **废止。** Filling any other button dilutes its signal
- Set all borders to rgba(0,0,0,0.12) rather than a gray hex — the semi-transparent black adapts to the background and maintains consistent visual weight on white and light-gray surfaces
- Apply 9999px radius to all buttons, tags, and inputs — the pill shape is the primary geometric signature and must be consistent across all interactive elements
- Use 6px radius for cards and images — this near-zero radius is a deliberate choice that feels architectural rather than soft; avoid 12px or 16px which would shift the system toward 'friendly SaaS' territory
- Set body text at 17px with 1.65 line-height and -0.01em tracking — the slightly larger base and generous leading create the editorial reading rhythm
- Use weight 500 for navigation, labels, and subheads — weight 400 is reserved for body copy and weight 600 only for the 28px heading tier
- Trust whitespace over dividers — sections are separated by 32-64px gaps and margin-bottom rather than horizontal rules or background color shifts

### Don't
- Do not introduce extra accent colors, gradients, or a second brand hue — the system stays quiet white; the **only** allowed chromatic fill is `--primary` pink. ~~any chromatic addition competes with the single black CTA~~ **修订：** 黑钮已废止，粉红是唯一实底。
- Do not use box-shadows on cards or content surfaces — the design relies on hairline borders and whitespace for structure; shadows would add visual noise the system explicitly avoids
- Do not use 8px or 12px radius on buttons — the pill (9999px) is a signature; non-pill buttons would break visual continuity with the tag chip row and search input
- Do not use weight 700 or 800 anywhere — the heaviest weight in the system is 600, and only at the 28px heading size; heavier weights would feel aggressive against the restrained type
- Do not set body text below 16px — 17px is the base; smaller text (13-14px) is reserved for nav, labels, and metadata where compactness is functional
- Do not use colored backgrounds for section breaks — separate sections with whitespace alone; the system has exactly two surface tones (Paper and Ash) and they appear only for interactive hover states
- Do not add icons inside buttons or text links — the system is text-first; icons appear only in the search input and nav utility area

## Surfaces

| Level | Name | Value | Purpose |
|-------|------|-------|---------|
| 0 | Paper | `#ffffff` | Base canvas — all content sits directly on this surface |
| 1 | Ash | `#f1f1f1` | Elevated surface for language selector and subtle hover/selected states |
| 2 | Whisper | `#0000000a` | Interactive surface tint for ghost button hover and card selection |

## Elevation

- **Outlined Pill Button (hover state):** `rgba(0, 0, 0, 0.02) 0px 4px 6px 0px, rgba(0, 0, 0, 0.05) 0px 0px 2px 0px`

## Imagery

Photography is high-impact and editorial: large-format cosmic/space imagery (planets, solar surfaces, nebulae) for hero articles, product UI screenshots for business sections, and abstract gradient washes (sunrise oranges, soft purples) for story cards. Images are edge-to-edge within cards with 6px corner radius — no padding insets, no drop shadows. The visual treatment is cinematic and full-bleed rather than lifestyle or product-shot. Illustrations and 3D renders are absent; the system uses photography as its primary visual medium. Icon style is minimal: thin-stroke line icons (search magnifier, arrow-up submit) at monochrome #000, no filled icons, no multi-color iconography.

## Layout

Page model is max-width contained (approximately 1200px) with generous side margins. The hero is a vertically centered prompt interaction on an empty white canvas — the search input is the entire first screen, creating a 'command line' feeling. Below the hero, content flows in a 2-column asymmetric grid: a large featured article (spanning ~65% width) on the left with full-bleed photography, and a stacked column of smaller article cards on the right. Section rhythm is consistent vertical spacing (32-64px gaps) with no background color shifts between sections. Navigation is a minimal top bar — no mega-menu, no sidebar. The overall density is spacious and editorial: one article per visual unit, large type, breathing room between elements. No card grids with 3+ columns; the layout favors 2-column editorial compositions over dashboard-style information density.

## Agent Prompt Guide

**Quick Color Reference**
- text primary: #000000
- text secondary: #666666
- text tertiary: #8f8f8f
- background: #ffffff
- surface subtle: #f1f1f1
- border: rgba(0,0,0,0.12)
- primary action: `--primary` `#C73B7A` + `--primary-fg` `#FFFFFF`（不是 Obsidian 黑）

**Example Component Prompts**

1. **Hero Prompt Input**: Center a search-style input on a #ffffff canvas. Input: transparent background, 1px solid rgba(0,0,0,0.12) border, 9999px radius, 10px/52px/10px/24px padding, placeholder text 'Plan a surf trip to Costa Rica in August' at 16px weight 400 in #666666. Above it, a heading 'What can I help with?' at 48px weight 500, #000000, letter-spacing -1.44px. Below, a row of 4 outlined pill buttons (tag chips) spaced 8px apart.

2. **Featured Article Card (Left Column)**: Full-bleed photographic header (no border, 6px radius), 48px display headline below in #000 weight 500 with -0.03em tracking, metadata line at 14px weight 500 in #666666 reading 'Product · 12 min read'. Card has no background, no shadow, no padding — structure comes from spacing alone.

3. **Outlined Pill Tag Chip**: Transparent background, 1px solid rgba(0,0,0,0.12) border, 9999px radius, 8px/20px padding, text at 14px weight 500 in #000000. Use for category filters, suggested actions, and quick-prompt shortcuts.

4. **Secondary Article Card (Right Column)**: Smaller format — 16:9 image header with 6px radius, 22px subheading in #000 weight 500 with -0.01em tracking, 14px metadata in #666666. Stacks vertically with 32px gap between cards.

5. **Top Navigation Bar**: 64px height, #ffffff background, wordmark at far left at 14px weight 500, nav items spaced 16px apart at 14px weight 500 in #000, a search icon, a ghost text button, and one filled `--primary` pink button (9999px radius, white text) at far right. ~~filled black button~~ **废止。**

## Similar Brands

- **Anthropic** — Same monochromatic editorial approach — black text on white, no accent colors, pill-shaped buttons, and a focus on large-format photography for content cards
- **Vercel** — Identical restraint philosophy — pure black/white palette, hairline borders at low opacity, generous whitespace, and the same anti-decorative flatness
- **Linear** — Similar dark-on-light typographic confidence with custom sans, pill buttons, and 6-8px card radii — though Linear adds subtle gradients Linear omits
- **Stripe** — Shared editorial-composition approach: 2-column asymmetric article grids, large display headlines, photography as visual anchor, and zero chromatic UI accents
- **xAI / Grok** — Monochrome product interface with a single filled CTA, pill-shaped controls, and the same 'research lab' typographic authority（对照品牌用黑钮；本产品主填充是 `--primary` 粉红）

## Quick Start

### CSS Custom Properties

```css
:root {
  /* Colors */
  --primary: #C73B7A;
  --primary-fg: #FFFFFF;
  --primary-hover: #A82F66;
  --color-obsidian: #000000; /* text / hairline source only; not filled CTA */
  --color-graphite: #666666;
  --color-smoke: #8f8f8f;
  --color-paper: #ffffff;
  --color-ash: #f1f1f1;
  --color-hairline: #0000001f;
  --color-whisper: #0000000a;

  /* Typography — Font Families */
  --font-sans: Inter, "OpenAI Sans", "PingFang SC", "Noto Sans SC", ui-sans-serif, system-ui, sans-serif;
  --font-openai-sans: Inter, "OpenAI Sans", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;

  /* Typography — Scale */
  --text-caption: 13px;
  --leading-caption: 1.51;
  --tracking-caption: -0.13px;
  --text-input: 16px;
  --leading-input: 1.5;
  --tracking-input: -0.16px;
  --text-body-lg: 18px;
  --leading-body-lg: 1.32;
  --tracking-body-lg: -0.18px;
  --text-subheading: 22px;
  --leading-subheading: 1.26;
  --tracking-subheading: -0.22px;
  --text-heading: 28px;
  --leading-heading: 1.21;
  --tracking-heading: 0.31px;
  --text-display: 48px;
  --leading-display: 1.16;
  --tracking-display: -1.44px;

  /* Typography — Weights */
  --font-weight-regular: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;

  /* Spacing */
  --spacing-unit: 4px;
  --spacing-4: 4px;
  --spacing-8: 8px;
  --spacing-12: 12px;
  --spacing-16: 16px;
  --spacing-20: 20px;
  --spacing-24: 24px;
  --spacing-32: 32px;
  --spacing-40: 40px;
  --spacing-52: 52px;
  --spacing-64: 64px;
  --spacing-80: 80px;
  --spacing-120: 120px;

  /* Layout */
  --page-max-width: 1200px;
  --section-gap: 32-64px;
  --card-padding: 12px;
  --element-gap: 12-16px;

  /* Border Radius */
  --radius-md: 4px;
  --radius-md-2: 6.08px;
  --radius-3xl: 24px;
  --radius-3xl-2: 40px;
  --radius-full: 9999px;

  /* Named Radii */
  --radius-tags: 9999px;
  --radius-cards: 6px;
  --radius-links: 4px;
  --radius-inputs: 9999px;
  --radius-buttons: 9999px;

  /* Shadows */
  --shadow-sm: rgba(0, 0, 0, 0.02) 0px 4px 6px 0px, rgba(0, 0, 0, 0.05) 0px 0px 2px 0px;

  /* Surfaces */
  --surface-paper: #ffffff;
  --surface-ash: #f1f1f1;
  --surface-whisper: #0000000a;
}
```

### Tailwind v4

```css
@theme {
  /* Colors */
  --color-primary: #C73B7A;
  --color-primary-fg: #FFFFFF;
  --color-obsidian: #000000; /* text only */
  --color-graphite: #666666;
  --color-smoke: #8f8f8f;
  --color-paper: #ffffff;
  --color-ash: #f1f1f1;
  --color-hairline: #0000001f;
  --color-whisper: #0000000a;

  /* Typography */
  --font-sans: Inter, "OpenAI Sans", "PingFang SC", "Noto Sans SC", ui-sans-serif, system-ui, sans-serif;
  --font-openai-sans: Inter, "OpenAI Sans", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;

  /* Typography — Scale */
  --text-caption: 13px;
  --leading-caption: 1.51;
  --tracking-caption: -0.13px;
  --text-input: 16px;
  --leading-input: 1.5;
  --tracking-input: -0.16px;
  --text-body-lg: 18px;
  --leading-body-lg: 1.32;
  --tracking-body-lg: -0.18px;
  --text-subheading: 22px;
  --leading-subheading: 1.26;
  --tracking-subheading: -0.22px;
  --text-heading: 28px;
  --leading-heading: 1.21;
  --tracking-heading: 0.31px;
  --text-display: 48px;
  --leading-display: 1.16;
  --tracking-display: -1.44px;

  /* Spacing */
  --spacing-4: 4px;
  --spacing-8: 8px;
  --spacing-12: 12px;
  --spacing-16: 16px;
  --spacing-20: 20px;
  --spacing-24: 24px;
  --spacing-32: 32px;
  --spacing-40: 40px;
  --spacing-52: 52px;
  --spacing-64: 64px;
  --spacing-80: 80px;
  --spacing-120: 120px;

  /* Border Radius */
  --radius-md: 4px;
  --radius-md-2: 6.08px;
  --radius-3xl: 24px;
  --radius-3xl-2: 40px;
  --radius-full: 9999px;

  /* Shadows */
  --shadow-sm: rgba(0, 0, 0, 0.02) 0px 4px 6px 0px, rgba(0, 0, 0, 0.05) 0px 0px 2px 0px;
}
```
