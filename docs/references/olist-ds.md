---
version: alpha
name: "olist ds"
website: "https://designsystem.olist.io"
description: >-
  Design system do ecossistema Olist com arquitetura de tokens em 3 níveis
  (base, theme e component) suportando múltiplos temas por produto — base,
  Vnda, Fulfillment, Tiny, Tiny Dark e Rebrand. Azul primário #043FBE,
  tipografia Plus Jakarta Sans, spacing semântico (stack/inline/inset) e
  radius progressivo por complexidade de componente.
colors:
  primary: "#043FBE"
  primary-soft: "#6791EA"
  primary-strong: "#002D8F"
  primary-softest: "#E7EDF8"
  informative: "#0A4EE4"
  alert: "#B3261E"
  notice: "#DDAA01"
  success: "#168821"
  neutral-ink: "#1B1B1B"
  canvas: "#FFFFFF"
typography:
  mini:
    fontFamily: "Plus Jakarta Sans, sans-serif"
    fontSize: "12px"
    fontWeight: 400
  body:
    fontFamily: "Plus Jakarta Sans, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  subtitle:
    fontFamily: "Plus Jakarta Sans, sans-serif"
    fontSize: "16px"
    fontWeight: 500
    lineHeight: "24px"
  heading:
    fontFamily: "Plus Jakarta Sans, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: "28px"
  display:
    fontFamily: "Plus Jakarta Sans, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: "36px"
rounded:
  1xsmall: "4px"
  small: "8px"
  medium: "12px"
  large: "24px"
  circle: "50%"
spacing:
  stack-small: "16px"
  stack-medium: "24px"
  inset-medium: "24px"
  inline-small: "16px"
---

## Overview

O **olist design system** foi criado para empoderar os *olisters* a produzir experiências universais de forma rápida, escalável e consistente. O desafio estrutural é único no varejo tech brasileiro: o ecossistema Olist agrega produtos adquiridos (Tiny ERP, Vnda, Fulfillment...) que precisam parecer uma família sem abrir mão das identidades locais.

A resposta é a **arquitetura de design tokens em 3 níveis** — o traço mais sofisticado do sistema:

1. **Base tokens** — o leque completo de valores literais (`$color-blue-600`, `$font-size-400`), organizados por categoria. Nem todos são usados em todos os temas
2. **Theme tokens** — nomenclatura semântica por contexto (`$color-primary-base`), podendo apontar para base tokens diferentes em cada tema
3. **Component tokens** — ligados à função na tela (`$color-background-dropdown-button-primary-focus`) e sempre resolvidos via theme tokens, nunca direto nos base

Nomenclatura inspirada em B.E.M. A troca de tema é feita pelo componente `ThemeProvider`.

### Temas disponíveis

| Tema | Status | Produto |
|---|---|---|
| `olist base` | estável | Ecossistema principal |
| `vnda` | beta | Plataforma Vnda |
| `fulfillment` | estável | Logística |
| `tiny` / `tiny dark` | estável / alpha | Tiny ERP |
| `rebrand` | alpha/beta | Nova identidade Olist |

### Características-chave

