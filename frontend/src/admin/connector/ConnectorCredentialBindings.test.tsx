// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({ credentials: vi.fn() }));
vi.mock("../../api", () => ({ api: { runtimeCredentials: mocked.credentials } }));
vi.mock("antd", () => ({
  Drawer: ({ children, open, title, onClose }: any) => open ? <div role="dialog"><h2>{title}</h2><button type="button" onClick={onClose}>关闭保险库</button>{children}</div> : null,
}));
vi.mock("../../components/ConnectorCredentialVault", () => ({ ConnectorCredentialVault: () => <div data-test-vault>保险库内容</div> }));

import { ConnectorCredentialBindings } from "./ConnectorCredentialBindings";

const savedCredential = {
  id: "cred_saved", type: "organization_secret" as const, owner_user_id: null, label: "已保存 API 凭据", purpose: "MCP 访问", status: "active" as const,
  key_version: 3, version: 7, created_by: "admin", created_at: "2026-10-20T00:00:00Z", updated_at: "2026-10-20T00:00:00Z",
};
const otherCredential = { ...savedCredential, id: "cred_other", label: "其他连接器凭据" };
const savedConfig = {
  headers_secret_refs: { "X-API-Key": "cred_saved" },
  headers_env: { "X-Region": "RUNTIME_REGION" },
};

let container: HTMLDivElement;
let root: Root;
const editBinding = vi.fn();

async function render(props: Partial<Parameters<typeof ConnectorCredentialBindings>[0]> = {}) {
  await act(async () => {
    root.render(<ConnectorCredentialBindings config={savedConfig} configVersion={3} configLoaded onOpenConfig={editBinding} {...props} />);
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  mocked.credentials.mockReset();
  mocked.credentials.mockResolvedValue([savedCredential, otherCredential]);
  editBinding.mockReset();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe("ConnectorCredentialBindings", () => {
  it("renders only saved references and never a secret value", async () => {
    await render();
    const references = container.querySelector<HTMLElement>("[data-connector-credential-references]")!;
    expect(references.querySelectorAll("li")).toHaveLength(2);
    expect(references.textContent).toContain("cred_saved");
    expect(references.textContent).toContain("RUNTIME_REGION");
    expect(references.textContent).not.toContain("cred_other");
    expect(references.textContent).not.toContain("TOP_SECRET_VALUE");
    expect(container.querySelector('[data-connector-credential-status="cred_saved"]')?.textContent).toBe("可用");
    expect(container.querySelector('[data-connector-credential-status="RUNTIME_REGION"]')?.textContent).toContain("未确认");
  });

  it("disables an in-flight refresh and clears a previous active state after a metadata error", async () => {
    const first = deferred<typeof savedCredential[]>();
    mocked.credentials.mockImplementationOnce(() => first.promise).mockRejectedValueOnce(new Error("元数据服务不可用"));
    await render({ config: { headers_secret_refs: { Authorization: "cred_saved" } } });
    const refresh = container.querySelector<HTMLButtonElement>("[data-connector-credential-refresh]")!;
    expect(refresh.disabled).toBe(true);
    expect(refresh.getAttribute("aria-busy")).toBe("true");
    await act(async () => { first.resolve([savedCredential]); });
    expect(container.querySelector('[data-connector-credential-status="cred_saved"]')?.textContent).toBe("可用");
    expect(refresh.disabled).toBe(false);
    await act(async () => { refresh.click(); });
    expect(mocked.credentials).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("元数据服务不可用");
    expect(container.querySelector('[data-connector-credential-status="cred_saved"]')?.textContent).toBe("状态未确认");
  });

  it("does not present an unread saved configuration as an empty binding list", async () => {
    await render({ config: null, configVersion: null, configLoaded: false });
    expect(mocked.credentials).not.toHaveBeenCalled();
    expect(container.querySelector("[data-connector-credential-references]")).toBeNull();
    expect(container.textContent).toContain("无法确认是否存在绑定");
    expect(container.textContent).not.toContain("当前没有绑定凭据引用");
  });

  it("moves binding changes into the clear action row", async () => {
    await render();
    expect(container.textContent).toContain("全局凭据可能被其他连接器共用");
    await act(async () => { container.querySelector<HTMLButtonElement>("[data-connector-credential-edit]")!.click(); });
    expect(editBinding).toHaveBeenCalledOnce();
  });

  it("keeps the global warning in the drawer and refreshes metadata when it closes", async () => {
    await render();
    await act(async () => { container.querySelector<HTMLButtonElement>("[data-connector-global-vault-open]")!.click(); });
    expect(container.querySelector("[data-connector-global-vault-warning]")?.textContent).toContain("其他引用方");
    expect(container.querySelector("[data-test-vault]")).not.toBeNull();
    await act(async () => { container.querySelector<HTMLButtonElement>("[role=dialog] button")!.click(); });
    expect(mocked.credentials).toHaveBeenCalledTimes(2);
  });
});
