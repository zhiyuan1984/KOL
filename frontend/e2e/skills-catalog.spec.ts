import { devices, expect, test, type Page } from "@playwright/test";

/**
 * 技能目录页对 `docs/DESIGN.md` 的验收（实施细则；CONST-09 层级）。
 * 覆盖 §5 的 8 条使用规则与 §6.2 的输入模态轴。数值来源见 DESIGN.md §1–§3。
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

test.describe("技能目录页（/skills）", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/skills");
    await page.locator("[data-skill-catalog]").waitFor();
    await page.locator(".skill-card").first().waitFor();
  });

  test("§5 规则 1：同一视口 0–1 个实底主 CTA", async ({ page }) => {
    const primary = await resolveToken(page, "--primary");
    const filled = await page.evaluate((rgb) => {
      const all = [...document.querySelectorAll<HTMLElement>("[data-skill-catalog] *")];
      return all.filter((el) => {
        const cs = getComputedStyle(el);
        return cs.backgroundColor === rgb && cs.visibility !== "hidden" && el.getBoundingClientRect().width > 0;
      }).length;
    }, primary);
    expect(filled, `--primary 填色元素应为 0–1 个，实测 ${filled} 个`).toBeLessThanOrEqual(1);
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
    const primary = await resolveToken(page, "--primary");
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

  test("§5 规则 6：可操作控件边框用 --control-border（≥3:1）", async ({ page }) => {
    const controlBorder = await resolveToken(page, "--control-border");
    const border = await page.locator(".skill-tab:not(.on)").first().evaluate((el) => getComputedStyle(el).borderTopColor);
    expect(border).toBe(controlBorder);
  });

  test("§5 规则 7 / 8：动作标签 ≥13px；带框按钮内不加装饰图标", async ({ page }) => {
    const size = await page.locator(".skill-catalog-page .skill-card-actions .skill-link").first().evaluate((el) =>
      Number.parseFloat(getComputedStyle(el).fontSize),
    );
    expect(size, `动作标签不得低于 13px，实测 ${size}px`).toBeGreaterThanOrEqual(13);
    // 规则 8：带框按钮内不放装饰图标（图标只允许出现在链接式动作与图标按钮上）。
    expect(await page.locator(".skill-btn svg, .skill-btn .skill-btn-icon").count()).toBe(0);
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

  test("详情列内最多 1 个实底 CTA（DESIGN.md §5 规则 1）", async ({ page }) => {
    const primary = await resolveToken(page, "--primary");
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

  test("§5 规则 18：本页计算色值 ≤ 20 种（反灰/粉扩散）", async ({ page }) => {
    const r = await page.evaluate(() => {
      const set = new Set<string>();
      const skip = new Set(["rgba(0, 0, 0, 0)", "transparent"]);
      for (const el of document.querySelectorAll<HTMLElement>("[data-skill-catalog] *")) {
        const cs = getComputedStyle(el);
        for (const p of ["color", "backgroundColor", "borderTopColor", "borderLeftColor"] as const) {
          const v = cs[p];
          if (!skip.has(v)) set.add(v);
        }
      }
      return { count: set.size, values: [...set].sort() };
    });
    expect(r.count, `本页出现 ${r.count} 种色值：\n${r.values.join("\n")}`).toBeLessThanOrEqual(20);
  });
});