- Azul primário `{colors.primary}` (#043FBE) com contraste AA garantido por construção: tons 100–400 contrastam contra gray-800; tons 500–800 contra branco
- Tipografia **Plus Jakarta Sans** (token `$font-family-brand`) com Arial como secundária
- Espaçamento semântico em 5 papéis: **stack** (vertical), **inline** (horizontal), **inset** (margem interna), **squished inset** (mais horizontal) e **stretched inset** (mais vertical)
- Radius progressivo por complexidade: quanto mais complexo o componente, maior o raio
- ~40 componentes React + templates (DataTable, application layout, page list)

## Colors

### Estrutura

Base colors organizadas por família (blue, red, yellow, green, gray...) em níveis 100–800+. Os theme tokens dividem-se em **UI** (componentes de interface) e **Graph and Data** (gráficos e dados).

| Papel | Uso |
|---|---|
| `{colors.primary}` (#043FBE) | Cor da marca, alta prioridade, elementos interativos |
| `{colors.informative}` | Dicas e novidades — elementos estáticos |
| `{colors.notice}` | Notificações e status de sistema |
| `{colors.alert}` | Ações críticas/destrutivas |
| `{colors.success}` | Confirmações |
| `{colors.neutral-ink}` | Texto e elementos auxiliares |

### Intensidades

Cada papel tem 6 intensidades com função definida: **softest** (fundos/textos, só neutral), **softer** (fundos), **soft** (decoração), **base** (ações e destaques), **strong** (hover/pressed e texto), **stronger** (fundos invertidos).

## Typography

| Token | Tamanho | Weight | Line-height | Uso |
|---|---|---|---|---|
| `{typography.display}` | 28px | 700 | 36px | Números e títulos hero |
| `{typography.heading}` | 20px | 600 | 28px | Títulos de seção |
| `{typography.subtitle}` | 16px | 500 | 24px | Subtítulos |
| `{typography.body}` | 14px | 400 | 20px | Corpo padrão |
| `{typography.mini}` | 12px | 400 | 16px | Labels e metadados |

Pesos: regular 400 · medium 500 · bold 600 · 1xbold 700 (extras 200/300 disponíveis). Letter-spacing: tight 0px, regular 1px, loose 2px.

> Curiosidade técnica: o token secundário chama-se `$font-family-poppins`, mas seu valor é Arial — vestígio documentado da evolução do tema.

## Layout

- **Escala linear de spacing:** cresce somando 2px até 4px, 4px até 16px, 8px até 64px e 16px até 256px
- **Squished inset** (ex.: input 12×24): horizontal maior que vertical
- **Stretched inset** (ex.: textarea 24×12): vertical maior que horizontal
- **Layout grid** próprio + breakpoints tokenizados
- Templates prontos: application layout, page layout, page list, DataTable, estados de loading

## Elevation & Depth

Sombras tokenizadas em níveis discretos, usadas com parcimônia — a hierarquia vem principalmente dos fundos neutros e bordas.

## Shapes

Radius progressivo por complexidade de componente:

| Token | Valor | Componentes |
|---|---|---|
| `{rounded.1xsmall}` | 4px | Fundos, badges, tooltips |
| `{rounded.small}` | 8px | Botões, inputs, checkboxes |
| `{rounded.medium}` | 12px | Cards, accordions — padrão geral |
| `{rounded.large}` | 24px | Modais, drawers |
| `{rounded.circle}` | 50% | Botões de ícone |

## Components

Alert, Badge, Box, Breadcrumb, Button, Card, Chart, Checkbox, Collapse, DatePicker, Description Item, Divider, Drawer, Dropdown, Emoji, FileUploader, Flex, Input Text/Search/Verification Code, Link, Loading, Modal, Navbar, Pagination, Progress Bar/Circle, Popover, Radio, Select, Side Navigation, Skeleton, SplashFeedback, Steps, Table, Tabs, Text, Textarea, Theme Provider, Timeline, Toast, Toggle, Tooltip, YouTube Video Player.

Componentes em beta seguem versionamento explícito (Navbar, Side Navigation, Skeleton, Link...). Status de cada um documentado publicamente.

## Do's and Don'ts

**Do** resolver cores sempre pelos theme tokens — o mesmo produto precisa funcionar nos 6 temas.

**Do** usar o papel semântico correto: `notice` para avisar não é `alert` para erro.

**Do** respeitar o radius progressivo — modal usa `{rounded.large}`, botão usa `{rounded.small}`, sempre.

**Don't** consumir base tokens direto em componentes; component tokens resolvem via theme tokens.

**Don't** inventar combinações de squished/stretched inset fora das pares documentados (4,8 / 8,16 / 12,24 / 16,32 / 24,48).

**Don't** usar cor como único diferencial visual (contraste AA validado por família).

## Known Gaps

- Valores hex completos das rampas além do azul (red/yellow/green/grey 100–800) estão nos pacotes internos GitLab (`gitlab.olist.io/frontend-platform/olist-design-system`) e não foram enumerados nesta extração
- Opacidade e sombras: fundamentos documentados, valores exatos não capturados aqui

---

## Attribution

| Campo | Valor |
|-------|-------|
| Source | [designsystem.olist.io](https://designsystem.olist.io/) |
| Design Tokens | [foundations/design-tokens](https://designsystem.olist.io/latest/foundations/design-tokens/overview) |
| Repositório | gitlab.olist.io/frontend-platform/olist-design-system (interno) |
| Catálogo | [Design Systems Brasileiros — olist ds](https://designsystemsbrasileiros.com/olist-ds/) |
| Method | Public documentation |
| Date | 2026-08-21 |

<!-- Source: https://designmd.app/brands/olist-ds · designmd.app -->
