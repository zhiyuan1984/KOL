// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const connectorApi = vi.hoisted(() => ({
  runtimeConnectorDiscovery: vi.fn(),
  runtimeConnectorPolicies: vi.fn(),
}));

vi.mock("../../api", () => ({ api: connectorApi }));
vi.mock("../../components/WorkspaceSearchInput", () => ({
  default: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));
vi.mock("antd", () => ({
  Drawer: ({ open, title, children, className, onClose }: {
    open?: boolean;
    title?: React.ReactNode;
    children?: React.ReactNode;
    className?: string;
    onClose?: () => void;
  }) => open ? (
    <aside className={className} role="dialog" aria-label={typeof title === "string" ? title : "工具 Schema"}>
      <button type="button" onClick={onClose}>关闭</button>
      {children}
    </aside>
  ) : null,
}));

import { ConnectorToolsReadOnlyList } from "./ConnectorToolsCard";

let root: Root;
let host: HTMLDivElement;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setControlValue(control: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype = control instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLSelectElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(control, value);
  control.dispatchEvent(new Event(control instanceof HTMLInputElement ? "input" : "change", { bubbles: true }));
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  connectorApi.runtimeConnectorDiscovery.mockReset();
  connectorApi.runtimeConnectorPolicies.mockReset();
  connectorApi.runtimeConnectorDiscovery.mockResolvedValue({
    tools: [
      {
        name: "list_profiles",
        description: "Search profile records",
        inputSchema: { type: "object", properties: { limit: { type: "number" } } },
        schema_hash: "schema-list-v1",
      },
      {
        name: "send_email",
        description: "Send an external message",
        inputSchema: { type: "object", properties: { recipient: { type: "string" } }, required: ["recipient"] },
        schema_hash: "schema-send-v1",
      },
    ],
    authorization: "ignored-by-read-only-catalog",
  });
  connectorApi.runtimeConnectorPolicies.mockResolvedValue([
    { connector_id: "connector-a", tool_name: "list_profiles", enabled: true, risk: "L1", access: "read", schema_hash: "schema-list-v1", version: 1 },
    { connector_id: "connector-a", tool_name: "send_email", enabled: false, risk: "L3", access: "write", schema_hash: "schema-send-v1", version: 1 },
  ]);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("ConnectorToolsReadOnlyList detail mode", () => {
  it("filters by name/description, platform risk, and platform enablement without changing policy values", async () => {
    const onToolCountChange = vi.fn();
    await act(async () => {
      root.render(<ConnectorToolsReadOnlyList connectorId="connector-a" compact detailMode filterable onToolCountChange={onToolCountChange} />);
    });
    await flush();

    expect(onToolCountChange).toHaveBeenLastCalledWith(2);
    expect(host.querySelector("[data-connector-tools-count]")?.textContent).toContain("数量来源为最近一次服务端工具发现");
    expect(host.querySelector('[data-connector-tool="list_profiles"]')).not.toBeNull();
    expect(host.querySelector('[data-connector-tool="send_email"]')).not.toBeNull();

    const search = host.querySelector("[data-connector-drawer-search]") as HTMLInputElement;
    act(() => setControlValue(search, "email"));
    await flush();
    expect(host.querySelector('[data-connector-tool="list_profiles"]')).toBeNull();
    expect(host.querySelector('[data-connector-tool="send_email"]')).not.toBeNull();

    act(() => setControlValue(search, ""));
    const risk = host.querySelector("[data-connector-tools-risk-filter]") as HTMLSelectElement;
    act(() => setControlValue(risk, "L1"));
    await flush();
    expect(host.querySelector('[data-connector-tool="list_profiles"]')).not.toBeNull();
    expect(host.querySelector('[data-connector-tool="send_email"]')).toBeNull();

    act(() => setControlValue(risk, "all"));
    const platform = host.querySelector("[data-connector-tools-platform-filter]") as HTMLSelectElement;
    act(() => setControlValue(platform, "disabled"));
    await flush();
    expect(host.querySelector('[data-connector-tool="list_profiles"]')).toBeNull();
    expect(host.querySelector('[data-connector-tool="send_email"]')).not.toBeNull();
    expect(host.textContent).toContain("平台风险 L3");
  });

  it("shows the complete schema in a read-only Drawer", async () => {
    await act(async () => {
      root.render(<ConnectorToolsReadOnlyList connectorId="connector-a" compact detailMode />);
    });
    await flush();

    const schemaButton = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "查看 Schema");
    expect(schemaButton).toBeTruthy();
    act(() => schemaButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await flush();

    const drawer = host.querySelector("[data-connector-tools-catalog] .connector-detail-tool-schema-drawer");
    expect(drawer?.textContent).toContain("schema-list-v1");
    expect(drawer?.textContent).toContain("原始 inputSchema（只读）");
    expect(drawer?.textContent).toContain('"limit"');
    expect(drawer?.querySelector("input, textarea, select")).toBeNull();
    expect(drawer?.textContent).toContain("不提供执行、授权或范围操作");
  });
});
