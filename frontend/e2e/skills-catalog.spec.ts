import { devices, expect, test, type Page } from "@playwright/test";

/**
 * 技能目录页（/skills）对 docs/DESIGN.md 的验收。
 *
 * 依据是该文件的「员工端实施细则」（实施细则，非基本法）：
 *   密度档 data-dense-dashboard（列表行本身就是内容，不做卡片墙）
 *   §颜色（四种职责：主行动 / 辅助 / 类别 / 状态；类别色两档对比度）
 *   §控件尺寸（命名 token / 命中区 / 焦点态）
 *   §三轴适配（宽度 / 高度 / 输入模态分别处理）
 *   §不变量 1（同一视口 0–1 个实底主 CTA）、3（等待有恢复入口）、4（状态不靠颜色单独表达）
 *   §验收矩阵
 *
 * 2026-09-23 按 UI/UX 裁定重定依据（记录在案，不是为通过而放宽）：
 *   1. 行内异步标签「异步 · 可取消」移除，改由图标砖虚线边框承担形状信号。
 *      依据：docs/07-mcp-data-contract.md 只要求「不得伪装成同步」且必须有进度 / 取消 / 重试；
 *      本页动作是「填入输入框」，不执行任何作业，执行面契约未变，详情列仍完整交代异步口径。
 *   2. 行内动作「填入输入框」整条删除（连同它的链接式样式与 tabIndex=-1）：51 行 × 每行一个
 *      同样的动作既是噪声，也把唯一的主 CTA 稀释成 51 个。填技能只剩右栏详情列的实底主 CTA，
 *      中栏的行只负责「选中 / 预览」。
 *   3. 页面改成四栏（栏 2 技能目录 / 栏 3 搜索+列表 / 栏 4 详情），横跨三栏的页头行删除 ——
 *      「技能目录 + 计数」下沉成栏 2 的栏头并吸顶；搜索行留栏 3 顶部并 sticky（铺满栏宽）；
 *      栏 4 改三段式（头固定 / 正文独立滚 / footer 固定），正文滚动时主 CTA 不被顶走。
 *   4. 栏 3/栏 4 的内容全部指回技能文件：入口口径 = `employee_quick` / `employee_agent`，
 *      说明书 = `## 员工口径`（服务端过白名单后给 `employee_doc`），示例 = `employee_example`。
 *      页面里手抄的三张表（场景标签 / 输入输出 / 覆盖表口径）整组删除 —— 文件是唯一真相。
 */

/** 解析根作用域上的 token 值。 */
async function cssVar(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement("div");
    probe.style.color = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    document.body.appendChild(probe);
    const rgb = getComputedStyle(probe).color;
    probe.remove();
    return rgb;
  }, token);
}

/** 解析**本页作用域内**的 token 值（本页自己定义 --icon-* 等页面级 token）。 */
async function pageVar(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const host = document.querySelector<HTMLElement>(".skill-catalog-page");
    const probe = document.createElement("div");
    probe.style.color = getComputedStyle(host ?? document.documentElement).getPropertyValue(name).trim();
    (host ?? document.body).appendChild(probe);
    const rgb = getComputedStyle(probe).color;
    probe.remove();
    return rgb;
  }, token);
}

/** 解析本页作用域内的长度 token，返回像素数。 */
async function pageVarPx(page: Page, token: string): Promise<number> {
  return page.evaluate((name) => {
    const host = document.querySelector<HTMLElement>(".skill-catalog-page");
    const probe = document.createElement("div");
    probe.style.width = getComputedStyle(host ?? document.documentElement).getPropertyValue(name).trim();
    (host ?? document.body).appendChild(probe);
    const px = Number.parseFloat(getComputedStyle(probe).width);
    probe.remove();
    return px;
  }, token);
}

