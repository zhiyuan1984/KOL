import { describe, expect, it } from "vitest";
import { judgeCollaborationStage } from "../src/stage-judgment.js";

describe("stage judgment hard rules", () => {
  it("does not treat a thank-you-only reply as interest", () => {
    const result = judgeCollaborationStage({
      subject: "Re: Collaboration Opportunity with LiTime",
      body: "Thank you for your email.",
      current_stage: "INITIAL_CONTACT",
    });
    expect(result.suggested_stage).toBeNull();
    expect(result.auto_propose).toBe(false);
    expect(result.flags).toContain("thank_you_only");
    expect(result.reason).toMatch(/感谢|已读|有兴趣/);
  });

  it("treats delay or family emergency as care, not a default breach", () => {
    const result = judgeCollaborationStage({
      subject: "Need more time",
      body: "We had a family emergency and need to delay the publish date.",
      current_stage: "CONTENT_PLANNING",
    });
    expect(result.suggested_stage).toBeNull();
    expect(result.auto_propose).toBe(false);
    expect(result.flags).toContain("delay_care");
    expect(result.reason).toMatch(/延期|关怀|违约/);
  });

  it("keeps please confirm as pending, not confirmed", () => {
    const result = judgeCollaborationStage({
      subject: "Please confirm",
      body: "Please confirm the final terms so we can move forward.",
      current_stage: "NEGOTIATING",
    });
    expect(result.suggested_stage).toBe("PLAN_PENDING");
    expect(result.flags).toContain("please_confirm");
    expect(result.auto_propose).toBe(false);
  });

  it("treats invoice received as unpaid settling, payment sent as paid", () => {
    const invoice = judgeCollaborationStage({
      body: "Please find the invoice attached. Invoice received on our side.",
      current_stage: "PUBLISHED",
    });
    expect(invoice.suggested_stage).toBe("SETTLING");
    expect(invoice.flags).toContain("invoice_unpaid");

    const paid = judgeCollaborationStage({
      body: "Payment sent. Transaction id TX-88.",
      current_stage: "SETTLING",
    });
    expect(paid.suggested_stage).toBe("SETTLING");
    expect(paid.flags).toContain("paid");
    expect(paid.auto_propose).toBe(true);
  });

  it("suggests INTERESTED from a Chinese collaboration ask", () => {
    const result = judgeCollaborationStage({
      subject: "",
      body: "这是一封测试邮件，请查收，我现在想和贵品牌litime合作",
      current_stage: "INITIAL_CONTACT",
    });
    expect(result.suggested_stage).toBe("INTERESTED");
    expect(result.auto_propose).toBe(true);
    expect(result.reason).not.toMatch(/证据不足/);
  });

  it("does not auto-propose from subject-only evidence", () => {
    const result = judgeCollaborationStage({
      subject: "Content is live on YouTube",
      body: "",
      current_stage: "PUBLISH_PENDING",
    });
    expect(result.suggested_stage).toBeNull();
    expect(result.confidence).toBe("low");
    expect(result.auto_propose).toBe(false);
    expect(result.reason).toMatch(/主题/);
  });

  it("weights body over subject, attachments, then fulfillment", () => {
    const bodyWins = judgeCollaborationStage({
      subject: "Now live on YouTube",
      body: "We are interested and would love to collaborate.",
      current_stage: "INITIAL_CONTACT",
    });
    expect(bodyWins.suggested_stage).toBe("INTERESTED");
    expect(bodyWins.confidence).toBe("high");

    const attachWins = judgeCollaborationStage({
      subject: "Re: LiTime",
      body: "See attached.",
      attachments: ["media kit and audience demographics.pdf"],
      current_stage: "INTERESTED",
    });
    expect(attachWins.suggested_stage).toBe("EVALUATING");

    const fulfillment = judgeCollaborationStage({
      subject: "Update",
      body: "FYI",
      fulfillment: { tracking: "1Z999AA10123456784" },
      current_stage: "SAMPLE_PENDING",
    });
    expect(fulfillment.suggested_stage).toBe("SHIPPED");
    expect(fulfillment.confidence).toBe("medium");
  });

  it("lowers confidence and blocks auto-propose when skipping ahead", () => {
    const result = judgeCollaborationStage({
      body: "The video is now live on YouTube https://youtube.com/watch?v=abc",
      current_stage: "INITIAL_CONTACT",
    });
    expect(result.suggested_stage).toBe("PUBLISHED");
    expect(result.confidence).toBe("medium");
    expect(result.auto_propose).toBe(false);
  });
});
