import { describe, expect, it } from "vitest";
import {
  coverageToolStateLabel,
  credentialVaultMessage,
  errorMessage,
  implementationLabel,
  mountableDeclaredCount,
  mountSkipReasonLabel,
  versionConflictMessage,
} from "./runtimeConnectorUi";

function httpError(status: number, payload: unknown): Error & { status: number; payload: unknown } {
  return Object.assign(new Error(`请求失败 (${status})`), { status, payload });
}

describe("credential vault failures", () => {
  it("explains a missing master key instead of the bare request failure", () => {
    const error = httpError(503, { detail: { code: "runtime_credential_master_key_unavailable" } });
    const message = credentialVaultMessage(error);
    expect(message).toContain("RUNTIME_CREDENTIAL_MASTER_KEY");
    expect(message).toContain("凭据保险库主密钥");
    expect(message).not.toContain("请求失败");
    expect(errorMessage(error, "连接器未保存")).toBe(message);
  });

  it("covers an unusable key and unreadable stored secrets", () => {
    for (const code of [
      "runtime_credential_master_key_invalid",
      "runtime_credential_decryption_failed",
      "runtime_credential_unavailable",
      "runtime_credential_provider_unavailable",
    ]) {
      expect(credentialVaultMessage(httpError(503, { detail: { code } }))).toContain("RUNTIME_CREDENTIAL_MASTER_KEY");
    }
  });

  it("also reads a stringified error body", () => {
    const error = httpError(503, JSON.stringify({ detail: { code: "runtime_credential_master_key_unavailable" } }));
    expect(credentialVaultMessage(error)).toContain("RUNTIME_CREDENTIAL_MASTER_KEY");
  });

  it("leaves unrelated statuses and codes alone", () => {
    expect(credentialVaultMessage(httpError(503, { detail: { code: "runtime_connector_disabled" } }))).toBeNull();
    expect(credentialVaultMessage(httpError(409, { detail: { code: "runtime_credential_master_key_unavailable" } }))).toBeNull();
    expect(credentialVaultMessage(new Error("boom"))).toBeNull();
    expect(errorMessage(httpError(503, { detail: { code: "runtime_connector_disabled" } }), "连接器未保存")).toBe("请求失败 (503)");
    expect(versionConflictMessage(httpError(409, { detail: { code: "runtime_governance_version_conflict" } }))).toContain("其他管理员");
  });
});

describe("skill coverage copy", () => {
  it("names every declaration state in the user's words", () => {
    expect(coverageToolStateLabel("mounted")).toBe("已挂载");
    expect(coverageToolStateLabel("available")).toBe("可挂载");
    expect(coverageToolStateLabel("blocked_by_policy")).toContain("策略未启用");
    expect(coverageToolStateLabel("unregistered")).toContain("未登记");
    expect(coverageToolStateLabel("unknown_connector")).toBe("无对应连接器");
  });

  it("explains why a declared tool was skipped, and keeps unknown codes verbatim", () => {
    expect(mountSkipReasonLabel("policy_disabled")).toContain("L3");
    expect(mountSkipReasonLabel("policy_unregistered")).toContain("测试");
    expect(mountSkipReasonLabel("brand_new_reason")).toBe("brand_new_reason");
  });

  it("counts only the declared tools that can be mounted right now", () => {
    const row = {
      skill_id: "creator_profile",
      label: "达人画像",
      stage: "published",
      published_version: 2,
      agents: ["agent:kol"],
      agent_bound: true,
      implementation: "live" as const,
      declared_tools: 3,
      mounted_tools: 1,
      pending_tools: 2,
      tools: [
        { connector_id: "starrykol", tool_name: "pageKolProfiles", declared_as: "starrykol.pageKolProfiles", state: "mounted" as const },
        { connector_id: "starrykol", tool_name: "getKolProfileDetail", declared_as: "starrykol.getKolProfileDetail", state: "available" as const },
        { connector_id: "starrykol", tool_name: "sendEmailNow", declared_as: "starrykol.sendEmailNow", state: "blocked_by_policy" as const },
      ],
    };
    expect(mountableDeclaredCount(row)).toBe(1);
    expect(implementationLabel(row.implementation)).toBe("已上线");
    expect(implementationLabel("defined")).toBe("待上线");
  });
});
