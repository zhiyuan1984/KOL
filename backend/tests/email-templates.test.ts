import { describe, expect, it } from "vitest";
import {
  EMAIL_TEMPLATES,
  TEMPLATES,
  pickTemplateForSkill,
  templateAllowedForStage,
  templateById,
} from "../src/email-templates.js";
import { MAIN_STAGES } from "../src/stages.js";

describe("business email catalog", () => {
  it("covers one main-flow letter per official stage plus exception and long-term letters", () => {
    const main = EMAIL_TEMPLATES.filter((row) => row.kind === "main");
    for (const stage of MAIN_STAGES) {
      expect(
        main.some((row) => row.stages.includes(stage.code)),
        `missing main template for ${stage.code}`,
      ).toBe(true);
    }
    expect(EMAIL_TEMPLATES.filter((row) => row.kind === "exception").map((row) => row.id)).toEqual([
      "delay_followup.v1",
      "lost_contact.v1",
      "revision_nudge.v1",
    ]);
    expect(EMAIL_TEMPLATES.filter((row) => row.kind === "longterm").map((row) => row.id)).toEqual([
      "affiliate_invite.v1",
      "affiliate_setup.v1",
      "content_license.v1",
      "repeat_collab.v1",
    ]);
  });

  it("picks the most specific stage_mail template and keeps T4 followup on first contact", () => {
    expect(pickTemplateForSkill("stage_mail", "INITIAL_CONTACT").id).toBe("stage_mail.followup");
    expect(pickTemplateForSkill("stage_mail", "INTERESTED").id).toBe("stage_mail.interested");
    expect(pickTemplateForSkill("stage_mail", "CONTENT_PLANNING").id).toBe("stage_mail.brief");
    expect(pickTemplateForSkill("stage_mail", "PUBLISHED").id).toBe("stage_mail.publish_live");
    expect(pickTemplateForSkill("delay_followup", "PUBLISHED").id).toBe("delay_followup.v1");
    expect(TEMPLATES.stage_mail).toContain("stage_mail.followup");
    expect(TEMPLATES.stage_mail).toContain("stage_mail.brief");
    expect(templateById("kol.first_touch")?.stages).toEqual(["INITIAL_CONTACT"]);
  });

  it("gates the wrong stage template at send time", () => {
    expect(templateAllowedForStage("stage_mail.followup", "INITIAL_CONTACT")).toBe(true);
    expect(templateAllowedForStage("stage_mail.followup", "INTERESTED")).toBe(true);
    expect(templateAllowedForStage("stage_mail.followup", "PUBLISHED")).toBe(false);
    expect(templateAllowedForStage("content_nudge.outline", "CONTENT_PLANNING")).toBe(true);
    expect(templateAllowedForStage("content_nudge.outline", "INITIAL_CONTACT")).toBe(false);
    expect(templateAllowedForStage("delay_followup.v1", "PUBLISHED")).toBe(true);
    expect(templateAllowedForStage("unknown.template", "INITIAL_CONTACT")).toBe(false);
  });
});
