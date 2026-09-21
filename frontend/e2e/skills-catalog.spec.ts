import { devices, expect, test, type Page } from "@playwright/test";

/**
 * 技能目录页对 `docs/DESIGN.md` 的验收（设计数值来源；CONST-09 层级下为实施细则）。
 * 覆盖该文档的 colors / typography / rounded / elevation / components / responsive 各节，
 * 以及无障碍覆盖项（文档自身不达 AA 的三处，见 styles.css 本页段落顶部注释）。
 */

/** 把 CSS 变量的计算值解析成 rgb()，避免在断言里写死 hex。 */
async function resolveToken(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement("div");
    probe.style.color = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    document.body.appendChild(probe);
    const rgb = getComputedStyle(probe).color;
    probe.remove();
    return rgb;
  }, token);
}

/**
 * 解析**本页作用域内**的 token 值。
 * 必须用它而不是 resolveToken：本页按 DESIGN.md 覆盖了 --primary / --bg / --text 等，
 * 从 :root 取到的会是壳层的值（例如壳层主色），断言就会变成空转。
 */
async function resolvePageToken(page: Page, token: string): Promise<string> {
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

async function ready(page: Page) {
  await page.goto("/skills");
  await page.locator("[data-skill-catalog]").waitFor();
  await page.locator(".skill-card").first().waitFor();
}

/** DESIGN.md 深色主题未定义，但本页必须仍可用；下面的 helper 用于切到深色。 */
async function toDark(page: Page) {
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.waitForTimeout(250);
}

test.describe("技能目录页（/skills）", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/skills");
    await page.locator("[data-skill-catalog]").waitFor();
    await page.locator(".skill-card").first().waitFor();
  });

  test("DESIGN.md components.button-primary：实底 CTA 用 primary-active、白字达 4.5:1，且同屏 ≤1 个", async ({ page }) => {
    const primary = await resolvePageToken(page, "--primary");
    const filled = await page.evaluate((rgb) => {
      const all = [...document.querySelectorAll<HTMLElement>("[data-skill-catalog] *")];
      return all.filter((el) => {
        const cs = getComputedStyle(el);
        return cs.backgroundColor === rgb && cs.visibility !== "hidden" && el.getBoundingClientRect().width > 0;
      }).length;
    }, primary);
    expect(filled, `实底 CTA 应为 0–1 个，实测 ${filled} 个`).toBeLessThanOrEqual(1);

    // 文档的 colors.primary(#f54e00) 压白字只有 3.52:1；本页按无障碍改用 primary-active(#d04200)。
    const cta = page.locator(".skill-btn-primary").first();
    const [fg, bg] = await cta.evaluate((el) => {
      const s = getComputedStyle(el);
      return [s.color, s.backgroundColor];
    });
    const cr = await contrastOf(page, fg, bg);
    expect(cr, `实底 CTA 白字对比度 ${cr}:1，需要 ≥4.5（文档原色只有 3.52）`).toBeGreaterThanOrEqual(4.5);
  });

  test("§5 规则 2：主色浅底不得作为静止背景", async ({ page }) => {
    const tints = [
      await resolveToken(page, "--color-pink-tint"),
      await resolveToken(page, "--color-pink-tint-soft"),
    ];
    const hits = await page.evaluate((colors) => {
      const all = [...document.querySelectorAll<HTMLElement>("[data-skill-catalog] *")];
      return all.filter((el) => colors.includes(getComputedStyle(el).backgroundColor)).length;
    }, tints);
    expect(hits, "浅主色底只允许用于选中 / 悬停，不得当静止面").toBe(0);
  });

  test("§5 规则 3：主色不得当文字 / 图标色（预览栏、图标砖）", async ({ page }) => {
    const primary = await resolvePageToken(page, "--primary");
    const hits = await page.evaluate((rgb) => {
      const targets = [...document.querySelectorAll<HTMLElement>(
        ".skill-catalog-preview :is(h2, h3, h4, p, span), .skill-card-icon",
      )];
      return targets.filter((el) => getComputedStyle(el).color === rgb).length;
    }, primary);
    expect(hits, "主色当文字 / 图标须用 --primary-text，本轮用中性色兜底").toBe(0);
  });

  test("§5 规则 4：选中态有程序化状态且不只靠颜色", async ({ page }) => {
    const onTab = page.locator(".skill-tab.on");
    await expect(onTab).toHaveAttribute("aria-pressed", "true");
    const weights = await page.evaluate(() => {
      const on = document.querySelector(".skill-tab.on");
      const off = [...document.querySelectorAll(".skill-tab")].find((el) => !el.classList.contains("on"));
      if (!on || !off) return null;
      return [getComputedStyle(on).fontWeight, getComputedStyle(off).fontWeight];
    });
    expect(weights, "至少要有两个 tab 才能比较权重").not.toBeNull();
    expect(weights![0], "选中态须有非颜色信号（字重）").not.toBe(weights![1]);
  });

  test("§5 规则 5：控件自设 line-height，不继承根的 24px 行盒", async ({ page }) => {
    const lh = await page.locator(".skill-btn").first().evaluate((el) =>
      Number.parseFloat(getComputedStyle(el).lineHeight),
    );
    expect(lh, `控件行高应为 20px 一档，实测 ${lh}px`).toBeLessThanOrEqual(20);
  });

  test("DESIGN.md badge-pill：筛选 chip 自带底、选中用 ink 反相；带框按钮用 --control-border", async ({ page }) => {
    // 文档没有 tabs 组件，本页筛选取 badge-pill 的形态：底色来自 colors.surface-strong，
    // 因此边界由 chip 自己承担（不再需要外层容器画一个面）。
    const strong = await resolvePageToken(page, "--ds-surface");
    const chip = await page.locator(".skill-tab:not(.on)").first();
    expect(await chip.evaluate((el) => getComputedStyle(el).backgroundColor), "chip 必须有可见底").toBe(strong);
    const listBg = await page.locator(".skill-tabs-list").first().evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(listBg, "外层容器不应再重复画一个面").toBe("rgba(0, 0, 0, 0)");

    // 选中态：文档 pricing-tier-featured 的做法——用 ink 反相表示"被选中"，不引入彩色标识。
    const ink = await resolvePageToken(page, "--text");
    const canvas = await resolvePageToken(page, "--bg");
    const on = page.locator(".skill-tab.on").first();
    expect(await on.evaluate((el) => getComputedStyle(el).backgroundColor), "选中 chip 应反相为 ink").toBe(ink);
    expect(await on.evaluate((el) => getComputedStyle(el).color), "反相后文字用画布色").toBe(canvas);

    // 单体带框按钮仍必须用 ≥3:1 的 --control-border 描边（实底 CTA 用主色）。
    const allowed = [await resolvePageToken(page, "--control-border"), await resolvePageToken(page, "--primary")];
    const borders = await page.locator(".skill-btn").evaluateAll((els) =>
      els.map((el) => ({ w: getComputedStyle(el).borderTopWidth, c: getComputedStyle(el).borderTopColor })),
    );
    expect(borders.length, "页面上应有带框按钮").toBeGreaterThan(0);
    for (const b of borders) {
      expect(Number.parseFloat(b.w), "带框按钮必须有可见边框").toBeGreaterThanOrEqual(1);
      expect(allowed, `带框按钮边框色 ${b.c} 不在允许的 token 内`).toContain(b.c);
    }
  });

  test("§5 规则 7 / 8：可点标签一律 ≥13px；带框按钮内不加装饰图标", async ({ page }) => {
    const size = await page.locator(".skill-catalog-page .skill-card-actions .skill-link").first().evaluate((el) =>
      Number.parseFloat(getComputedStyle(el).fontSize),
    );
    expect(size, `动作标签不得低于 13px，实测 ${size}px`).toBeGreaterThanOrEqual(13);
    // 规则 7 的前半句同样有约束力：「查看全部」也是**可点标签**，12px 属违规。
    const more = await page.locator(".skill-group-more").first().evaluate((el) =>
      Number.parseFloat(getComputedStyle(el).fontSize),
    );
    expect(more, `「查看全部」是可点标签，不得低于 13px，实测 ${more}px`).toBeGreaterThanOrEqual(13);
    // 规则 8：带框按钮内不放装饰图标（图标只允许出现在链接式动作与图标按钮上）。
    expect(await page.locator(".skill-btn svg, .skill-btn .skill-btn-icon").count()).toBe(0);
  });

  test("§5 规则 3：主色不得当文字色（全页扫描，含悬停态用 --primary-text）", async ({ page }) => {
    const primary = await resolveToken(page, "--primary");
    const hits = await page.evaluate((rgb) => {
      const out: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>("[data-skill-catalog] *")) {
        if (getComputedStyle(el).color === rgb) out.push(el.className || el.tagName);
      }
      return out;
    }, primary);
    expect(hits, `主色 #DB1860 在白底只有 4.87:1，当文字用一律改用 --primary-text。命中：${JSON.stringify(hits)}`).toEqual([]);
    // 主色文字档必须已登记，且与 --primary 不同值。
    const primaryText = await resolveToken(page, "--primary-text");
    expect(primaryText, "--primary-text 必须已定义").not.toBe("");
    expect(primaryText, "--primary-text 必须比 --primary 更深").not.toBe(primary);
  });

  test("工具风险档与异步契约在卡片上可见", async ({ page }) => {
    expect(await page.locator(".skill-mark").count()).toBeGreaterThan(0);
  });

  test("搜索框有程序化标签，不是只靠 placeholder", async ({ page }) => {
    await expect(page.getByRole("textbox", { name: "搜索技能 / SOP / 场景" })).toBeVisible();
  });

  test("封面卡片的选择入口键盘可达", async ({ page }) => {
    const name = page.locator(".skill-card-name").first();
    await expect(name).toHaveAttribute("aria-pressed");
    await name.focus();
    await expect(name).toBeFocused();
  });

  test("错误与空结果都提供可恢复动作", async ({ page }) => {
    await page.getByRole("textbox", { name: "搜索技能 / SOP / 场景" }).fill("不存在的技能名zzz");
    const state = page.locator(".skill-state");
    await expect(state).toBeVisible();
    await expect(state.getByRole("button", { name: "清除筛选" })).toBeVisible();
  });
});

