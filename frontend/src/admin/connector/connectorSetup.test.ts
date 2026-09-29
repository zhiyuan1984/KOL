import { beforeEach, describe, expect, it, vi } from "vitest";

const api = {
  runtimeConnectorConfig: vi.fn(),
  saveRuntimeConnectorConfig: vi.fn(),
  createRuntimeCredential: vi.fn(),
  uploadConnectorIcon: vi.fn(),
  adminSave: vi.fn(),
};

vi.mock("../../api", () => ({ api }));

const { readConnectorConfigVersion, saveConnectorConfigForm } = await import("./connectorSetup");

const MCP_FORM = {
  id: "starrykol",
  label: "Starry KOL",
  protocol: "mcp" as const,
  transport: "streamable-http" as const,
  url: "https://mcp.example.com/mcp",
  noAuth: true,
  headerRows: [],
};

beforeEach(() => {
  api.runtimeConnectorConfig.mockReset();
  api.saveRuntimeConnectorConfig.mockReset();
  api.createRuntimeCredential.mockReset();
  api.uploadConnectorIcon.mockReset();
  api.adminSave.mockReset();
  api.saveRuntimeConnectorConfig.mockResolvedValue({ config: {}, version: 4 });
});

describe("connector config version read-back", () => {
  it("treats a connector without saved config as version 0", async () => {
    api.runtimeConnectorConfig.mockRejectedValue(Object.assign(new Error("not found"), { status: 404 }));
    await expect(readConnectorConfigVersion("draft-only")).resolves.toBe(0);
  });

  it("propagates read failures that are not a missing config", async () => {
    api.runtimeConnectorConfig.mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));
    await expect(readConnectorConfigVersion("starrykol")).rejects.toThrow("boom");
  });

  it("re-saves with the read-back version instead of a hardcoded zero", async () => {
    api.runtimeConnectorConfig.mockResolvedValue({ config: {}, version: 3 });
    const current = await readConnectorConfigVersion("starrykol");
    await saveConnectorConfigForm(MCP_FORM, current);
    expect(api.saveRuntimeConnectorConfig).toHaveBeenCalledTimes(1);
    expect(api.saveRuntimeConnectorConfig).toHaveBeenCalledWith(
      "starrykol",
      expect.objectContaining({ expected_version: 3, transport: "streamable-http", url: "https://mcp.example.com/mcp" }),
    );
  });

  it("uses the caller's version as the only conflict base", async () => {
    await saveConnectorConfigForm(MCP_FORM, 7);
    expect(api.saveRuntimeConnectorConfig).toHaveBeenCalledWith(
      "starrykol",
      expect.objectContaining({ expected_version: 7 }),
    );
  });
});

describe("connector config form writes", () => {
  it("vaults plaintext secret values and keeps existing references", async () => {
    api.createRuntimeCredential.mockResolvedValue({ id: "cred_new" });
    await saveConnectorConfigForm(
      { ...MCP_FORM, noAuth: false, headerRows: [{ name: "X-API-Key", value: "plain-secret" }, { name: "X-Keep", value: "cred_old" }] },
      1,
    );
    expect(api.createRuntimeCredential).toHaveBeenCalledTimes(1);
    expect(api.saveRuntimeConnectorConfig).toHaveBeenCalledWith(
      "starrykol",
      expect.objectContaining({ headers_secret_refs: { "X-API-Key": "cred_new", "X-Keep": "cred_old" } }),
    );
  });

  it("keeps HTTP connectors on the action-catalog driver and passes the definition through", async () => {
    const httpTool = {
      name: "list_orders",
      description: "Read orders",
      inputSchema: { type: "object", properties: {} },
      method: "GET" as const,
      path: "/orders",
    };
    await saveConnectorConfigForm(
      { ...MCP_FORM, protocol: "http", url: "https://api.example.com", httpTools: [httpTool] },
      0,
    );
    const body = api.saveRuntimeConnectorConfig.mock.calls[0][1] as Record<string, unknown>;
    expect(body.transport).toBeUndefined();
    expect(body.http_tools).toEqual([httpTool]);
  });

  it("lets a manually entered Authorization header replace a bearer reference", async () => {
    api.createRuntimeCredential.mockResolvedValue({ id: "cred_authorization" });
    await saveConnectorConfigForm(
      {
        ...MCP_FORM,
        noAuth: false,
        headerRows: [{ name: "Authorization", value: "Bearer manually-entered" }],
        envRefs: { "X-MCP-API-KEY": "STARRY_KOL_MCP_API_KEY", "authorization": "OLD_AUTH_ENV" },
        bearerEnv: "STARRY_KOL_MCP_BEARER",
      },
      2,
    );
    expect(api.saveRuntimeConnectorConfig).toHaveBeenCalledWith(
      "starrykol",
      expect.objectContaining({
        headers_secret_refs: { Authorization: "cred_authorization" },
        headers_env: { "X-MCP-API-KEY": "STARRY_KOL_MCP_API_KEY" },
      }),
    );
    const body = api.saveRuntimeConnectorConfig.mock.calls[0][1] as Record<string, unknown>;
    expect(body.bearer_env).toBeUndefined();
    expect(body.bearer_secret_ref).toBeUndefined();
  });

  it("returns the version the server answered with", async () => {
    api.saveRuntimeConnectorConfig.mockResolvedValue({ config: {}, version: 9 });
    await expect(saveConnectorConfigForm(MCP_FORM, 8)).resolves.toBe(9);
  });
});