/** 计算对比度：断言里直接算，而不是靠人眼。 */
async function contrastOf(page: Page, a: string, b: string): Promise<number> {
  return page.evaluate(
    ([x, y]) => {
      // Chromium 对 color-mix 的结果给的是 `color(srgb r g b)`（0–1），hex / rgb() 给的是 0–255。
      // 两种都要认，否则 color-mix 派生 token 会被读成 ≈0 的暗色，对比度恒等于 1。
      const lum = (c: string) => {
        const m = c.match(/[\d.]+/g);
        if (!m) return null as number | null;
        const scale = /^color\(/i.test(c.trim()) ? 255 : 1;
        const [r, g, b] = m.slice(0, 3).map((v) => Number(v) * scale);
        const f = (v: number) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const l1 = lum(x);
      const l2 = lum(y);
      return Math.round(((Math.max(l1!, l2!) + 0.05) / (Math.min(l1!, l2!) + 0.05)) * 100) / 100;
    },
    [a, b],
  );
}

/** 页面作用域内所有「可见 + 有色」的元素快照，供白名单/命中区断言复用。 */
const VISIBLE_PROPS = ["color", "backgroundColor", "borderTopColor", "borderLeftColor"] as const;

async function ready(page: Page) {
  await page.goto("/skills");
  await page.locator("[data-skill-catalog]").waitFor();
  await page.locator(".skill-row").first().waitFor();
}

test.describe("技能目录页（/skills）", () => {
  test.beforeEach(async ({ page }) => {
    await ready(page);
  });

  test("§不变量 1：同一视口最多 1 个实底主 CTA，且其文字对比度 ≥4.5", async ({ page }) => {
    const primary = await pageVar(page, "--primary");
    const filled = await page.evaluate((rgb) => {
      const all = [...document.querySelectorAll<HTMLElement>("[data-skill-catalog] *")];
      return all.filter((el) => {
        const cs = getComputedStyle(el);
        return cs.backgroundColor === rgb && cs.visibility !== "hidden" && el.getBoundingClientRect().width > 0;
      }).length;
    }, primary);
    expect(filled, `实底 CTA 应为 0–1 个，实测 ${filled} 个`).toBeLessThanOrEqual(1);

    const cta = page.locator(".skill-btn-primary").first();
    await expect(cta).toBeVisible();
    const [fg, bg] = await cta.evaluate((el) => {
      const s = getComputedStyle(el);
      return [s.color, s.backgroundColor];
    });
    const cr = await contrastOf(page, fg, bg);
    expect(cr, `实底 CTA 白字对比度 ${cr}:1，需要 ≥4.5`).toBeGreaterThanOrEqual(4.5);
  });

  test("§不变量 4：筛选段选中态有程序化状态，且不只有颜色信号", async ({ page }) => {
    const onTab = page.locator(".skill-tab.on");
    await expect(onTab).toHaveAttribute("aria-pressed", "true");
    const diff = await page.evaluate(() => {
      const on = document.querySelector(".skill-tab.on");
      const off = [...document.querySelectorAll(".skill-tab")].find((el) => !el.classList.contains("on"));
      if (!on || !off) return null;
      const a = getComputedStyle(on);
      const b = getComputedStyle(off);
      return {
        weightDiffers: a.fontWeight !== b.fontWeight,
        shadowDiffers: a.boxShadow !== b.boxShadow,
        bgDiffers: a.backgroundColor !== b.backgroundColor,
        onShadow: a.boxShadow,
        offShadow: b.boxShadow,
      };
    });
    expect(diff, "至少要有两个 tab 才能比较状态").not.toBeNull();
    expect(
      diff!.weightDiffers || diff!.shadowDiffers,
      `选中态必须有非颜色信号（字重或投影）：on=${diff!.onShadow} off=${diff!.offShadow}`,
    ).toBe(true);
  });

  test("§不变量 4：列表行选中态 = aria-pressed + 底色 + 左侧形状信号", async ({ page }) => {
    const row = page.locator(".skill-row").first();
    const name = row.locator(".skill-row-name");
    await expect(name).toHaveAttribute("aria-pressed");
    const before = await row.evaluate((el) => getComputedStyle(el).backgroundColor);
    await name.click();
    await expect(name).toHaveAttribute("aria-pressed", "true");
    const after = await row.evaluate((el) => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, shadow: s.boxShadow };
    });
    expect(after.bg, "选中行必须有底色变化").not.toBe(before);
    expect(after.shadow, "选中行必须有非颜色的形状信号（左侧内阴影条）").toContain("inset");
  });

  test("§控件尺寸：控件高度一律取自命名 token", async ({ page }) => {
    const [chip, badge, lg, sm] = await Promise.all([
      pageVarPx(page, "--chip-h"),
      pageVarPx(page, "--badge-h"),
      pageVarPx(page, "--control-h-lg"),
      pageVarPx(page, "--control-h-sm"),
    ]);
    const h = (sel: string) => page.locator(sel).first().evaluate((el) => el.getBoundingClientRect().height);
    const cssH = (sel: string) =>
      page.locator(sel).first().evaluate((el) => Number.parseFloat(getComputedStyle(el).height));
    // 筛选条改成「发丝底线 + 2px 选中线」后，它的高度走 --control-h-lg（不再是胶囊的 --chip-h）。
    expect(await h(".skill-tab"), "筛选段高度取 --control-h-lg").toBeCloseTo(lg, 0);
    // 标记在窄的列表列里会被收起（见 styles.css 的 @container 段），所以取**可见**的第一个：
    // 页面上一枚标记都不可见才算违规。
    const badgeH = await page.evaluate(() => {
      const el = [...document.querySelectorAll<HTMLElement>("[data-skill-catalog] .skill-mark")]
        .find((e) => e.getBoundingClientRect().height > 0);
      return el ? getComputedStyle(el).height : null;
    });
    expect(badgeH, "页面上必须至少有一枚可见的标记").not.toBeNull();
    expect(Number.parseFloat(badgeH!), "标记高度取 --badge-h").toBeCloseTo(badge, 0);
    expect(await cssH(".skill-search-wrap"), "搜索框高度取 --control-h-lg").toBeCloseTo(lg, 0);
    expect(await cssH(".skill-row-icon"), "列表图标砖边长取 --control-h-lg").toBeCloseTo(lg, 0);
    expect(await cssH(".skill-detail-toggle"), "图标按钮边长取 --control-h-sm").toBeCloseTo(sm, 0);
    expect(
      await cssH(".skill-detail-footer .skill-btn"),
      "详情列主 CTA 高度取 --control-h-lg",
    ).toBeCloseTo(lg, 0);
  });

  test("§控件尺寸：每个可操作元素的命中区 ≥ --hit-min", async ({ page }) => {
    const hitMin = await pageVarPx(page, "--hit-min");
    const bad = await page.evaluate((min) => {
      const sel =
        ":is(a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex='-1']))";
      const out: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>(`[data-skill-catalog] ${sel}`)) {
        const r = el.getBoundingClientRect();
        if (getComputedStyle(el).display === "none" || r.width === 0) continue;
        if (r.height < min || r.width < min) {
          out.push(`${el.className || el.tagName} ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
      }
      return [...new Set(out)];
    }, hitMin);
    expect(bad, `命中区不足 ${hitMin}px 的元素（WCAG 2.2 AA 2.5.8）：${JSON.stringify(bad)}`).toEqual([]);
  });

  test("§控件尺寸：键盘焦点出现 --focus-ring 可见环", async ({ page }) => {
    const [width, color] = await Promise.all([
      page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--focus-ring-width").trim()),
      cssVar(page, "--focus-ring"),
    ]);
    // 必须用键盘到达：只有真正键盘聚焦才会命中 :focus-visible。
    let focused = "";
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      focused = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.className || "");
      if (focused.includes("skill-row-name")) break;
    }
    expect(focused, "Tab 必须能到达列表行的选择入口").toContain("skill-row-name");
    const got = await page.locator(".skill-row-name:focus").evaluate((el) => {
      const s = getComputedStyle(el);
      return { w: s.outlineWidth, c: s.outlineColor, style: s.outlineStyle };
    });
    expect(Number.parseFloat(got.w), `焦点环宽度应为 ${width}，实测 ${got.w}`).toBeCloseTo(Number.parseFloat(width), 1);
    expect(got.style, "焦点环必须是实线").toBe("solid");
    expect(got.c, `焦点环颜色应为 --focus-ring`).toBe(color);
  });

  test("§三轴适配 · 宽度轴：内容列不超过 --content-max（sticky 搜索行除外）", async ({ page }) => {
    const max = await page.evaluate(() =>
      Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--content-max")),
    );
    // 搜索行是唯一的例外：它按设计铺满整栏（底色与底缘发丝线要横贯，见 styles.css 的
    // `.skill-catalog-content > .skill-search-row`），但它**内部**的搜索框仍住在内容列上限里。
    const widths = await page.locator(".skill-catalog-content > :not(.skill-search-row)").evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect().width),
    );
    expect(widths.length, "内容列里应当有分组").toBeGreaterThan(0);
    for (const w of widths) {
      expect(w, `内容列 ${Math.round(w)}px 超过 --content-max(${max}px)`).toBeLessThanOrEqual(max + 1);
    }
    const search = await page.locator(".skill-search-row").evaluate((el) => ({
      row: el.getBoundingClientRect().width,
      column: (el.parentElement as HTMLElement).clientWidth,
      box: (el.querySelector(".skill-search-wrap") as HTMLElement).getBoundingClientRect().width,
    }));
    expect(search.row, "搜索行铺满栏宽（底色与底缘线横贯整栏）").toBeCloseTo(search.column, 0);
    expect(search.box, "搜索框自身仍在内容列内").toBeLessThanOrEqual(search.column + 1);
  });

  test("§三轴适配 · 宽度轴：S 档无横向滚动、行不溢出", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    await ready(page);
    const r = await page.evaluate(() => ({
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      rows: [...document.querySelectorAll<HTMLElement>(".skill-row")]
        .map((el) => el.scrollWidth - el.clientWidth)
        .filter((n) => n > 1),
    }));
    expect(r.docOverflow, "S 档不得出现横向滚动").toBeLessThanOrEqual(0);
    expect(r.rows, `行内容溢出：${JSON.stringify(r.rows)}`).toEqual([]);
    await ctx.close();
  });

  test("§三轴适配 · 输入模态轴：触摸设备命中区 ≥44px", async ({ browser }) => {
    const context = await browser.newContext({ ...devices["iPhone 13"] });
    const page = await context.newPage();
    await ready(page);
    const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
    expect(coarse, "该环境未上报 coarse 指针，断言无意义").toBe(true);
    // 行内「填入输入框」链接已随 2026-09-23 裁定删除，触摸档要验的可点元素只剩这两类。
    for (const sel of [".skill-tab", ".skill-row-name"]) {
      const box = await page.locator(sel).first().boundingBox();
      expect(box!.height, `触摸档 ${sel} 命中区应 ≥44px，实测 ${box!.height}px`).toBeGreaterThanOrEqual(44);
    }
    await context.close();
  });

  test("§不变量 3：空结果提供恢复动作", async ({ page }) => {
    await page.getByRole("textbox", { name: "搜索技能 / SOP / 场景" }).fill("不存在的技能名zzz");
    const state = page.locator(".skill-state");
    await expect(state).toBeVisible();
    await expect(state.getByRole("button", { name: "清除筛选" })).toBeVisible();
  });

  test("搜索框有程序化标签，不是只靠 placeholder", async ({ page }) => {
    await expect(page.getByRole("textbox", { name: "搜索技能 / SOP / 场景" })).toBeVisible();
  });

  test("「查看全部」深链真正生效（tab 读 URL）", async ({ page }) => {
    await page.goto("/skills?tab=frequent");
    await page.locator("[data-skill-catalog]").waitFor();
    await expect(page.locator(".skill-tab.on")).toHaveText("常用");
    await expect(page.locator(".skill-tab.on")).toHaveAttribute("aria-pressed", "true");
  });

  test("结构真的画出来：列表分隔线与实底 CTA 圆角不得因未定义 token 而失效", async ({ page }) => {
    const list = await page.locator(".skill-list").first().evaluate((el) => {
      const s = getComputedStyle(el);
      return { w: Number.parseFloat(s.borderTopWidth), c: s.borderTopColor };
    });
    expect(list.w, "列表容器必须有上下发丝线").toBeGreaterThanOrEqual(1);
    expect(list.c, "发丝线必须是可见颜色，而不是 transparent").not.toBe("rgba(0, 0, 0, 0)");

    const row = await page.locator(".skill-row").first().evaluate((el) => {
      const s = getComputedStyle(el);
      return { w: Number.parseFloat(s.borderBottomWidth), c: s.borderBottomColor };
    });
    expect(row.w, "行之间必须有分隔线").toBeGreaterThanOrEqual(1);
    expect(row.c).not.toBe("rgba(0, 0, 0, 0)");

    const radius = await page.locator(".skill-btn-primary").first().evaluate((el) =>
      Number.parseFloat(getComputedStyle(el).borderTopLeftRadius),
    );
    expect(radius, "实底 CTA 的圆角必须来自 --radius-control，不得归 0").toBeGreaterThan(0);
  });

  test("§控件尺寸：本页图标只有两档尺寸，且保持正方形", async ({ page }) => {
    const m = await page.evaluate(() => {
      const svgs = [...document.querySelectorAll<SVGSVGElement>("[data-skill-catalog] svg")]
        .map((s) => s.getBoundingClientRect())
        .filter((r) => r.width > 0)
        .map((r) => `${Math.round(r.width)}x${Math.round(r.height)}`);
      return [...new Set(svgs)];
    });
    const allowed = [
      `${Math.round(await pageVarPx(page, "--icon-sm"))}x${Math.round(await pageVarPx(page, "--icon-sm"))}`,
      `${Math.round(await pageVarPx(page, "--icon-md"))}x${Math.round(await pageVarPx(page, "--icon-md"))}`,
    ];
    expect(m.length, "页面里应当有图标").toBeGreaterThan(0);
    for (const size of m) {
      const [w, h] = size.split("x").map(Number);
      expect(w, `图标 ${size} 被拉伸`).toBe(h);
      expect(allowed, `图标 ${size} 不在本页图标阶梯 ${JSON.stringify(allowed)} 内`).toContain(size);
    }
  });

  test("§颜色：粉色只出现在唯一的主行动 CTA 上", async ({ page }) => {
    await ready(page);
    const primary = await pageVar(page, "--primary");
    const users = await page.evaluate((p) => {
      const out: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>("[data-skill-catalog] *")) {
        const cs = getComputedStyle(el);
        if (cs.display === "none" || el.getBoundingClientRect().width === 0) continue;
        if (
          cs.backgroundColor === p || cs.color === p ||
          cs.borderTopColor === p || cs.borderBottomColor === p
        ) {
          out.push(String(el.className || el.tagName));
        }
      }
      return [...new Set(out)];
    }, primary);
    expect(users.length, "页面上应当有且只有一个实底主 CTA").toBeGreaterThan(0);
    for (const u of users) {
      expect(u, `粉色出现在非主行动元素上：${u}`).toContain("skill-btn-primary");
    }
  });

  test("§颜色：辅助色分两档——图形 ≥3:1、文字 ≥4.5:1，且用对位置", async ({ page }) => {
    await ready(page);
    const canvas = await pageVar(page, "--bg");
    const accent = await pageVar(page, "--accent");
    const accentText = await pageVar(page, "--accent-text");
    expect(await contrastOf(page, accent, canvas), "辅助色作图形需 ≥3:1").toBeGreaterThanOrEqual(3);
    expect(await contrastOf(page, accentText, canvas), "辅助色作文字/图标字形需 ≥4.5:1").toBeGreaterThanOrEqual(4.5);

    expect(
      await page.locator(".skill-tab.on").first().evaluate((el) => getComputedStyle(el).borderBottomColor),
      "分段选中底线用图形档",
    ).toBe(accent);
  });

  test("§颜色：类别色两档（图形 ≥3:1、砖内字形 ≥4.5:1），并按 data-tone 落在图标砖上", async ({ page }) => {
    await ready(page);
    const canvas = await pageVar(page, "--bg");
    const tones = ["library", "assistant", "crawl", "builtin"] as const;
    type Tone = (typeof tones)[number];
    const tokens = {} as Record<Tone, { base: string; text: string; tile: string; line: string }>;
    for (const tone of tones) {
      tokens[tone] = {
        base: await pageVar(page, `--cat-${tone}`),
        text: await pageVar(page, `--cat-${tone}-text`),
        tile: await pageVar(page, `--cat-${tone}-tile`),
        line: await pageVar(page, `--cat-${tone}-line`),
      };
      expect(
        await contrastOf(page, tokens[tone].text, tokens[tone].tile),
        `类别 ${tone} 的字形档对砖底需 ≥4.5:1`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        await contrastOf(page, tokens[tone].base, canvas),
        `类别 ${tone} 的图形档对画布需 ≥3:1`,
      ).toBeGreaterThanOrEqual(3);
    }

    const rendered = await page.locator(".skill-row-icon[data-tone]").evaluateAll((els) =>
      els.map((el) => {
        const cs = getComputedStyle(el);
        const row = el.closest(".skill-row");
        return {
          tone: el.getAttribute("data-tone") || "",
          row: row ? row.className : "",
          color: cs.color,
          bg: cs.backgroundColor,
          border: cs.borderTopColor,
          borderStyle: cs.borderTopStyle,
        };
      }),
    );
    expect(rendered.length, "列表里应当有带类别的图标砖").toBeGreaterThan(0);
    for (const r of rendered) {
      const tone = r.tone as Tone;
      expect(tones as readonly string[], `未知类别 ${r.tone}`).toContain(r.tone);
      expect(r.color, `图标砖字形必须取 --cat-${tone}-text`).toBe(tokens[tone].text);
      expect(r.bg, `图标砖底必须取 --cat-${tone}-tile`).toBe(tokens[tone].tile);
      if (r.row.includes("is-async")) {
        // 异步作业：虚线描边是形状信号，线色取砖内字形档（保证可见，不伪装成同步）。
        expect(r.borderStyle, "异步作业的图标砖必须是虚线").toBe("dashed");
        expect(r.border).toBe(tokens[tone].text);
      } else if (!r.row.includes("is-write")) {
        expect(r.border, `图标砖描边必须取 --cat-${tone}-line`).toBe(tokens[tone].line);
      }
    }
  });

  test("§颜色：类别色在深色下仍满足两档（字形 ≥4.5:1、图形 ≥3:1）", async ({ page }) => {
    await ready(page);
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    const canvas = await pageVar(page, "--bg");
    for (const tone of ["library", "assistant", "crawl", "builtin"]) {
      const text = await pageVar(page, `--cat-${tone}-text`);
      const tile = await pageVar(page, `--cat-${tone}-tile`);
      const base = await pageVar(page, `--cat-${tone}`);
      expect(
        await contrastOf(page, text, tile),
        `深色下类别 ${tone} 的字形档对砖底需 ≥4.5:1`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        await contrastOf(page, base, canvas),
        `深色下类别 ${tone} 的图形档对画布需 ≥3:1`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  test("控件自设 line-height，不继承根的 24px 行盒", async ({ page }) => {
    const bad = await page.evaluate(() => {
      const out: string[] = [];
      const rootCs = getComputedStyle(document.documentElement);
      const rootLh = Number.parseFloat(rootCs.lineHeight);
      const rootFs = Number.parseFloat(rootCs.fontSize);
      const sel =
        ":is(a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex='-1']))";
      for (const el of document.querySelectorAll<HTMLElement>(`[data-skill-catalog] ${sel}`)) {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (cs.display === "none" || r.width === 0) continue;
        const lh = Number.parseFloat(cs.lineHeight);
        const fs = Number.parseFloat(cs.fontSize);
        if (!Number.isFinite(lh)) out.push(`${el.className || el.tagName} lh=${cs.lineHeight}`);
        else if (lh === rootLh && fs !== rootFs) {
          out.push(`${el.className || el.tagName} 继承根行盒 ${cs.lineHeight}（字号 ${cs.fontSize}）`);
        }
      }
      return [...new Set(out)];
    });
    expect(bad, `这些控件没自设行高：${JSON.stringify(bad)}`).toEqual([]);
  });

  test("颜色反漂移：本页渲染色值都能指回它消费的 token", async ({ page }) => {
    await assertPaletteFromTokens(page);
  });

  test("工具风险档与异步契约：受控技能有文字标记、异步技能有图标砖形状信号", async ({ page }) => {
    await ready(page);
    // L3「需确认」：只标例外 —— 列表行上只出现受控技能的标记（只读不打标）。
    expect(
      await page.locator(".skill-row .skill-mark.is-write").count(),
      "列表里应当有受控技能的「需确认」标记",
    ).toBeGreaterThan(0);
    // 异步作业：2026-09-23 起不再挂文字标签，改由图标砖虚线边框承担形状信号（不伪装成同步）；
    // 完整异步口径仍在详情列（见「风险档与异步契约进入详情」）。
    const asyncTile = page.locator(".skill-row.is-async .skill-row-icon").first();
    await expect(asyncTile).toBeVisible();
    expect(
      await asyncTile.evaluate((el) => getComputedStyle(el).borderTopStyle),
      "异步作业的图标砖必须是虚线（与 L3 的实线不同形状）",
    ).toBe("dashed");
  });

  test("只标例外：列表行上不出现「只读」标记", async ({ page }) => {
    // 注意：描述文案里本来就可能含「只读」二字，这里断言的是标记元素本身。
    expect(await page.locator(".skill-row .skill-mark.is-read").count()).toBe(0);
  });

  test("列表行不再有动作：填技能只剩右栏详情列的实底主 CTA", async ({ page }) => {
    // 2026-09-23 UI/UX 裁定：行内「填入输入框」整条删除 —— 51 行 × 每行一个同样的动作
    // 既是噪声，也把唯一的主 CTA 稀释成 51 个；行只负责选中 / 预览，填技能走右栏。
    // 行里可点的只剩「行名」这一个入口（它本身就是行的选择入口）。
    const clickable = await page.locator(".skill-row").first().locator(":is(a[href], button)").count();
    expect(clickable, "列表行里除行名外不该再有可点元素").toBe(1);
    const cta = page.locator(".skill-detail-footer .skill-btn-primary");
    await expect(cta, "填技能的动作必须还在，且在右栏详情列").toBeVisible();
    await expect(cta).toHaveText("填入输入框");
  });

  test("本页不再出现「新建会话」（需先补参数，直接开会话是错误承诺）", async ({ page }) => {
    await expect(page.locator("[data-skill-catalog]")).not.toContainText("新建会话");
  });

  test("员工禁词：引擎名、MCP、英文 Skill 时序与原始 id 都不得出现在员工表面", async ({ page }) => {
    // 依据 specs/UX-EMPLOYEE.md §员工禁词：员工表面不摊 MCP、Codex、Thread、英文 Skill 时序、原始堆栈。
    const catalog = page.locator("[data-skill-catalog]");
    await expect(catalog).not.toContainText("MediaCrawler");
    await expect(catalog).not.toContainText("Starry KOL");
    await expect(catalog).not.toContainText("KOL Agent");
    await expect(catalog).not.toContainText("内核部门");
    // 引擎名 / 系统名：整页 textContent（含折叠区未展开内容）都不得出现。
    const text = await catalog.evaluate((el) => el.textContent || "");
    for (const banned of ["MCP", "Codex", "Thread", "starrykol", "kolclaw"]) {
      expect(text, `员工表面出现禁词「${banned}」`).not.toContain(banned);
    }

    // 本页自己渲染的这几个小节（使用步骤 / 执行边界 / 调用工具 / 所需权限 / 异步执行 / 回执）
    // 由页面做词表翻译：它们**一个字英文都不该有**——有就说明引擎 id 又漏出来了。
    const latin = await page.evaluate(() => {
      const wanted = new Set(["使用步骤", "执行边界", "调用工具", "所需权限", "异步执行", "回执"]);
      const out: string[] = [];
      for (const sec of document.querySelectorAll<HTMLElement>("[data-skill-detail] .skill-detail-section")) {
        const h = sec.querySelector("h4")?.textContent?.trim() || "";
        if (!wanted.has(h)) continue;
        // L1 / L2 / L3 是**要求可见**的分档标识（根 AGENTS.md §4），允许出现；
        // 除此之外这段文字里不该再有任何英文（引擎 id / 契约字段 / 厂商名）。
        const body = (sec.textContent || "").replace(h, "").replace(/L[123]/g, "").trim();
        if (/[A-Za-z]/.test(body)) out.push(`${h}: ${body.slice(0, 60)}`);
      }
      return out;
    });
    expect(latin, `这些小节仍有英文 / 引擎 id：\n${latin.join("\n")}`).toEqual([]);
  });

  test("§1 深色：实底主 CTA 仍达 4.5:1，且色值不扩散", async ({ page }) => {
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await page.waitForTimeout(250);
    const cta = page.locator(".skill-btn-primary").first();
    const [fg, bg] = await cta.evaluate((el) => {
      const s = getComputedStyle(el);
      return [s.color, s.backgroundColor];
    });
    const cr = await contrastOf(page, fg, bg);
    expect(cr, `深色主 CTA 的文字对比度只有 ${cr}:1（需要 ≥4.5）`).toBeGreaterThanOrEqual(4.5);
    await assertPaletteFromTokens(page);

    const filled = await page.evaluate((rgb) => {
      const all = [...document.querySelectorAll<HTMLElement>("[data-skill-catalog] *")];
      return all.filter((el) => getComputedStyle(el).backgroundColor === rgb).length;
    }, bg);
    expect(filled, `深色下实底元素应为 0–1 个，实测 ${filled} 个`).toBeLessThanOrEqual(1);
  });

  test("prefers-contrast: more 不改变页面画布", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, contrast: "more" });
    const page = await ctx.newPage();
    await ready(page);
    expect(await page.evaluate(() => matchMedia("(prefers-contrast: more)").matches)).toBe(true);
    const bg = await pageVar(page, "--bg");
    const canvas = await page.evaluate(
      () => getComputedStyle(document.querySelector("[data-skill-catalog]")!).backgroundColor,
    );
    expect(canvas, "该偏好下页面画布应仍取自 --bg").toBe(bg);
    await ctx.close();
  });
});

test.describe("四栏版式（栏 2 技能目录 / 栏 3 搜索+列表 / 栏 4 详情）", () => {
  test("几何：1280×900 下各栏左缘递增、栏 2 定宽 190px、三栏顶部对齐同一 y", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await ready(page);
    const geo = await page.evaluate(() => {
      const el = (sel: string) => document.querySelector<HTMLElement>(sel)!;
      const box = (sel: string) => el(sel).getBoundingClientRect();
      return {
        tabs: box(".skill-tabs"),
        content: box(".skill-catalog-content"),
        pane: box(".skill-detail-pane"),
        tabsBorderRight: Number.parseFloat(getComputedStyle(el(".skill-tabs")).borderRightWidth),
        contentLeftBorder: getComputedStyle(el(".skill-detail-pane")).borderLeftWidth,
        direction: getComputedStyle(el(".skill-tabs")).flexDirection,
        tabsListDirection: getComputedStyle(el(".skill-tabs-list")).flexDirection,
        titleText: (el(".skill-catalog-title h1").textContent || "").trim(),
        titleInTabs: Boolean(el(".skill-tabs .skill-catalog-title")),
        titleTop: box(".skill-catalog-title").top,
        titleLeft: box(".skill-catalog-title").left,
        tabsListLeft: box(".skill-tabs-list").left,
        titleTextLeft: box(".skill-catalog-title h1").left,
        tabLabelLeft: (() => {
          const tab = el(".skill-tab");
          const cs = getComputedStyle(tab);
          return tab.getBoundingClientRect().left
            + Number.parseFloat(cs.borderLeftWidth)
            + Number.parseFloat(cs.paddingLeft);
        })(),
        titleSiblings: [...el(".skill-tabs").children].map((c) => String((c as HTMLElement).className)),
      };
    });
    expect(geo.direction, "≥1280 栏 2 要变成纵向目录栏").toBe("column");
    expect(geo.tabsListDirection, "组内也纵向排").toBe("column");
    expect(geo.tabs.width, "栏 2 定宽 190px").toBeGreaterThanOrEqual(188);
    expect(geo.tabs.width, "栏 2 定宽 190px").toBeLessThanOrEqual(192);
    // 栏 2/3 与栏 3/4 各一条发丝线，栏与栏之间不留间隙（错开的正是那 1px 边框）。
    expect(geo.tabs.right, "栏 2 右缘不得压到栏 3").toBeLessThanOrEqual(geo.content.left + 1);
    expect(geo.content.left, "栏 3 左缘 ≤ 栏 4 左缘").toBeLessThanOrEqual(geo.pane.left + 1);
    expect(geo.content.right, "栏 3 右缘 ≤ 栏 4 左缘（并排，不重叠）").toBeLessThanOrEqual(geo.pane.left + 1);
    expect(geo.tabsBorderRight, "栏 2/3 之间是 1px 发丝线").toBeGreaterThanOrEqual(1);
    expect(Number.parseFloat(geo.contentLeftBorder), "栏 3/4 之间是 1px 发丝线").toBeGreaterThanOrEqual(1);
    // 四栏顶部对齐同一 y：栏 2/3/4 同处一行，没有把某一栏推下去的独立页头。
    expect(geo.tabs.top, "栏 2 与栏 3 顶部对齐").toBeCloseTo(geo.content.top, 0);
    expect(geo.content.top, "栏 3 与栏 4 顶部对齐").toBeCloseTo(geo.pane.top, 0);
    // 栏 2 顶部是「技能目录 + 计数」，下面是口径组 + 阶段组（+ 横向档的右缘渐隐）。
    expect(geo.titleInTabs, "「技能目录」必须住在栏 2 里").toBe(true);
    expect(geo.titleText).toBe("技能目录");
    expect(geo.titleSiblings[0], "栏 2 的第一个块是栏头").toContain("skill-catalog-title");
    expect(
      geo.titleSiblings.filter((c) => c.includes("skill-tabs-list")).length,
      "栏头下面才是口径组与阶段组",
    ).toBe(2);
    expect(geo.titleTop, "栏头在栏 2 顶部").toBeLessThan(geo.tabs.top + 48);
    // 栏头的词与口径组第一项的词左对齐（栏头不在控件组左边线上另起一列）。
    expect(geo.titleLeft, "栏头与控件组同一条左缘").toBeCloseTo(geo.tabsListLeft, 0);
    expect(geo.titleTextLeft, "「技能目录」与第一个 tab 的词左对齐").toBeCloseTo(geo.tabLabelLeft, 0);
    await context.close();
  });

  test("四栏各自独立滚动：滚栏 3 不动栏 4；栏 4 正文滚而头/底不动", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    await ready(page);
    // 选一项内容够长的技能（9 条使用步骤 + 执行边界 + 提示行），正文段才有东西可滚。
    await page.locator('.skill-row[data-skill-id="kol_analyze"] .skill-row-name').first().click();
    const snapshot = () => page.evaluate(() => {
      const el = (sel: string) => document.querySelector<HTMLElement>(sel)!;
      return {
        list: el(".skill-catalog-content").scrollTop,
        pane: el(".skill-detail-pane").scrollTop,
        body: el(".skill-detail-body").scrollTop,
        overflow: el(".skill-detail-body").scrollHeight - el(".skill-detail-body").clientHeight,
        headTop: el(".skill-detail-head").getBoundingClientRect().top,
        footBottom: el(".skill-detail-footer").getBoundingClientRect().bottom,
        bodyHeight: el(".skill-detail-body").getBoundingClientRect().height,
      };
    });
    const before = await snapshot();
    expect(before.overflow, "栏 4 的正文必须真的超出高度，这条断言才有意义").toBeGreaterThan(0);
    // 滚栏 3：只有列表动。
    await page.locator(".skill-catalog-content").evaluate((el) => { el.scrollTop = 600; });
    const afterList = await snapshot();
    expect(afterList.list, "栏 3 必须真的滚动了，这条断言才有意义").toBeGreaterThan(0);
    expect(afterList.body, "滚栏 3 不得带动栏 4 的正文").toBe(0);
    expect(afterList.pane, "栏 4 自身不是滚动容器（滚动只发生在正文段）").toBe(0);
    expect(afterList.headTop, "栏 4 的头部不随栏 3 滚动").toBeCloseTo(before.headTop, 0);
    expect(afterList.footBottom, "栏 4 的底部不随栏 3 滚动").toBeCloseTo(before.footBottom, 0);
    // 滚栏 4 的正文：正文自己滚，头与底原地不动。
    await page.locator(".skill-detail-body").evaluate((el) => { el.scrollTop = el.scrollHeight; });
    const afterBody = await snapshot();
    expect(afterBody.body, "栏 4 的正文必须能滚").toBeGreaterThan(0);
    expect(afterBody.list, "滚栏 4 不得带动栏 3 的列表").toBe(afterList.list);
    expect(afterBody.headTop, "正文滚动时头部位置不变").toBeCloseTo(before.headTop, 0);
    expect(afterBody.footBottom, "正文滚动时底部位置不变").toBeCloseTo(before.footBottom, 0);
    expect(afterBody.bodyHeight, "正文段高度不因滚动变化").toBeCloseTo(before.bodyHeight, 0);
    await context.close();
  });

  test("不再有独立页头行：「技能目录 + N 项」住在栏 2 里（1280×900）", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await ready(page);
    // 2026-09-23 结构改造：横跨 2/3/4 栏的页头行删除，标题与计数下沉成栏 2 的栏头。
    expect(await page.locator(".skill-catalog-header").count(), "独立页头行应当整条移除").toBe(0);
    const m = await page.evaluate(() => {
      const el = (sel: string) => document.querySelector<HTMLElement>(sel)!;
      const box = (sel: string) => el(sel).getBoundingClientRect();
      return {
        countText: (el(".skill-catalog-count").textContent || "").trim(),
        titleInTabs: Boolean(el(".skill-tabs .skill-catalog-title")),
        rowTop: box(".skill-row").top,
        pageTop: box("[data-skill-catalog]").top,
        searchTop: box(".skill-search-row").top,
        searchInContent: Boolean(el(".skill-catalog-content .skill-search-row")),
        searchPad: getComputedStyle(el(".skill-search-row")).paddingLeft,
        contentPad: getComputedStyle(el(".skill-catalog-content")).paddingLeft,
      };
    });
    expect(m.countText, "计数仍是栏头的一部分").toMatch(/^\d+ 项$/);
    expect(m.titleInTabs, "「技能目录 + 计数」必须住在栏 2 里").toBe(true);
    expect(m.searchInContent, "搜索框必须住在栏 3 顶部，而不是页头").toBe(true);
    // 搜索行铺满栏宽：它用负外边距抵消内容列的左右留白，所以底色与底缘线横贯整栏。
    expect(m.searchPad, "搜索行自带内容列的左右留白").toBe(m.contentPad);
    expect(m.searchTop, "搜索行仍钉在栏 3 顶部（sticky top: 0）").toBeLessThan(m.rowTop);
    // 顶部空间只剩栏头 + 搜索行 + 首组头：页顶到首行的距离必须压在 150px 内。
    expect(m.rowTop - m.pageTop, "不再有独立的页头行把首行推下去").toBeLessThanOrEqual(150);
    await context.close();
  });

  test("不重复、不露样板：没有「技能详情」头部，未登记产出的技能不渲染「产出」", async ({ page }) => {
    await ready(page);
    const catalog = page.locator("[data-skill-catalog]");
    // 详情列头部整条删除：「技能详情」是自明的容器名，摘要句与中栏选中行逐字重复。
    expect(await page.locator(".skill-detail-header").count(), "「技能详情」标题条应当整条移除").toBe(0);
    expect(await page.locator(".skill-detail-head p").count(), "头部不该再有摘要句").toBe(0);
    const text = await catalog.evaluate((el) => el.textContent || "");
    expect(text, "「技能详情」只该留在区域的 aria-label 里，不该是可见文字").not.toContain("技能详情");

    // 产出词表没登记的技能（后端给的是引擎兜底值 task_result）：整节不渲染，
    // 整页也不出现引擎产出词。
    await page.locator('.skill-row[data-skill-id="creator_library_query"] .skill-row-name').first().click();
    const detail = page.locator("[data-skill-detail]");
    await expect(detail).toBeVisible();
    await expect(detail.locator(".skill-detail-section h4", { hasText: "产出" })).toHaveCount(0);
    const all = await catalog.evaluate((el) => el.textContent || "");
    expect(all, "引擎产出词 task_result 不得出现在员工面上").not.toContain("task_result");
  });
});

test.describe("技能详情列（第四栏）", () => {
  test.beforeEach(async ({ page }) => {
    await ready(page);
  });

  test("按技能设计：每项技能都给出覆盖表口径，不用通用占位", async ({ page }) => {
    const ids = await page.locator(".skill-row").evaluateAll((els) =>
      [...new Set(els.map((el) => el.getAttribute("data-skill-id") || "").filter(Boolean))],
    );
    expect(ids.length, "至少要有若干技能才能验证").toBeGreaterThan(0);
    for (const id of ids.slice(0, 6)) {
      // 同一技能可能同时出现在「常用技能」与所属分组，取第一行。
      await page.locator(`.skill-row[data-skill-id="${id}"] .skill-row-name`).first().click();
      const detail = page.locator("[data-skill-detail]");
      await expect(detail, `${id} 的详情未展开`).toBeVisible();
      // 口径来源：SKILL.md 自己的 `employee_quick` / `employee_agent`（登记在 docs/BUSINESS.md
      // 的「快捷查询与思考覆盖表」）。没登记的技能必须走「待补齐」分支——不得编造口径（CONST-10）。
      const covered = await detail.getByText("可以直接查到").count();
      if (covered > 0) {
        await expect(detail.getByText("需要走确认或 AI 助理")).toBeVisible();
      } else {
        await expect(detail.getByText("待业务专家补齐")).toBeVisible();
      }
      await expect(detail.getByText("相关参数")).toHaveCount(0);
      await expect(detail.getByText("分析结果")).toHaveCount(0);
    }
  });

  test("数据来源：栏 4 的两段口径逐字等于 /api/skills 里对应的字段值", async ({ page }) => {
    // 页面里不再有手抄的入口口径表：两段文字必须**逐字**来自技能文件（经接口带出）。
    type SkillJson = { id: string; employee_quick?: string | null; employee_agent?: string | null };
    const rows = (await (await page.request.get("/api/skills")).json()) as SkillJson[];
    const probes = ["creator_library_all", "creator_outreach", "sop_settling"];
    const sectionValue = (label: string) =>
      page.locator("[data-skill-detail]")
        .locator(".skill-detail-section", { hasText: label })
        .locator(".skill-detail-value")
        .first();
    for (const id of probes) {
      const row = rows.find((r) => r.id === id);
      expect(row, `${id} 应当出现在 /api/skills 里`).toBeTruthy();
      expect(row!.employee_quick, `${id} 在接口里应当有 employee_quick`).toBeTruthy();
      await page.locator(`.skill-row[data-skill-id="${id}"] .skill-row-name`).first().click();
      const detail = page.locator("[data-skill-detail]");
      await expect(detail.locator("h4", { hasText: "可以直接查到" }), `${id} 的「可以直接查到」未渲染`).toBeVisible();
      expect((await sectionValue("可以直接查到").textContent())?.trim(), `${id} 的「可以直接查到」与接口不一致`).toBe(row!.employee_quick);
      expect((await sectionValue("需要走确认或 AI 助理").textContent())?.trim(), `${id} 的「需要走确认或 AI 助理」与接口不一致`).toBe(row!.employee_agent);
    }
  });

  test("未登记入口口径的 6 个技能：照实说明待专家补齐，不给推测口径", async ({ page }) => {
    // 名单照 docs/BUSINESS.md「快捷查询与思考覆盖表」的登记原文。
    const unregistered = ["discovery_plan", "discovery_brief", "kol_analyze", "today_plan", "today_analyze", "todo_plan"];
    for (const id of unregistered) {
      const row = page.locator(`.skill-row[data-skill-id="${id}"]`);
      await expect(row.first(), `${id} 应当还在技能目录里`).toBeVisible();
      await row.first().locator(".skill-row-name").click();
      const detail = page.locator("[data-skill-detail]");
      await expect(detail.locator("h4", { hasText: "可以直接查到" }), `${id} 不该有推测口径`).toHaveCount(0);
      await expect(detail.getByText("待业务专家补齐"), `${id} 必须照实说明待补齐`).toBeVisible();
    }
  });

  test("说明书：接口给了正文才渲染，为空则整节隐藏（不做 loading 假动作）", async ({ page }) => {
    // 当前仓库的技能文件都还没写 `## 员工口径` 这一节，接口返回空串 → 该节整节不渲染。
    await expect(
      page.locator("[data-skill-detail] h4", { hasText: "说明书" }),
      "没有正文就不该有「说明书」小节（空壳不算说明书）",
    ).toHaveCount(0);

    // 接口真给了正文时：Markdown 子集（段落 / `-` 列表 / `###` 小标题）按三种块渲染。
    const doc = "说明正文一段。\n\n- 第一条\n- 第二条\n\n### 范围\n\n只看你被授权的范围。";
    await page.route("**/api/skills/creator_outreach", (route) =>
      route.fulfill({
        json: { id: "creator_outreach", employee_quick: "口径", employee_agent: "边界", employee_doc: doc },
      }),
    );
    // 先切到别的技能再切回来：说明书是按选中技能拉的，同一次选中不会重复拉。
    await page.locator('.skill-row[data-skill-id="creator_discovery"] .skill-row-name').first().click();
    await page.locator('.skill-row[data-skill-id="creator_outreach"] .skill-row-name').first().click();
    const section = page.locator("[data-skill-detail] .skill-detail-section", { hasText: "说明书" });
    await expect(section.getByText("说明正文一段。")).toBeVisible();
    await expect(section.locator(".skill-doc-list li")).toHaveCount(2);
    await expect(section.locator(".skill-doc-heading")).toHaveText("范围");
    await expect(section.getByText("只看你被授权的范围。")).toBeVisible();
  });

  test("风险档与异步契约进入详情", async ({ page }) => {
    await page.locator('.skill-row[data-skill-id="creator_discovery"] .skill-row-name').first().click();
    const detail = page.locator("[data-skill-detail]");
    await expect(detail.locator(".skill-mark.is-async")).toBeVisible();
    await expect(detail.getByText("异步作业", { exact: false })).toBeVisible();
    await expect(detail.locator(".skill-mark.is-read")).toBeVisible();
  });

  test("展开 / 收窄切换宽度档并暴露 aria-expanded", async ({ page }) => {
    const pane = page.locator(".skill-detail-pane");
    const toggle = page.locator(".skill-detail-toggle");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    const before = (await pane.boundingBox())!.width;
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect.poll(async () => (await pane.boundingBox())!.width).toBeGreaterThan(before);
  });

  test("§不变量 1：详情列内最多 1 个实底主 CTA", async ({ page }) => {
    const primary = await pageVar(page, "--primary");
    const filled = await page.evaluate((rgb) => {
      const all = [...document.querySelectorAll<HTMLElement>("[data-skill-detail] *")];
      return all.filter((el) => getComputedStyle(el).backgroundColor === rgb).length;
    }, primary);
    expect(filled).toBeLessThanOrEqual(1);
  });

  test("「展开」是图标按钮且带 aria-label", async ({ page }) => {
    const t = page.locator(".skill-detail-toggle");
    await expect(t).toHaveAttribute("aria-label", /展开|收窄/);
    expect(await t.evaluate((el) => !!el.querySelector("svg")), "必须是 SVG 图标").toBe(true);
    expect(await t.evaluate((el) => (el.textContent || "").trim()), "不应再有文字").toBe("");
  });
});

test("§三轴适配 · 宽度轴 <900：详情列改为覆盖层，可关闭，不把交互内容藏掉", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 800, height: 900 } });
  const page = await context.newPage();
  await ready(page);
  const pane = page.locator(".skill-detail-pane");
  await expect(pane).toBeHidden();
  await page.locator(".skill-row").first().locator(".skill-row-name").click();
  await expect(pane).toBeVisible();
  await page.locator(".skill-detail-close").click();
  await expect(pane).toBeHidden();
  await context.close();
});

