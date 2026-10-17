// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type RuntimeActionView } from "../api";
import { RuntimeActions } from "./RuntimeActions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

function stopAction(state: "pending" | "succeeded"): RuntimeActionView {
  return {
    id: "saved-stop",
    skill_id: "crawler_collect",
    operation: "stop_crawl",
    arguments: { task_id: "saved-remote" },
    state,
    risk: "L3",
    confirmation_version: "stop-snapshot",
    blocked_reason: null,
    receipt: state === "succeeded" ? { task_id: "saved-remote" } : null,
    error_code: null,
  };
}

function mount(node: React.ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(node));
  return host;
}

function unmount() {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
}

afterEach(() => {
  vi.restoreAllMocks();
  unmount();
});

describe("RuntimeActions restored stop receipt", () => {
  it("accepts a late controlled R3 stop action and rehydrates its saved receipt after remount", async () => {
    let publishActions!: (actions: RuntimeActionView[]) => void;
    let current = stopAction("pending");
    const confirm = vi.spyOn(api, "confirmRuntimeAction").mockImplementation(async () => {
      current = stopAction("succeeded");
      return { job: { id: "stop-fixture" } } as never;
    });
    vi.spyOn(api, "runtimeActions").mockImplementation(async () => ({ actions: [current] }));

    function ControlledRestore() {
      const [actions, setActions] = useState<RuntimeActionView[]>([]);
      publishActions = setActions;
      return <RuntimeActions sessionId="ses-restored" actions={actions} onChange={setActions} />;
    }

    const container = mount(<ControlledRestore />);
    expect(container.querySelector('[data-runtime-action="saved-stop"]')).toBeNull();

    await act(async () => {
      publishActions([current]);
    });
    const stop = () => container.querySelector<HTMLElement>('[data-runtime-action="saved-stop"]');
    expect(stop()?.textContent).toContain("需要确认（R3）");
    expect(stop()?.textContent).toContain("saved-remote");
    expect(confirm).not.toHaveBeenCalled();

    await act(async () => {
      stop()?.querySelector<HTMLButtonElement>("button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith("saved-stop", "stop-snapshot");
    expect(stop()?.textContent).toContain("停止请求已提交");
    expect(stop()?.querySelector("button")).toBeNull();

    unmount();
    const restored = mount(<RuntimeActions sessionId="ses-restored" actions={[current]} />);
    const restoredStop = restored.querySelector('[data-runtime-action="saved-stop"]');
    expect(restoredStop?.textContent).toContain("停止请求已提交");
    expect(restoredStop?.textContent).toContain("查看操作记录");
    expect(confirm).toHaveBeenCalledTimes(1);
  });
});
