import { describe, expect, it } from "vitest";
import { fieldLabel, formatMissingFields, missingFieldsMessage } from "../src/labels.js";

describe("employee-facing field labels", () => {
  it("maps collaboration_id and other API keys to Chinese", () => {
    expect(fieldLabel("collaboration_id")).toBe("合作红人");
    expect(fieldLabel("handle")).toBe("红人");
    expect(fieldLabel("stage_code")).toBe("阶段");
    expect(fieldLabel("conversationId")).toBe("邮件会话");
    expect(fieldLabel("contactEmailMasked")).toBe("联系邮箱");
    expect(fieldLabel("languageKey")).toBe("语言");
    expect(fieldLabel("cooperationStageCode")).toBe("合作阶段");
    expect(fieldLabel("riskTagCode")).toBe("风险标签");
    expect(fieldLabel("followType")).toBe("跟进方式");
    expect(fieldLabel("crawlerSyncStatus")).toBe("同步状态");
    expect(fieldLabel("ownerUserName")).toBe("负责人");
    expect(fieldLabel("status/confirmed/notes/wechat")).toBe("状态、合作确认、备注、微信");
    expect(fieldLabel("follow_style_tags")).toBe("跟进标签");
  });

  it("does not echo unknown snake_case keys", () => {
    expect(fieldLabel("remote_task_id")).toBe("这项信息");
    expect(formatMissingFields(["collaboration_id", "tracking"])).toBe("合作红人、运单号");
    expect(missingFieldsMessage(["kolUid"])).toBe("还需要补充：红人。");
  });
});
