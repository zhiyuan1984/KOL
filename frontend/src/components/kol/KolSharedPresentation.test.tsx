import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import KolAvatar from "./KolAvatar";
import KolAction from "./KolCardActions";
import { KolCardSelection, KolCardShell, KolCardSummary } from "./KolCardShell";

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
async function render(node: ReactNode) { await act(async () => root.render(node)); }
async function click(selector: string) { await act(async () => (host.querySelector(selector) as HTMLElement).click()); }

describe("shared KOL presentation", () => {
  it("uses the same square Avatar with a real image and Unicode fallback", async () => {
    await render(<KolAvatar name="@山野" src="https://example.test/a.png" identityKey="a" />);
    expect(host.querySelector("[data-kol-avatar='source'] img")?.getAttribute("src")).toBe("https://example.test/a.png");
    expect(host.querySelector("img")?.getAttribute("referrerpolicy")).toBe("no-referrer");
    await render(<KolAvatar name="@山野" identityKey="a" />);
    expect(host.querySelector("[data-kol-avatar='fallback']")?.textContent).toBe("山");
    expect(host.querySelector("img")).toBeNull();
  });
  it("recovers a failed image when its URL or object identity changes", async () => {
    await render(<KolAvatar name="@山野" src="https://example.test/a.png" identityKey="a" />);
    await act(async () => host.querySelector("img")!.dispatchEvent(new Event("error")));
    expect(host.querySelector("[data-kol-avatar='fallback']")).not.toBeNull();
    await render(<KolAvatar name="@山野" src="https://example.test/b.png" identityKey="a" />);
    expect(host.querySelector("[data-kol-avatar='source'] img")?.getAttribute("src")).toBe("https://example.test/b.png");
    await act(async () => host.querySelector("img")!.dispatchEvent(new Event("error")));
    await render(<KolAvatar name="@山野" src="https://example.test/b.png" identityKey="b" />);
    expect(host.querySelector("[data-kol-avatar='source'] img")).not.toBeNull();
  });
  it("selection remains an accessible controlled checkbox and delegates only its callback", async () => {
    const onChange = vi.fn();
    await render(<KolCardSelection aria-label="选择 山野" checked={false} onChange={onChange} />);
    expect(host.querySelector("input")?.getAttribute("aria-label")).toBe("选择 山野");
    await click("input");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].target.checked).toBe(true);
  });
  it("a text action is a real type=button and respects disabled/busy", async () => {
    const onClick = vi.fn();
    await render(<KolAction onClick={onClick}>领取跟进</KolAction>);
    expect(host.querySelector("button")?.type).toBe("button");
    expect(host.querySelector("button")?.className).toContain("ant-btn-text");
    await click("button"); expect(onClick).toHaveBeenCalledTimes(1);
    await render(<KolAction disabled onClick={onClick}>领取跟进</KolAction>);
    await click("button"); expect(onClick).toHaveBeenCalledTimes(1);
    await render(<KolAction loading onClick={onClick}>处理中</KolAction>);
    await click("button"); expect(onClick).toHaveBeenCalledTimes(1);
  });
  it("has semantic article variants and never emits legacy roots", async () => {
    for (const variant of ["followed", "pool", "discovery"] as const) {
      await render(<KolCardShell variant={variant} data-kol-work-card>内容</KolCardShell>);
      expect(host.querySelector("article")?.getAttribute("data-kol-unified")).toBe(variant);
      expect(host.querySelector(".followed-kol-card, .pool-kol-row, .discovery-runtime-candidate")).toBeNull();
    }
  });
  it("clamped summaries have an explicit full-text and collapse action", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains("kol-card-summary-text") ? 80 : 0; });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains("kol-card-summary-text") ? 40 : 0; });
    await render(<KolCardSummary label="邮件摘要" text="全部业务事实在此，不能因紧凑样式丢失。" />);
    expect(host.querySelector("button")?.textContent).toBe("展开全文");
    await click("button");
    expect(host.querySelector(".kol-card-summary-text")?.getAttribute("data-expanded")).toBe("true");
    expect(host.querySelector("button")?.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector("button")?.textContent).toBe("收起全文");
    await click("button"); expect(host.querySelector(".kol-card-summary-text")?.hasAttribute("data-expanded")).toBe(false);
  });
});
