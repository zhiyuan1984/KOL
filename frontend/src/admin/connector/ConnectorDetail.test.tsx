// @vitest-environment jsdom
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  config: vi.fn(), activity: vi.fn(), credentials: vi.fn(), probe: vi.fn(), write: vi.fn(), reload: vi.fn(), save: vi.fn(),
}));
vi.mock("../../api", () => ({ api: {
  runtimeConnectorConfig: mocked.config, runtimeConnectorActivity: mocked.activity,
  runtimeCredentials: mocked.credentials, probeRuntimeConnector: mocked.probe,
  adminSave: mocked.write,
} }));
vi.mock("antd", () => ({
  Form: ({ children, component: _component, layout: _layout, ...props }: any) => <div {...props}>{children}</div>,
  Dropdown: ({ children }: any) => children,
  Drawer: ({ children, open, title, onClose }: any) => open ? <div role="dialog"><h2>{title}</h2><button onClick={onClose}>关闭抽屉</button>{children}</div> : null,
}));
vi.mock("../../components/ConfirmDialog", () => ({ useAdminConfirm: () => ({ ask: vi.fn(), dialog: null }) }));
vi.mock("../../components/ProjectTheme", () => ({ ProjectTheme: ({ children }: any) => children }));
vi.mock("../../components/ConnectorCredentialVault", () => ({ ConnectorCredentialVault: () => <div data-test-vault>全局保险库内容</div> }));
vi.mock("./useDeclaredToolMount", () => ({ useDeclaredToolMount: () => ({ busy: false, mount: vi.fn() }) }));
vi.mock("./ConnectorPanels", () => ({
  ConnectorIconUpload: () => <div>图标</div>, HeaderNameHint: () => null,
  HeaderNameInput: ({ value, onChange, ariaLabel, disabled }: any) => <input aria-label={ariaLabel} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />,
}));
vi.mock("./connectorSetup", async (original) => ({
  ...await original<typeof import("./connectorSetup")>(),
  readConnectorConfigVersion: async () => 3,
  saveConnectorConfigForm: mocked.save,
}));
vi.mock("./ConnectorToolsCard", () => ({ ConnectorToolsCard: ({ onToolCountChange }: any) => {
  const [q, setQ] = useState("");
  useEffect(() => { onToolCountChange?.(62); }, [onToolCountChange]);
  return <section data-connector-tools><input aria-label="测试工具搜索" value={q} onChange={(event) => setQ(event.target.value)} /></section>;
} }));
import { ConnectorDetail } from "./ConnectorDetail";
import { connectorCredentialBindings } from "./ConnectorCredentialBindings";