test("「查看全部」深链真正生效（tab 读 URL）", async ({ page }) => {
  await page.goto("/skills?tab=frequent");
  await page.locator("[data-skill-catalog]").waitFor();
  await expect(page.locator(".skill-tab.on")).toHaveText("常用");
  await expect(page.locator(".skill-tab.on")).toHaveAttribute("aria-pressed", "true");
});

test("§6.2 输入模态轴：触摸设备命中区 ≥44px", async ({ browser }) => {
  const context = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await context.newPage();
  await page.goto("/skills");
  await page.locator("[data-skill-catalog]").waitFor();
  const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  expect(coarse, "该环境未上报 coarse 指针，断言无意义").toBe(true);
  const h = await page.locator(".skill-tab").first().evaluate((el) => el.getBoundingClientRect().height);
  expect(h, `触摸档命中区应 ≥44px，实测 ${h}px`).toBeGreaterThanOrEqual(44);
  await context.close();
});

test.describe("技能详情列（第三栏）", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/skills");
    await page.locator("[data-skill-catalog]").waitFor();
    await page.locator(".skill-card").first().waitFor();
  });

  test("按技能设计：每项技能都给出覆盖表口径，不用通用占位", async ({ page }) => {
    const ids = await page.locator(".skill-card").evaluateAll((els) =>
      [...new Set(els.map((el) => el.getAttribute("data-skill-id") || "").filter(Boolean))],
    );
    expect(ids.length, "至少要有若干技能才能验证").toBeGreaterThan(0);
    for (const id of ids) {
      // 同一技能可能同时出现在「常用技能」与所属分组，取第一张。
      await page.locator(`.skill-card[data-skill-id="${id}"] .skill-card-name`).first().click();
      const detail = page.locator("[data-skill-detail]");
      await expect(detail, `${id} 的详情未展开`).toBeVisible();
      // 口径来源：docs/BUSINESS.md「快捷查询与思考覆盖表」（覆盖 41 个 Skill ID）。
      // 未登记的技能必须走「待补齐」分支——不得编造口径（AGENTS.md / CONST-10）。
      const covered = await detail.getByText("可以直接查到").count();
      if (covered > 0) {
        await expect(detail.getByText("需要走确认或 AI 助理")).toBeVisible();
      } else {
        await expect(detail.getByText("待业务专家补齐")).toBeVisible();
      }
      // 旧版通用占位文案必须消失（不得伪造内容）
      await expect(detail.getByText("相关参数")).toHaveCount(0);
      await expect(detail.getByText("分析结果")).toHaveCount(0);
    }
  });

  test("风险档与异步契约进入详情", async ({ page }) => {
    await page.locator('.skill-card[data-skill-id="creator_discovery"] .skill-card-name').first().click();
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

  test("详情列内最多 1 个实底 CTA（DESIGN.md：Cursor Orange 用得克制）", async ({ page }) => {
    const primary = await resolvePageToken(page, "--primary");
    const filled = await page.evaluate((rgb) => {
      const all = [...document.querySelectorAll<HTMLElement>("[data-skill-detail] *")];
      return all.filter((el) => getComputedStyle(el).backgroundColor === rgb).length;
    }, primary);
    expect(filled).toBeLessThanOrEqual(1);
  });

  test("来源徽章不用引擎名或内部系统名（员工禁词）", async ({ page }) => {
    const catalog = page.locator("[data-skill-catalog]");
    await expect(catalog).not.toContainText("MediaCrawler");
    await expect(catalog).not.toContainText("Starry KOL");
    await expect(catalog).not.toContainText("KOL Agent");
    await expect(catalog).not.toContainText("内核部门");
  });
});

