import { describe, expect, it } from "vitest";
import { MAIN_STAGES } from "../src/stages.js";
import {
  exceptionFlowItems,
  isExceptionStage,
  isSopSkill,
  isStageSopSkill,
  SOP_EXCEPTIONS,
  SOP_PACKS,
  SOP_PHASES,
  SOP_VERSION,
  sopPackBySkill,
  sopPackByStage,
  sopPhaseByStage,
  stageSopView,
} from "../src/sops.js";
import { matchSkillId, SKILL_CATALOG } from "../src/host/skills-catalog.js";
import { taskDefinitions } from "../src/tasks/registry.js";
import { collectSopItems, collectStageSopItems } from "../src/worker/session-items.js";

describe("15 SOP packs", () => {
  it("maps one versioned pack and skill per main stage", () => {
    expect(SOP_PACKS).toHaveLength(15);
    expect(MAIN_STAGES).toHaveLength(15);
    expect(SOP_PACKS.map((row) => row.sop_id)).toEqual(MAIN_STAGES.map((row) => row.code));
    for (const pack of SOP_PACKS) {
      expect(pack.version).toBe(SOP_VERSION);
      expect(pack.skill_id).toBe(`sop_${pack.stage_code.toLowerCase()}`);
      expect(isSopSkill(pack.skill_id)).toBe(true);
      expect(sopPackBySkill(pack.skill_id)?.inputs.length).toBeGreaterThan(0);
      expect(taskDefinitions().some((row) => row.id === pack.skill_id)).toBe(true);
      expect(SKILL_CATALOG.some((row) => row.id === pack.skill_id)).toBe(true);
    }
  });

  it("does not steal journey phrases that are not SOP aliases", () => {
    expect(matchSkillId("初步接触")).toBeNull();
    expect(matchSkillId("初步接触SOP")).toBe("sop_initial_contact");
    expect(isSopSkill("email_compose")).toBe(false);
  });
});

describe("eight SOP phases", () => {
  it("covers every official main stage exactly once", () => {
    expect(SOP_PHASES).toHaveLength(8);
    const mapped = SOP_PHASES.flatMap((phase) => [...phase.official]);
    expect(mapped).toEqual(MAIN_STAGES.map((stage) => stage.code));
    for (const stage of MAIN_STAGES) {
      expect(sopPhaseByStage(stage.code)?.official).toContain(stage.code);
    }
  });

  it("outputs the eight-phase track and current official SOP", () => {
    const view = stageSopView("INITIAL_CONTACT");
    expect(view.phase_label).toBe("建联");
    expect(view.track).toHaveLength(8);
    expect(view.track[0]).toMatchObject({ id: "contact", current: true, state: "current" });
    expect(view.inputs).toContain("发件邮箱");
    const items = collectStageSopItems("INITIAL_CONTACT", "qiyou1984");
    expect(items[0].skill).toBe("stage_sop");
    expect(items[0].title).toContain("八个阶段 SOP");
    const titles = (items[0].sections as { title: string }[]).map((section) => section.title);
    expect(titles).toEqual([
      "八个阶段",
      "当前正式阶段",
      "输入",
      "证据",
      "完成条件",
      "当前步骤",
      "各阶段 SOP",
      "八段怎么走",
      "异常流程",
      "边界",
    ]);
    const interested = stageSopView("INTERESTED");
    expect(interested.next_stage).toBe("EVALUATING");
    expect(interested.next_stage_label).toBe("合作评估");
    expect(interested.completion.join("；")).toContain("发送邮件不会修改阶段");
    const interestedItems = collectStageSopItems("INTERESTED");
    const step = ((interestedItems[0].sections as { title: string; items?: string[] }[]) || [])
      .find((section) => section.title === "当前步骤");
    expect(step?.items?.join("；")).toContain("建议下一步正式阶段：合作评估");
    const walk = ((interestedItems[0].sections as { title: string; items?: string[] }[]) || [])
      .find((section) => section.title === "八段怎么走");
    expect(walk?.items?.some((item) => item.includes("由人选定具体正式阶段"))).toBe(true);
    expect(step?.items?.join("；")).not.toContain("EVALUATING");
    expect(isStageSopSkill("stage_sop")).toBe(true);
    expect(matchSkillId("阶段SOP")).toBe("stage_sop");
    expect(matchSkillId("八个阶段")).toBe("stage_sop");
    expect(taskDefinitions().some((row) => row.id === "stage_sop")).toBe(true);
  });

  it("keeps per-stage SOP cards and adds the eight-phase track", () => {
    const items = collectSopItems("sop_initial_contact");
    const titles = (items[0].sections as { title: string }[]).map((section) => section.title);
    expect(titles[0]).toBe("八个阶段");
    expect(titles).toContain("输入");
    expect(titles).toContain("异常流程");
    expect(items[0].phases).toHaveLength(8);
  });
});

