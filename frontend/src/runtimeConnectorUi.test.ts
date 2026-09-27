import { describe, expect, it } from "vitest";
import { credentialVaultMessage, errorMessage, versionConflictMessage } from "./runtimeConnectorUi";

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