test("窄屏（<900）：详情列改为覆盖层，可关闭，不把交互内容藏掉", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 800, height: 900 } });
  const page = await context.newPage();
  await page.goto("/skills");
  await page.locator("[data-skill-catalog]").waitFor();
  await page.locator(".skill-card").first().waitFor();
  const pane = page.locator(".skill-detail-pane");
  await expect(pane).toBeHidden();
  await page.locator(".skill-card").first().locator(".skill-card-name").click();
  await expect(pane).toBeVisible();
  await page.locator(".skill-detail-close").click();
  await expect(pane).toBeHidden();
  await context.close();
});

test("窄屏覆盖态下「展开」也必须有效（此前点了没反应）", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 860, height: 900 } });
  const page = await context.newPage();
  await page.goto("/skills");
  await page.waitForSelector(".skill-card");
  await page.locator(".skill-card .skill-card-name").first().click();
  const pane = page.locator(".skill-detail-pane");
  await expect(pane).toBeVisible();
  const before = (await pane.boundingBox())!.width;
  await page.locator(".skill-detail-toggle").click();
  await expect(page.locator(".skill-detail-toggle")).toHaveAttribute("aria-expanded", "true");
  await expect.poll(async () => (await pane.boundingBox())!.width).toBeGreaterThan(before);
  await context.close();
});