describe("eight-phase exception flow", () => {
  it("leaves the main track from any of the eight phases and does not treat 已完成 as exception", () => {
    expect(SOP_EXCEPTIONS.map((row) => row.code)).toEqual([
      "PAUSED", "DISPUTED", "LOST", "REJECTED", "CANCELLED",
    ]);
    expect(isExceptionStage("DISPUTED")).toBe(true);
    expect(isExceptionStage("COMPLETED")).toBe(false);
    expect(isExceptionStage("INITIAL_CONTACT")).toBe(false);
    const flow = exceptionFlowItems("DISPUTED");
    expect(flow.some((item) => item.includes("八段主流程任一阶段都可离开"))).toBe(true);
    expect(flow.some((item) => item.includes("发送邮件不会修改阶段"))).toBe(true);
    expect(flow.some((item) => item.startsWith("▶ 争议中"))).toBe(true);
    expect(flow.some((item) => item.includes("已完成是结算后的终态"))).toBe(true);
  });

  it("outputs bypass SOP for 争议中 and freezes the eight-phase track", () => {
    const view = stageSopView("DISPUTED");
    expect(view.exception).toBe(true);
    expect(view.exception_kind).toBe("bypass");
    expect(view.phase_label).toBe("异常旁路");
    expect(view.track.every((phase) => phase.state === "idle")).toBe(true);
    expect(view.inputs).toContain("争议事实");
    expect(view.next_action).toBe("风险扫描后记状态");
    const items = collectStageSopItems("DISPUTED", "旅行电源菌");
    expect(items[0].title).toContain("八阶段异常 SOP");
    const titles = (items[0].sections as { title: string }[]).map((section) => section.title);
    expect(titles).toContain("异常流程");
    expect(matchSkillId("异常流程")).toBe("stage_sop");
    expect(matchSkillId("八阶段异常")).toBe("stage_sop");
  });

  it("SOP 建议下一步 names this stage's letter", () => {
    expect(collectSopItems("sop_quote_pending")[0].recommended_actions).toEqual([
      "写报价邮件", "提出阶段变更", "阶段SOP",
    ]);
    expect(collectStageSopItems("QUOTE_PENDING", "数码老张")[0].recommended_actions).toEqual([
      "写报价邮件 @数码老张", "记状态 @数码老张",
    ]);
    expect(collectStageSopItems("CONTENT_PLANNING", "母婴小课")[0].recommended_actions).toEqual([
      "发brief @母婴小课", "记状态 @母婴小课",
    ]);
    expect(collectStageSopItems("DISPUTED", "旅行电源菌")[0].recommended_actions).toEqual([
      "风险扫描 @旅行电源菌", "记状态 @旅行电源菌",
    ]);
    expect(sopPackByStage("QUOTE_PENDING")?.next_action).toBe("写报价邮件");
    expect(sopPackByStage("SAMPLE_PENDING")?.next_action).toBe("核对地址");
    expect(sopPackByStage("CONTENT_PLANNING")?.next_action).toBe("发brief");
  });
});