test("§三轴适配 · 宽度轴 <900：覆盖态下「展开」也必须有效", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 860, height: 900 } });
  const page = await context.newPage();
  await ready(page);
  await page.locator(".skill-row .skill-row-name").first().click();
  const pane = page.locator(".skill-detail-pane");
  await expect(pane).toBeVisible();
  const before = (await pane.boundingBox())!.width;
  await page.locator(".skill-detail-toggle").click();
  await expect(page.locator(".skill-detail-toggle")).toHaveAttribute("aria-expanded", "true");
  await expect.poll(async () => (await pane.boundingBox())!.width).toBeGreaterThan(before);
  await context.close();
});

test("§验收矩阵：矮视口下至少一条完整列表行可见", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 700 } });
  const page = await context.newPage();
  await ready(page);
  const complete = await page.evaluate(() => {
    const content = document.querySelector<HTMLElement>(".skill-catalog-content")!;
    const box = content.getBoundingClientRect();
    return [...document.querySelectorAll<HTMLElement>(".skill-row")].some((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= box.top - 1 && r.bottom <= box.bottom + 1;
    });
  });
  expect(complete, "1280×700 下必须至少有一条完整可见的列表行").toBe(true);
  await context.close();
});

test("§验收矩阵：1024×630 下列表不被并排的详情列挤到横向裁切", async ({ browser }) => {
  // §不变量 5：绝不允许溢出被 overflow 静默裁切。
  // 详情列与列表并排，列表列在这个宽度只剩约 400px；列宽必须按列表列的实际宽度收敛。
  // 行内动作已删除，所以这里不再盯「动作是否被挤出」，改成按内容盒断言：
  // 列表列自己没有横向滚动，且每条行自己也没有溢出。
  const context = await browser.newContext({ viewport: { width: 1024, height: 630 } });
  const page = await context.newPage();
  await ready(page);
  const r = await page.evaluate(() => {
    const content = document.querySelector<HTMLElement>(".skill-catalog-content")!;
    const box = content.getBoundingClientRect();
    const pane = document.querySelector<HTMLElement>(".skill-detail-pane")!;
    const rows = [...document.querySelectorAll<HTMLElement>(".skill-row")]
      .filter((el) => el.scrollWidth - el.clientWidth > 1)
      .map((el) => el.getAttribute("data-skill-id") || "");
    return {
      overflow: content.scrollWidth - content.clientWidth,
      rows,
      // 详情列必须与列表并排（不是被折到下面），否则「并排挤压」这条前提就不成立。
      paneLeft: pane.getBoundingClientRect().left,
      contentRight: box.right,
    };
  });
  expect(r.overflow, "列表内容不得出现横向滚动").toBeLessThanOrEqual(1);
  expect(r.rows, `行自身溢出：${JSON.stringify(r.rows)}`).toEqual([]);
  expect(r.paneLeft, "详情列应当与列表并排在同一行").toBeGreaterThanOrEqual(r.contentRight - 1);
  await context.close();
});