test.describe("观感与密度修复", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/skills");
    await page.waitForSelector(".skill-card");
  });

  test("卡片不得横向溢出（此前 grid-4 卡溢出 18px）", async ({ page }) => {
    const overflow = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".skill-card")]
        .map((c) => ({ id: c.getAttribute("data-skill-id"), over: c.scrollWidth - c.clientWidth }))
        .filter((r) => r.over > 1),
    );
    expect(overflow, `溢出卡片：${JSON.stringify(overflow)}`).toEqual([]);
  });

  test("卡片只有 1 个动作且为链接式（无框 + 语义图标 + 常驻下划线）", async ({ page }) => {
    const acts = page.locator(".skill-card-actions");
    await expect(acts.first()).toBeVisible();
    const counts = await acts.evaluateAll((els) => els.map((e) => e.children.length));
    expect(counts.every((c) => c === 1), `每张卡只允许 1 个动作，实测：${JSON.stringify(counts)}`).toBe(true);

    const cs = await page.locator(".skill-card-actions .skill-link").first().evaluate((el) => {
      const s = getComputedStyle(el);
      return { border: s.borderTopWidth, deco: s.textDecorationLine, hasIcon: !!el.querySelector("svg") };
    });
    expect(Number.parseFloat(cs.border), "链接式动作应当无框").toBe(0);
    expect(cs.deco, "下划线必须常驻，不只在 hover（§5 规则 15）").toContain("underline");
    expect(cs.hasIcon, "链接式动作必须带语义图标（§5 规则 8）").toBe(true);
  });

  test("卡片与详情栏都不再放「新建会话」（§5 规则 16）", async ({ page }) => {
    await expect(page.locator(".skill-card-actions").filter({ hasText: "新建会话" })).toHaveCount(0);
    await expect(page.locator(".skill-detail-footer").filter({ hasText: "新建会话" })).toHaveCount(0);
  });

  test("「展开」是图标按钮且带 aria-label（§5 规则 8）", async ({ page }) => {
    const t = page.locator(".skill-detail-toggle");
    await expect(t).toHaveAttribute("aria-label", /展开|收窄/);
    expect(await t.evaluate((el) => !!el.querySelector("svg")), "必须是 SVG 图标").toBe(true);
    expect(await t.evaluate((el) => (el.textContent || "").trim()), "不应再有文字").toBe("");
  });

  test("只标例外：卡片上不出现「只读」标记", async ({ page }) => {
    // 注意：不能用 filter({hasText:"只读"})——技能描述文案里就含「只读」二字
    // （例：kol_analyze 的说明是「只读分析公海或跟进红人…」）。要断言的是标记元素。
    const readMarks = await page.locator(".skill-card .skill-mark.is-read").count();
    expect(readMarks, "只读是默认态，不应在卡片上标注（§5 规则 10）").toBe(0);
  });

  test("来源徽章不再上卡片（§5 规则 11）", async ({ page }) => {
    expect(await page.locator(".skill-card-source").count()).toBe(0);
  });

  test("「查看全部」默认带下划线，可被识别为可点", async ({ page }) => {
    const deco = await page.locator(".skill-group-more").first().evaluate((el) => getComputedStyle(el).textDecorationLine);
    expect(deco).toContain("underline");
  });

  test("§5 规则 17：图标只有两档尺寸，无第三档", async ({ page }) => {
    const m = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const allowed = [cs.getPropertyValue("--icon-sm").trim(), cs.getPropertyValue("--icon-md").trim()].map((v) =>
        Math.round(Number.parseFloat(v)),
      );
      const svgs = [...document.querySelectorAll<SVGSVGElement>("[data-skill-catalog] svg")];
      // 忽略 display:none 的图标（桌面端隐藏的关闭按钮），其 rect 宽度是 0，不是一种"尺寸"。
      const got = [
        ...new Set(
          svgs.map((s) => Math.round(s.getBoundingClientRect().width)).filter((w) => w > 0),
        ),
      ].sort((a, b) => a - b);
      return { allowed, got, n: svgs.length };
    });
    expect(m.n, "页面里应当有图标").toBeGreaterThan(0);
    expect(m.got.length, `SVG 宽度出现 ${JSON.stringify(m.got)} 种，只许两档`).toBeLessThanOrEqual(2);
    for (const w of m.got) expect(m.allowed, `${w}px 不在图标阶梯内`).toContain(w);
  });

  test("§5 规则 5：本页每个可操作控件都自设 line-height（不等于继承来的根行盒）", async ({ page }) => {
    // 此前只断言 .skill-btn 一处，结果卡片标题按钮(52 处)与展开按钮继承了根的 24px 行盒。
    // DESIGN.md 的排版层级（如 title-sm 16/1.4 = 22.4px）比根的 24px 小但仍是"自设"，
    // 因此判据不是"≤某个像素"，而是"不得等于继承来的根行盒（除非字号就是根字号）"。
    const bad = await page.evaluate(() => {
      const out: string[] = [];
      const rootCs = getComputedStyle(document.documentElement);
      const rootLh = Number.parseFloat(rootCs.lineHeight);
      const rootFs = Number.parseFloat(rootCs.fontSize);
      // 注意：选择器表里 `[data-skill-catalog] a, button` 的前缀只作用于第一段，
      // 会把侧栏按钮一起捞进来。必须用 :is() 把整张表包住，前缀才作用到全表。
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
    expect(bad, `这些控件没自设行高（继承根的 ${24}px 行盒）：${JSON.stringify(bad)}`).toEqual([]);
  });

  test("DESIGN.md elevation + rounded：画布不是纯白、零投影、圆角只在文档阶梯内", async ({ page }) => {
    const elevated = await resolvePageToken(page, "--bg-elevated");
    const canvas = await resolvePageToken(page, "--bg");
    const r = await page.evaluate(
      ([elevatedRgb, canvasRgb]) => {
        const badSurface: string[] = [];
        const badRadius: string[] = [];
        const shadows: string[] = [];
        // DESIGN.md rounded.*：0 / 4 / 6 / 8 / 12 / 16 / 9999
        const ladder = new Set(["0px", "4px", "6px", "8px", "12px", "16px", "9999px"]);
        for (const el of document.querySelectorAll<HTMLElement>("[data-skill-catalog] *")) {
          const cs = getComputedStyle(el);
          if (cs.display === "none" || el.getBoundingClientRect().width === 0) continue;
          for (const p of ["backgroundColor", "color", "borderTopColor", "borderLeftColor"] as const) {
            if (cs[p] === elevatedRgb) badSurface.push(`${el.className || el.tagName} ${p}`);
          }
          for (const p of ["borderTopLeftRadius", "borderTopRightRadius"] as const) {
            if (!ladder.has(cs[p])) badRadius.push(`${el.className || el.tagName} ${p}=${cs[p]}`);
          }
          // elevation：文档「no drop shadows」。覆盖层（窄屏详情列）是唯一的例外。
          const isOverlay = el.classList.contains("skill-detail-pane") && el.classList.contains("is-open");
          if (!isOverlay && cs.boxShadow && cs.boxShadow !== "none" && !cs.boxShadow.includes("inset")) {
            shadows.push(`${el.className || el.tagName} ${cs.boxShadow}`);
          }
        }
        return {
          badSurface: [...new Set(badSurface)],
          badRadius: [...new Set(badRadius)],
          shadows: [...new Set(shadows)],
          canvasRgb,
        };
      },
      [elevated, canvas],
    );
    // 文档 Do：「Use the cream colors.canvas page floor — never pure white.」
    expect(r.canvasRgb, `本页画布必须是文档的 cream（#f7f7f4），实测 ${r.canvasRgb}`).toBe("rgb(247, 247, 244)");
    expect(r.badSurface, `出现 --bg-elevated 静止面：${JSON.stringify(r.badSurface)}`).toEqual([]);
    expect(r.shadows, `文档禁止投影（除窄屏覆盖层）：${JSON.stringify(r.shadows)}`).toEqual([]);
    expect(r.badRadius, `圆角不在文档阶梯(0/4/6/8/12/16/9999)内：${JSON.stringify(r.badRadius)}`).toEqual([]);
  });

  test("DESIGN.md colors：本页渲染色值必须全部来自文档的 token 集合（白名单反漂移）", async ({ page }) => {
    // 比"≤N 种"更强的判据：多出任何一种颜色都必须能指回文档里的某个 token。
    const allowed = new Set<string>();
    // 逐条解析本页作用域内的 token，白名单由此生成，而不是手写 hex。
    for (const t of [
      "--bg", // colors.canvas
      "--bg-elevated", // 页面未用；留作"若被引用必须来自 token"的哨兵
      "--ds-surface", // colors.surface-strong
      "--text", // colors.ink
      "--text-muted", // colors.body
      "--border", // colors.hairline
      "--control-border", // colors.hairline-strong
      "--primary", // colors.primary-active
      "--primary-hover",
      "--primary-fg", // colors.on-primary
      "--focus-ring", // colors.primary
      "--success",
      "--danger",
      "--warning",
      "--cr-canvas-soft", // colors.canvas-soft
      "--cr-muted", // colors.muted
    ]) {
      allowed.add(await resolvePageToken(page, t));
    }
    allowed.add("rgb(0, 0, 0)"); // 焦点环令牌在壳层的解析值
    allowed.add("rgb(255, 255, 255)"); // colors.surface-card / on-primary

    const r = await page.evaluate(
      ([list]) => {
        const allow = new Set(list as string[]);
        const skip = new Set(["rgba(0, 0, 0, 0)", "transparent"]);
        const stray = new Set<string>();
        for (const el of document.querySelectorAll<HTMLElement>("[data-skill-catalog] *")) {
          const cs = getComputedStyle(el);
          if (cs.display === "none" || el.getBoundingClientRect().width === 0) continue;
          for (const p of ["color", "backgroundColor", "borderTopColor", "borderLeftColor"] as const) {
            const v = cs[p];
            if (!skip.has(v) && !allow.has(v)) stray.add(`${(el.className || el.tagName).toString().slice(0, 34)} ${p}=${v}`);
          }
        }
        return [...stray];
      },
      [[...allowed]],
    );
    expect(r, `这些色值无法指回 DESIGN.md 的任何 token：\n${r.join("\n")}`).toEqual([]);
  });
});