let container: HTMLDivElement;
let root: Root;
const connector = { id: "starrykol", label: "Starry KOL MCP", purpose: "红人和邮件事实", enabled: 1, status: "enabled", protocol: "mcp", kind: "app" };
function NavigationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return <><output data-test-location>{location.pathname + location.search}</output><button data-test-back onClick={() => navigate(-1)}>返回历史</button></>;
}
async function render(url = "/admin/connectors/starrykol", row = connector) {
  await act(async () => { root.render(<MemoryRouter initialEntries={[url]}><NavigationProbe /><ConnectorDetail connectorId={row.id} connectors={[row]} auditRows={[]} reload={mocked.reload} /></MemoryRouter>); });
}
const selected = () => container.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute("data-connector-detail-tab");
const panel = (id: string) => container.querySelector<HTMLElement>(`[data-connector-detail-panel="${id}"]`)!;
const clickTab = async (id: string) => { await act(async () => container.querySelector<HTMLButtonElement>(`[data-connector-detail-tab="${id}"]`)!.click()); };
async function changeInput(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as any).requestAnimationFrame = (callback: FrameRequestCallback) => { callback(0); return 0; };
  for (const fn of Object.values(mocked)) fn.mockReset();
  mocked.config.mockResolvedValue({ version: 3, config: { protocol: "mcp", url: "https://example.test/mcp", headers_secret_refs: { "X-MCP-API-KEY": "cred_bound" }, timeout_ms: 30000 } });
  mocked.activity.mockResolvedValue({ probes: [{ id: 1, config_version: 3, checked_at: "2026-10-19T20:00:00Z", status: "succeeded", probe_kind: "mcp_tools_list", tool_count: 62, duration_ms: 12 }], events: [] });
  mocked.credentials.mockResolvedValue([
    { id: "cred_bound", type: "organization_secret", label: "绑定凭据", status: "active", key_version: 1 },
    { id: "cred_other", type: "organization_secret", label: "其他连接器凭据", status: "active", key_version: 2 },
  ]);
  mocked.save.mockResolvedValue(4);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe("connector detail Tab contract", () => {
  it("defaults a saved connector to tools, with four ARIA-linked panels and dynamic catalog count", async () => {
    await render();
    expect(selected()).toBe("tools");
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(4);
    expect(container.querySelector('[data-connector-detail-tab="tools"]')?.textContent).toContain("62");
    expect(panel("config").hidden).toBe(true);
    expect(panel("tools").hidden).toBe(false);
    for (const tab of container.querySelectorAll('[role="tab"]')) expect(document.getElementById(tab.getAttribute("aria-controls")!)).not.toBeNull();
    expect(mocked.probe).not.toHaveBeenCalled(); expect(mocked.write).not.toHaveBeenCalled();
  });
  it("defaults an unsaved connector to config without silently testing or discovering", async () => {
    mocked.config.mockRejectedValue(Object.assign(new Error("not found"), { status: 404 }));
    await render("/admin/connectors/starrykol?other=keep", { ...connector, enabled: 0, status: "draft" });
    expect(selected()).toBe("config");
    expect(container.querySelector('[data-test-location]')?.textContent).toContain("other=keep&tab=config");
    expect(mocked.probe).not.toHaveBeenCalled();
  });
  it("honors explicit deep links, preserves unrelated query parameters and restores browser-back selection", async () => {
    await render("/admin/connectors/starrykol?tab=audit&from=catalog");
    expect(selected()).toBe("audit");
    await clickTab("tools");
    expect(container.querySelector('[data-test-location]')?.textContent).toBe("/admin/connectors/starrykol?tab=tools&from=catalog");
    await act(async () => container.querySelector<HTMLButtonElement>('[data-test-back]')!.click());
    expect(selected()).toBe("audit");
    expect(mocked.config).toHaveBeenCalledTimes(1);
    expect(mocked.probe).not.toHaveBeenCalled();
  });
  it("refresh-style remount recovers the explicit Tab on the same connector address", async () => {
    await render("/admin/connectors/starrykol?tab=credentials");
    expect(selected()).toBe("credentials");
    act(() => root.unmount()); root = createRoot(container);
    await render("/admin/connectors/starrykol?tab=credentials");
    expect(selected()).toBe("credentials");
    expect(container.querySelector('[data-test-location]')?.textContent).toBe("/admin/connectors/starrykol?tab=credentials");
  });
  it("preserves dirty configuration and tool search when switching panels without reloading the form", async () => {
    await render("/admin/connectors/starrykol?tab=config");
    await changeInput('[data-connector-field="url"]', "https://changed.test/mcp");
    await clickTab("tools");
    expect(container.querySelector('.connector-config-dirty-note')?.textContent).toContain("未保存改动");
    await changeInput('[aria-label="测试工具搜索"]', "mail");
    await clickTab("audit"); await clickTab("tools");
    expect(container.querySelector<HTMLInputElement>('[aria-label="测试工具搜索"]')?.value).toBe("mail");
    await clickTab("config");
    expect(container.querySelector<HTMLInputElement>('[data-connector-field="url"]')?.value).toBe("https://changed.test/mcp");
    expect(mocked.config).toHaveBeenCalledTimes(1); expect(mocked.save).not.toHaveBeenCalled();
  });
  it("uses Home, End and arrow keys for selection/focus without running an operation", async () => {
    await render("/admin/connectors/starrykol?tab=tools");
    const key = async (name: string) => { await act(async () => container.querySelector('[role="tab"][aria-selected="true"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }))); };
    await key("End"); expect(selected()).toBe("audit");
    await key("Home"); expect(selected()).toBe("config");
    await key("ArrowRight"); expect(selected()).toBe("tools");
    expect(document.activeElement?.getAttribute("data-connector-detail-tab")).toBe("tools");
    expect(mocked.probe).not.toHaveBeenCalled();
  });
  it("shows enabled separately from a failed recent probe and does not invent connectivity", async () => {
    mocked.activity.mockResolvedValue({ probes: [{ id: 2, config_version: 3, checked_at: "2026-10-19T20:00:00Z", status: "failed", duration_ms: 10, tool_count: 0, probe_kind: "mcp_tools_list" }], events: [] });
    await render();
    expect(container.querySelector('[data-connector-status-note]')?.textContent).toContain("已启用");
    expect(container.querySelector('[data-connector-test-status]')?.textContent).toBe("最近测试失败");
  });
  it("limits credential rows to saved bound references and gates global management behind an explicit entry", async () => {
    await render("/admin/connectors/starrykol?tab=credentials");
    const refs = container.querySelector('[data-connector-credential-references]')!;
    expect(refs.textContent).toContain("cred_bound"); expect(refs.textContent).not.toContain("cred_other");
    expect(container.querySelector('[data-test-vault]')).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('[data-connector-global-vault-open]')!.click());
    expect(container.querySelector('[data-connector-global-vault-warning]')?.textContent).toContain("其他引用方");
    expect(container.querySelector('[data-test-vault]')).not.toBeNull(); expect(mocked.write).not.toHaveBeenCalled();
  });
  it("preserves environment and bearer references without any plaintext secret fields", () => {
    expect(connectorCredentialBindings({ headers_env: { "X-Key": "API_KEY" }, bearer_secret_ref: "cred_bearer" })).toEqual([
      { name: "Authorization · Bearer", ref: "cred_bearer", source: "保险库" },
      { name: "X-Key", ref: "API_KEY", source: "环境变量" },
    ]);
  });
  it("keeps the configuration Tab after save and requires a fresh test rather than reusing a historical pass", async () => {
    await render("/admin/connectors/starrykol?tab=config");
    await changeInput('[data-connector-field="url"]', "https://changed.test/mcp");
    mocked.config.mockResolvedValue({ version: 4, config: { protocol: "mcp", url: "https://changed.test/mcp", headers_secret_refs: { "X-MCP-API-KEY": "cred_bound" }, timeout_ms: 30000 } });
    await act(async () => container.querySelector<HTMLButtonElement>('[data-connector-panel-save]')!.click());
    expect(selected()).toBe("config");
    expect(mocked.save).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-connector-test-status]')?.textContent).toBe("配置已更新，待重新测试");
    expect(container.querySelector('[data-connector-detail-tab="config"]')?.textContent).not.toContain("未保存");
    expect(mocked.probe).not.toHaveBeenCalled();
  });
  it("does not claim missing credentials or a successful test when metadata/config reads fail", async () => {
    mocked.config.mockRejectedValue(Object.assign(new Error("配置读取失败"), { status: 503 }));
    mocked.activity.mockRejectedValue(new Error("记录不可用"));
    await render("/admin/connectors/starrykol?tab=credentials");
    expect(selected()).toBe("credentials");
    expect(container.querySelector('[data-connector-credentials]')?.textContent).toContain("若读取失败");
    expect(container.querySelector('[data-connector-test-status]')?.textContent).toBe("测试记录读取失败");
    expect(container.querySelector('[data-connector-credential-references]')).toBeNull();
    expect(mocked.credentials).not.toHaveBeenCalled();
  });
  it("keeps compact configuration groups and an accessible panel entry without changing field identity", async () => {
    await render("/admin/connectors/starrykol?tab=config");
    expect([...container.querySelectorAll('.connector-config-section')].map((section) => section.getAttribute('aria-label'))).toEqual(["基础信息", "端点与鉴权", "请求选项"]);
    expect(panel("config").tabIndex).toBe(0);
    expect(container.querySelector('.connector-field-transport [data-connector-field="transport"]')).not.toBeNull();
    expect(container.querySelector('.connector-field-timeout [data-connector-field="timeout"]')).not.toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('[data-connector-field="purpose"]')?.rows).toBe(2);
    expect(mocked.save).not.toHaveBeenCalled();
  });
  it("shows pending reference removal and lets the user undo it without saving or dropping the binding", async () => {
    await render("/admin/connectors/starrykol?tab=config");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="移除 X-MCP-API-KEY 的引用"]')!.click());
    expect(container.querySelector('[data-connector-header-removal]')?.textContent).toContain("保存后生效");
    await clickTab("credentials");
    expect(container.querySelector('[data-connector-credential-references]')?.textContent).toContain("cred_bound");
    await clickTab("config");
    await act(async () => container.querySelector<HTMLButtonElement>('[data-connector-header-removal] button')!.click());
    expect(container.querySelector('[data-connector-header-removal]')).toBeNull();
    expect(container.querySelector<HTMLInputElement>('[aria-label="Header 名称"]')?.value).toBe("X-MCP-API-KEY");
    expect(mocked.save).not.toHaveBeenCalled(); expect(mocked.write).not.toHaveBeenCalled();
  });
  it("refreshes audit reads explicitly and preserves real duration/config-version metadata", async () => {
    await render("/admin/connectors/starrykol?tab=audit");
    expect(container.querySelector('.connector-audit-record-meta')?.textContent).toContain("12 ms");
    expect(container.querySelector('.connector-audit-record-meta')?.textContent).toContain("配置 v3");
    expect(container.querySelector('.connector-audit-list time')?.getAttribute("datetime")).toBe("2026-10-19T20:00:00Z");
    await act(async () => container.querySelector<HTMLButtonElement>('[data-connector-audit-refresh]')!.click());
    expect(mocked.activity).toHaveBeenCalledTimes(2);
    expect(mocked.probe).not.toHaveBeenCalled(); expect(mocked.write).not.toHaveBeenCalled();
  });
});