test.describe("第二轮 UX 改进（常用/推荐口径 · 键盘路径 · 清除 · 段落次序 · 压缩档信号）", () => {
  test("新员工看到的是「推荐技能」，且不谎称「常用」、不逐行打星", async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.clear(); } catch { /* ignore */ } });
    await ready(page);
    const frequent = page.locator(".skill-group-frequent");
    await expect(frequent.locator("h2")).toHaveText("推荐技能");
    await expect(frequent.locator(".skill-group-hint")).toContainText("按你所在阶段挑的几项");
    expect(await frequent.locator(".skill-row-star").count(), "没有使用记录时不该逐行打★").toBe(0);
    // 深链也要跟着走：没有记录时「查看全部」应落到「推荐」，而不是空的「常用」。
    expect(await frequent.locator(".skill-group-more").getAttribute("href")).toBe("/skills?tab=recommend");
  });

  test("有使用记录时才叫「常用技能」", async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.setItem("skill:usage", JSON.stringify({ creator_outreach: 2 })); } catch { /* ignore */ }
    });
    await ready(page);
    const frequent = page.locator(".skill-group-frequent");
    await expect(frequent.locator("h2")).toHaveText("常用技能");
    await expect(frequent.locator(".skill-group-hint")).toContainText("你经常使用的技能");
    expect(await frequent.locator(".skill-group-more").getAttribute("href")).toBe("/skills?tab=frequent");
  });

  test("键盘路径：Tab 从行名直接到下一行行名（序列里没有行内动作），右栏 CTA 仍在 Tab 顺序内", async ({ page }) => {
    await ready(page);
    let seen = "";
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      seen = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.className || "");
      if (seen.includes("skill-row-name")) break;
    }
    expect(seen, "Tab 必须能到达列表行的选择入口").toContain("skill-row-name");
    const firstId = await page.evaluate(() =>
      (document.activeElement as HTMLElement | null)?.closest(".skill-row")?.getAttribute("data-skill-id") || "");
    // 行里没有第二个焦点：下一个 Tab 直接落到**下一行**的行名（行内已无任何动作）。
    await page.keyboard.press("Tab");
    const next = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.className || "");
    expect(next, `下一个焦点应是下一行的行名，实测 ${next}`).toContain("skill-row-name");
    const nextId = await page.evaluate(() =>
      (document.activeElement as HTMLElement | null)?.closest(".skill-row")?.getAttribute("data-skill-id") || "");
    expect(nextId, "下一个焦点必须换了一行").not.toBe(firstId);
    // 右栏主 CTA 也在焦点序列里：从最后一行继续 Tab（数量有限，不是 51 个行内动作那么远）。
    await page.locator(".skill-row").last().locator(".skill-row-name").focus();
    let reached = false;
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      const cls = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.className || "");
      if (cls.includes("skill-btn-primary")) { reached = true; break; }
    }
    expect(reached, "右栏详情列的实底主 CTA 必须能在焦点序列里到达").toBe(true);
  });

  test("搜索框有清除入口：点一下清空并把焦点还给输入框", async ({ page }) => {
    await ready(page);
    const input = page.getByRole("textbox", { name: "搜索技能 / SOP / 场景" });
    await input.fill("达人");
    const clear = page.getByRole("button", { name: "清除搜索" });
    await expect(clear).toBeVisible();
    await clear.click();
    await expect(input).toHaveValue("");
    await expect(input).toBeFocused();
    await expect(clear).toHaveCount(0);
  });

  test("详情列小节按新顺序排：入口口径 → 需要你提供 → 产出 → 使用步骤 → 执行边界 → 说明书 → 示例", async ({ page }) => {
    await ready(page);
    // confirm_stage 是四个小节都齐的一项（口径两段 / 产出 / 使用步骤 / 执行边界），
    // 用它把顺序钉死；只取正文段的**直接**子节 ——「查看调用关系与安全边界」折叠里的
    // 执行细项固定排在正文末尾、主 CTA 之前，不属于这一序列（docs/DESIGN.md §不变量 1）。
    await page.locator('.skill-row[data-skill-id="confirm_stage"] .skill-row-name').first().click();
    const headings = await page.locator("[data-skill-detail] .skill-detail-body > .skill-detail-section h4").evaluateAll(
      (els) => els.map((e) => e.textContent?.trim() || ""),
    );
    // 有则渲染、无则隐藏：实测必须是登记顺序的子序列，且不出现未登记的小节。
    const ORDER = [
      "可以直接查到",
      "需要走确认或 AI 助理",
      "需要你提供",
      "产出",
      "使用步骤",
      "执行边界",
      "说明书",
      "示例",
    ];
    expect(headings.length, "详情列应当有若干小节").toBeGreaterThan(3);
    expect(headings.filter((h) => !ORDER.includes(h)), `出现未登记的小节：${headings.join(" / ")}`).toEqual([]);
    expect(headings, `小节顺序不得漂移：${headings.join(" / ")}`).toEqual(ORDER.filter((h) => headings.includes(h)));
    expect(headings).toEqual(["可以直接查到", "需要走确认或 AI 助理", "产出", "使用步骤", "执行边界"]);
  });

  test("栏 4 排版：类型只留四档，且全页不出现 600 档字重", async ({ page }) => {
    await ready(page);
    const read = (sel: string) => page.locator(sel).first().evaluate((el) => {
      const s = getComputedStyle(el);
      return { size: s.fontSize, weight: s.fontWeight };
    });
    expect(await read(".skill-detail-head h2"), "对象名 15px / 500").toMatchObject({ size: "15px", weight: "500" });
    expect(await read(".skill-detail-body .skill-detail-section h4"), "小节标题 12px / 500").toMatchObject({ size: "12px", weight: "500" });
    expect(await read(".skill-detail-body .skill-detail-value"), "正文 13px / 400").toMatchObject({ size: "13px", weight: "400" });
    expect(await read(".skill-detail-marks .skill-detail-chip"), "chips 12px / 400").toMatchObject({ size: "12px", weight: "400" });
    // 本页除标题外没有加粗档：层级由间距 / 墨色 / 图标承担，不靠字重堆。
    const heavy = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>("[data-skill-catalog] *")) {
        const s = getComputedStyle(el);
        if (s.display === "none" || el.getBoundingClientRect().width === 0) continue;
        if (Number(s.fontWeight) >= 600) out.push(`${el.className || el.tagName} ${s.fontWeight}`);
      }
      return [...new Set(out)];
    });
    expect(heavy, `本页不该出现 600 档字重：${heavy.join(" / ")}`).toEqual([]);
  });

  test("栏 4 排版：长说明是一行 muted 提示（带小图标），不再是大块浅底 callout", async ({ page }) => {
    await ready(page);
    const hint = page.locator("[data-skill-detail] .skill-detail-hint").first();
    await expect(hint, "「示例 / 说明书未补录」这类长说明必须还在，只是收成一行").toBeVisible();
    const s = await hint.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        color: cs.color,
        size: cs.fontSize,
        bg: cs.backgroundColor,
        border: Number.parseFloat(cs.borderLeftWidth),
        icon: Boolean(el.querySelector("svg")),
        height: el.getBoundingClientRect().height,
      };
    });
    expect(s.color, "提示走 muted").toBe(await pageVar(page, "--text-muted"));
    expect(s.size).toBe("12px");
    expect(s.bg, "不再铺浅底").toBe("rgba(0, 0, 0, 0)");
    expect(s.border, "不再有左侧强调条").toBe(0);
    expect(s.icon, "前缀一个小图标").toBe(true);
    expect(s.height, `一行提示不该占两行以上（实测 ${s.height}px）`).toBeLessThanOrEqual(36);
  });

  test("筛选条有右缘渐隐提示（窄屏横向滚动时）", async ({ page }) => {
    await ready(page);
    await expect(page.locator(".skill-tabs-fade")).toHaveCount(1);
  });

  test("§不变量 2 的压缩档兜底：列表列 <460px 收起文字标记后 L3 仍有形状信号（异步虚线为全宽信号）", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1024, height: 630 } });
    const page = await context.newPage();
    await ready(page);
    const r = await page.evaluate(() => {
      const tile = (sel: string) => {
        const el = document.querySelector<HTMLElement>(sel);
        if (!el) return null;
        const cs = getComputedStyle(el);
        return { w: Number.parseFloat(cs.borderTopWidth), style: cs.borderTopStyle };
      };
      const marksVisible = [...document.querySelectorAll(".skill-row .skill-mark")]
        .some((e) => e.getBoundingClientRect().height > 0);
      return { write: tile(".skill-row.is-write .skill-row-icon"), async: tile(".skill-row.is-async .skill-row-icon"), marksVisible };
    });
    expect(r.marksVisible, "该宽度下文字标记（L3「需确认」）应当已收起，这条测试才有意义").toBe(false);
    expect(r.write, "受控（L3）技能必须有图标砖边框信号").not.toBeNull();
    expect(r.write!.w, "L3 边框应为实线").toBeGreaterThanOrEqual(1);
    expect(r.write!.style).toBe("solid");
    expect(r.async, "异步作业必须有虚线边框信号").not.toBeNull();
    expect(r.async!.style, "异步用虚线，与 L3 的实线区分（形状信号）").toBe("dashed");
    await context.close();
  });
});