test.describe("§3 命中区 / §6.2 断点 / §7.3 偏好（验收矩阵）", () => {
  test("§3：本页每个可操作元素的命中区 ≥ --hit-min(24px)", async ({ page }) => {
    await page.goto("/skills");
    await page.locator("[data-skill-catalog]").waitFor();
    await page.locator(".skill-card").first().waitFor();
    const bad = await page.evaluate(() => {
      const sel =
        ":is(a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex='-1']))";
      const out: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>(`[data-skill-catalog] ${sel}`)) {
        const r = el.getBoundingClientRect();
        if (getComputedStyle(el).display === "none" || r.width === 0) continue;
        // 命中区可由 ::after 扩出，取元素自身与伪元素命中盒的较大者。
        const after = getComputedStyle(el, "::after");
        const expanded = after.content !== "none" && Number.parseFloat(after.height) >= 24;
        if ((r.height < 24 || r.width < 24) && !expanded) {
          out.push(`${el.className || el.tagName} ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
      }
      return [...new Set(out)];
    });
    expect(bad, `命中区不足 24px 的元素（WCAG 2.2 AA 2.5.8）：${JSON.stringify(bad)}`).toEqual([]);
  });

  test("§1 深色：实底主 CTA 的字对得上 4.5:1，且色值不扩散", async ({ page }) => {
    await page.goto("/skills");
    await page.locator("[data-skill-catalog]").waitFor();
    await page.locator(".skill-card").first().waitFor();
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await page.waitForTimeout(250);
    const cta = page.locator(".skill-btn-primary").first();
    const [fg, bg] = await cta.evaluate((el) => {
      const s = getComputedStyle(el);
      return [s.color, s.backgroundColor];
    });
    const cr = await contrastOf(page, fg, bg);
    // 深色主色 #E0508C 压白字只有 3.69:1；--primary-fg 取 --bg 后才达 4.77:1。
    expect(cr, `深色主 CTA 的文字对比度只有 ${cr}:1（需要 ≥4.5）`).toBeGreaterThanOrEqual(4.5);

    const dark = await page.evaluate(() => {
      const set = new Set<string>();
      const skip = new Set(["rgba(0, 0, 0, 0)", "transparent"]);
      for (const el of document.querySelectorAll<HTMLElement>("[data-skill-catalog] *")) {
        const cs = getComputedStyle(el);
        if (cs.display === "none" || el.getBoundingClientRect().width === 0) continue;
        for (const p of ["color", "backgroundColor", "borderTopColor", "borderLeftColor"] as const) {
          if (!skip.has(cs[p])) set.add(cs[p]);
        }
      }
      return { count: set.size, values: [...set].sort() };
    });
    // 深色比浅色多一个由 --bg 派生的实底字色，故上限 +1。多一个灰/粉就红。
    expect(dark.count, `深色下出现 ${dark.count} 种色值：\n${dark.values.join("\n")}`).toBeLessThanOrEqual(13);
  });

  test("§6.2：S 档（≤414px）内容区单列，不得出现「常用技能 2 列、分组 1 列」", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    await page.goto("/skills");
    await page.locator("[data-skill-catalog]").waitFor();
    await page.locator(".skill-card").first().waitFor();
    const cols = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".skill-grid")].map(
        (g) => `${g.className}=${getComputedStyle(g).gridTemplateColumns.split(" ").length}`,
      ),
    );
    expect(cols.filter((c) => !c.endsWith("=1")), `S 档仍有非单列网格：${JSON.stringify(cols)}`).toEqual([]);
    await ctx.close();
  });

  test("§7.3：prefers-contrast: more 下页面不变坏（色值不扩散、无浅主色静止底）", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, contrast: "more" });
    const page = await ctx.newPage();
    await page.goto("/skills");
    await page.locator("[data-skill-catalog]").waitFor();
    await page.locator(".skill-card").first().waitFor();
    expect(await page.evaluate(() => matchMedia("(prefers-contrast: more)").matches)).toBe(true);
    const r = await page.evaluate(() => {
      let tints = 0;
      const pinkish = ["rgb(252, 228, 236)", "rgb(253, 240, 245)"];
      const canvas = getComputedStyle(document.querySelector("[data-skill-catalog]")!).backgroundColor;
      for (const el of document.querySelectorAll<HTMLElement>("[data-skill-catalog] *")) {
        const cs = getComputedStyle(el);
        if (cs.display === "none" || el.getBoundingClientRect().width === 0) continue;
        if (pinkish.includes(cs.backgroundColor)) tints++;
      }
      return { tints, canvas };
    });
    expect(r.tints, "该偏好下仍不得出现浅主色静止底").toBe(0);
    // 该偏好下页面不应被改变：画布仍是 DESIGN.md 的 cream。
    // （色值集合本身由上面「白名单反漂移」那条断言负责，这里不重复设 N 的上限。）
    expect(r.canvas, "prefers-contrast: more 不应改变页面画布").toBe("rgb(247, 247, 244)");
    await ctx.close();
  });
});

test.describe("「填入输入框」把技能填进输入框", () => {
  test("填入的是技能正文（起始行 + 待补参数），不是只挂一个技能名", async ({ page }) => {
    await page.goto("/skills");
    await page.locator("[data-skill-catalog]").waitFor();
    await page.locator(".skill-card").first().waitFor();

    const card = page.locator('.skill-card[data-skill-id="creator_outreach"]').first();
    await expect(card).toBeVisible();
    await card.locator(".skill-link").click();

    // 落到「新工作任务」，输入框里是技能起始行，芯片同时保留技能名。
    await expect(page).toHaveURL(/\/(?:\?|$)/);
    await expect(page.locator("[data-home] [data-composer-input]"))
      .toHaveValue(/^达人建联话术 \[[^\]]+\]/);
    await expect(page.locator('[data-skill-chip="creator_outreach"]')).toBeVisible();
  });

  test("填技能不会启动今日或待办任务计划", async ({ page }) => {
    const planPosts: string[] = [];
    page.on("request", (request) => {
      if (request.method() !== "POST") return;
      const path = new URL(request.url()).pathname;
      if (path.endsWith("/today-brief/plan") || path.endsWith("/todo-brief/plan")) planPosts.push(path);
    });

    await page.goto("/skills");
    await page.locator("[data-skill-catalog]").waitFor();
    await page.locator('.skill-card[data-skill-id="creator_outreach"]').first()
      .locator(".skill-link").click();
    await expect(page.locator("[data-home] [data-composer-input]")).toHaveValue(/\S/);

    // 落回 Home 不产生任何规划 POST；启动键仍在用户手里。
    await expect(page.locator('[data-home-entry="plan-today"]')).toHaveText("启动今日任务");
    await page.waitForTimeout(3000);
    expect(planPosts).toEqual([]);
  });
});
