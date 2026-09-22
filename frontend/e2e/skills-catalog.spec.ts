import { devices, expect, test, type Page } from "@playwright/test";

/**
 * 技能目录页（/skills）对 docs/DESIGN.md 的验收。
 *
 * 依据是该文件的「员工端实施细则」（实施细则，非基本法）：
 *   密度档 data-dense-dashboard（列表行本身就是内容，不做卡片墙）
 *   §控件尺寸（命名 token / 命中区 / 焦点态）
 *   §三轴适配（宽度 / 高度 / 输入模态分别处理）
 *   §不变量 1（同一视口 0–1 个实底主 CTA）、3（等待有恢复入口）、4（状态不靠颜色单独表达）
 *   §验收矩阵
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
      const lum = (c: string) => {
        const m = c.match(/[\d.]+/g);
        if (!m) return null as number | null;
        const [r, g, b] = m.slice(0, 3).map(Number);
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
    expect(await h(".skill-tab"), "筛选段高度取 --chip-h").toBeCloseTo(chip, 0);
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

  test("§三轴适配 · 宽度轴：内容列不超过 --content-max", async ({ page }) => {
    const max = await page.evaluate(() =>
      Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--content-max")),
    );
    const widths = await page.locator(".skill-catalog-content > *").evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect().width),
    );
    expect(widths.length, "内容列里应当有分组").toBeGreaterThan(0);
    for (const w of widths) {
      expect(w, `内容列 ${Math.round(w)}px 超过 --content-max(${max}px)`).toBeLessThanOrEqual(max + 1);
    }
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
    for (const sel of [".skill-tab", ".skill-row-name", ".skill-link"]) {
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

  test("工具风险档与异步契约在列表上可见", async ({ page }) => {
    expect(await page.locator(".skill-row .skill-mark").count()).toBeGreaterThan(0);
  });

  test("只标例外：列表行上不出现「只读」标记", async ({ page }) => {
    // 注意：描述文案里本来就可能含「只读」二字，这里断言的是标记元素本身。
    expect(await page.locator(".skill-row .skill-mark.is-read").count()).toBe(0);
  });

  test("每行只有一个动作，且为链接式（无框 + 常驻下划线 + 语义图标）", async ({ page }) => {
    const acts = page.locator(".skill-row-actions");
    await expect(acts.first()).toBeVisible();
    const counts = await acts.evaluateAll((els) => els.map((e) => e.children.length));
    expect(counts.every((c) => c === 1), `每行只允许 1 个动作，实测：${JSON.stringify(counts)}`).toBe(true);
    const cs = await page.locator(".skill-row-actions .skill-link").first().evaluate((el) => {
      const s = getComputedStyle(el);
      return { border: s.borderTopWidth, deco: s.textDecorationLine, hasIcon: !!el.querySelector("svg") };
    });
    expect(Number.parseFloat(cs.border), "链接式动作应当无框").toBe(0);
    expect(cs.deco, "下划线必须常驻，不只在 hover").toContain("underline");
    expect(cs.hasIcon, "链接式动作必须带语义图标").toBe(true);
  });

  test("本页不再出现「新建会话」（需先补参数，直接开会话是错误承诺）", async ({ page }) => {
    await expect(page.locator(".skill-row-actions").filter({ hasText: "新建会话" })).toHaveCount(0);
    await expect(page.locator(".skill-detail-footer").filter({ hasText: "新建会话" })).toHaveCount(0);
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

    // 本页自己渲染的这几个小节（使用步骤 / 执行边界 / 调用工具 / 所需权限）由页面做词表翻译：
    // 它们**一个字英文都不该有**——有就说明引擎 id 又漏出来了。
    const latin = await page.evaluate(() => {
      const wanted = new Set(["使用步骤", "执行边界", "调用工具", "所需权限"]);
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

test.describe("技能详情列（第三栏）", () => {
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
      // 口径来源：docs/BUSINESS.md「快捷查询与思考覆盖表」。
      // 未登记的技能必须走「待补齐」分支——不得编造口径（CONST-10）。
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
  // 详情列与列表并排，列表列在这个宽度只剩约 400px；列宽必须按列表列的实际宽度收敛，
  // 否则行内动作会被挤出可视区（只有横向滚动才能看到）。
  const context = await browser.newContext({ viewport: { width: 1024, height: 630 } });
  const page = await context.newPage();
  await ready(page);
  const r = await page.evaluate(() => {
    const content = document.querySelector<HTMLElement>(".skill-catalog-content")!;
    const box = content.getBoundingClientRect();
    const cut = [...document.querySelectorAll<HTMLElement>(".skill-row-actions .skill-link")].filter((el) => {
      const b = el.getBoundingClientRect();
      return b.width === 0 || b.right > box.right + 1 || b.left < box.left - 1;
    }).length;
    return { cut, overflow: content.scrollWidth - content.clientWidth };
  });
  expect(r.overflow, "列表内容不得出现横向滚动").toBeLessThanOrEqual(1);
  expect(r.cut, "行内动作被挤出可视区").toBe(0);
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

  test("行内动作不在 Tab 顺序里，键盘路径是行名 → 详情列 CTA", async ({ page }) => {
    await ready(page);
    await expect(page.locator(".skill-row-actions .skill-link").first()).toHaveAttribute("tabindex", "-1");
    let seen = "";
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      seen = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.className || "");
      if (seen.includes("skill-row-name")) break;
    }
    expect(seen, "Tab 必须能到达列表行的选择入口").toContain("skill-row-name");
    // 行内动作不再吃掉焦点：下一个 Tab 直接跳到下一行的行名，而不是行内「填入输入框」链接。
    await page.keyboard.press("Tab");
    const next = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.className || "");
    expect(next, `行内动作不该进入 Tab 顺序（下一个焦点是 ${next}）`).not.toContain("skill-link");
    expect(next, `下一个焦点应是下一行的行名，实测 ${next}`).toContain("skill-row-name");
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

  test("详情列按员工决策顺序排：先场景 / 要你提供什么 / 产出，再能力边界", async ({ page }) => {
    await ready(page);
    const headings = await page.locator(".skill-detail-body .skill-detail-section h4").evaluateAll((els) =>
      els.map((e) => e.textContent?.trim() || ""),
    );
    expect(headings.length, "详情列应当有若干小节").toBeGreaterThan(3);
    const idx = (label: string) => headings.indexOf(label);
    expect(idx("适用场景"), `首节应是「适用场景」，实测顺序 ${headings.join(" / ")}`).toBe(0);
    expect(idx("需要你提供"), "「需要你提供」要排在能力边界之前").toBeLessThan(idx("可以直接查到"));
    expect(idx("产出"), "「产出」要排在能力边界之前").toBeLessThan(idx("可以直接查到"));
  });

  test("筛选条有右缘渐隐提示（窄屏横向滚动时）", async ({ page }) => {
    await ready(page);
    await expect(page.locator(".skill-tabs-fade")).toHaveCount(1);
  });

  test("§不变量 2 的压缩档兜底：列表列 <460px 时 L3 / 异步仍有形状信号", async ({ browser }) => {
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
    expect(r.marksVisible, "该宽度下文字标记应当已收起，这条测试才有意义").toBe(false);
    expect(r.write, "受控（L3）技能必须有图标砖边框信号").not.toBeNull();
    expect(r.write!.w, "L3 边框应为实线").toBeGreaterThanOrEqual(1);
    expect(r.write!.style).toBe("solid");
    expect(r.async, "异步作业必须有虚线边框信号").not.toBeNull();
    expect(r.async!.style, "异步用虚线，与 L3 的实线区分（形状信号）").toBe("dashed");
    await context.close();
  });
});

test.describe("「填入输入框」把技能填进输入框", () => {
  test("填入的是技能正文（起始行 + 待补参数），不是只挂一个技能名", async ({ page }) => {
    await ready(page);

    const row = page.locator('.skill-row[data-skill-id="creator_outreach"]').first();
    await expect(row).toBeVisible();
    await row.locator(".skill-link").click();

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
    await page.locator('.skill-row[data-skill-id="creator_outreach"]').first()
      .locator(".skill-link").click();
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
    "--warning",
    "--danger",
    "--success",
  ];
  const allowed = new Set<string>(["rgb(255, 255, 255)", "rgba(0, 0, 0, 0)", "transparent"]);
  for (const t of tokens) allowed.add(await pageVar(page, t));
  // 语义色的浅底是 color-mix 的结果：按浏览器实际算出的值入白名单（不手写 hex）。
  const mixed = await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>(".skill-catalog-page") ?? document.body;
    const expr = [
      "color-mix(in srgb, var(--warning) 10%, var(--bg))",
    ];
    return expr.map((e) => {
      const p = document.createElement("div");
      p.style.background = e;
      host.appendChild(p);
      const v = getComputedStyle(p).backgroundColor;
      p.remove();
      return v;
    });
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