test.describe("「填入输入框」把技能填进输入框（右栏唯一入口）", () => {
  test("填入的是技能正文（起始行 + 待补参数），不是只挂一个技能名", async ({ page }) => {
    await ready(page);

    // 行内动作已删除：先点中栏那一行（行名＝行的选择入口），再点右栏详情列的实底主 CTA。
    const row = page.locator('.skill-row[data-skill-id="creator_outreach"]').first();
    await expect(row).toBeVisible();
    await row.locator(".skill-row-name").click();
    await page.locator(".skill-detail-footer .skill-btn-primary").click();

    // 落到「新工作任务」：输入框里是技能起始行 + 这项技能自己的说明（技能详情），
    // 芯片同时保留技能名。
    await expect(page).toHaveURL(/\/(?:\?|$)/);
    await expect(page.locator("[data-home] [data-composer-input]"))
      .toHaveValue(/^达人建联话术 \[[^\]]+\]\n基于达人数据生成私信和加微信话术$/);
    await expect(page.locator('[data-skill-chip="creator_outreach"]')).toBeVisible();
  });

  test("填技能不会启动今日或待办任务计划", async ({ page }) => {
    const planPosts: string[] = [];
    page.on("request", (request) => {
      if (request.method() !== "POST") return;
      const path = new URL(request.url()).pathname;
      if (path.endsWith("/today-brief/plan") || path.endsWith("/todo-brief/plan")) planPosts.push(path);
    });

    await ready(page);
    await page.locator('.skill-row[data-skill-id="creator_outreach"] .skill-row-name').first().click();
    await page.locator(".skill-detail-footer .skill-btn-primary").click();
    await expect(page.locator("[data-home] [data-composer-input]")).toHaveValue(/\S/);

    // 落回 Home 的提问框仍在用户手里：技能只填进输入框，不产生任何规划 POST。
    // （启动键的 data-home-entry 取值由 Home 自己维护，本页不绑定它的具体文案。）
    await expect(page.locator("[data-home] [data-home-entry]").first()).toBeVisible();
    await page.waitForTimeout(3000);
    expect(planPosts).toEqual([]);
  });
});

/**
 * 反漂移门禁（工程约束，不是法条）：页面渲染色值必须能指回本页消费的 token。
 * 它挡住的是「顺手写一个新的 hex / 灰」这类漂移，也让 docs/DESIGN.md §控件尺寸
 * 「尺寸与数值只走命名 token」在实现层可验证。
 */
async function assertPaletteFromTokens(page: Page) {
  // 默认选中态的底色有 140ms 过渡；过渡中 getComputedStyle 会给出插值色（oklab(...)），
  // 那是中间态而不是页面配方，先等它落定再采样。
  await page.waitForTimeout(500);
  const tokens = [
    "--bg",
    "--ds-surface",
    "--surface-hover",
    "--ds-selected-bg",
    "--text",
    "--text-muted",
    "--border",
    "--control-border",
    "--primary",
    "--primary-fg",
    "--primary-hover",
    "--primary-text",
    "--accent",
    "--accent-hover",
    "--accent-text",
    "--warning",
    "--danger",
    "--success",
    "--cat-library",
    "--cat-library-text",
    "--cat-library-tile",
    "--cat-library-line",
    "--cat-assistant",
    "--cat-assistant-text",
    "--cat-assistant-tile",
    "--cat-assistant-line",
    "--cat-crawl",
    "--cat-crawl-text",
    "--cat-crawl-tile",
    "--cat-crawl-line",
    "--cat-builtin",
    "--cat-builtin-text",
    "--cat-builtin-tile",
    "--cat-builtin-line",
  ];
  const allowed = new Set<string>(["rgb(255, 255, 255)", "rgba(0, 0, 0, 0)", "transparent"]);
  for (const t of tokens) allowed.add(await pageVar(page, t));
  // 页面里由 token 混出来的颜色（浅底、暖墨、冷墨）：按浏览器实际算出的值入白名单
  // —— 仍然不手写 hex，只允许"从 token 派生"这一条路径。
  const mixed = await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>(".skill-catalog-page") ?? document.body;
    const expr = [
      "color-mix(in srgb, var(--warning) 10%, var(--bg))",
      "color-mix(in srgb, var(--warning) 72%, var(--text))",
      // 辅助色（蓝）在本页的用法：无 data-tone 时的图标砖回落配方 + 行标题冷墨。
      // 类别色不在此列 —— 它们走 --cat-* 命名 token，砖底/描边/字形都由 token 直接给出。
      "color-mix(in srgb, var(--accent) 8%, var(--bg))",
      "color-mix(in srgb, var(--accent) 18%, var(--border))",
      "color-mix(in srgb, var(--text) 82%, var(--accent))",
    ];
    const out: string[] = [];
    for (const e of expr) {
      for (const prop of ["background", "color", "border-color"] as const) {
        const p = document.createElement("div");
        p.style.setProperty(prop, e);
        host.appendChild(p);
        const cs = getComputedStyle(p);
        out.push(
          prop === "background" ? cs.backgroundColor : prop === "color" ? cs.color : cs.borderTopColor,
        );
        p.remove();
      }
    }
    return out;
  });
  mixed.forEach((c) => allowed.add(c));

  const stray = await page.evaluate(
    ([list, props]) => {
      const allow = new Set(list as string[]);
      const out = new Set<string>();
      for (const el of document.querySelectorAll<HTMLElement>("[data-skill-catalog] *")) {
        const cs = getComputedStyle(el);
        if (cs.display === "none" || el.getBoundingClientRect().width === 0) continue;
        for (const p of props as string[]) {
          // 注意：getPropertyValue 只认 kebab-case；这里按 camelCase 取，必须用下标访问。
          const v = (cs as unknown as Record<string, string>)[p];
          if (!allow.has(v)) out.add(`${(el.className || el.tagName).toString().slice(0, 34)} ${p}=${v}`);
        }
      }
      return [...out];
    },
    [[...allowed], [...VISIBLE_PROPS]],
  );
  expect(stray, `这些色值无法指回本页消费的 token：\n${stray.join("\n")}`).toEqual([]);
}
