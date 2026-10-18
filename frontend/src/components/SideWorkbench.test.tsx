// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "../api";

vi.mock("./ChatBlocks", () => ({
  KolMailWorkbench: ({ onReviewStage }: { onReviewStage?: () => void }) => (
    <button type="button" data-mail-review-stage onClick={onReviewStage}>核对阶段变更</button>
  ),
  taskResultCardsFrom: () => [],
  employeeTraceLabel: (text: string) => text,
}));
vi.mock("../home/WorkspaceShell", () => ({ revealWorkspace: vi.fn() }));

import SideWorkbench from "./SideWorkbench";

let root: Root | undefined;
let host: HTMLDivElement | undefined;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sessionId = "ses_stage_review";
const stageId = "msg_stage_interest";
const storageKey = `ui:stage-review:${sessionId}:${stageId}`;

function message(id: string, kind: string, payload: Record<string, unknown> = {}): Message {
  return { id, session_id: sessionId, role: kind === "me" ? "user" : "assistant", kind, payload, created_at: "2026-10-16T00:00:00.000Z" };
}

function stageMessages(id = stageId): Message[] {
  return [
    message("mail_interest", "kol_mail_card", { direction: "inbound", subject: "有兴趣" }),
    message("employee_request", "me", { text: "提出阶段变更" }),
    message(id, "confirm_stage_card", { proposed_stage: "INTERESTED" }),
  ];
}

function workbench(ready = true, messages = stageMessages()) {
  return <SideWorkbench
    sessionId={sessionId}
    messages={messages}
    status="idle"
    ready={ready}
    renderArtifact={() => <button type="button" data-confirm-stage>确认写入正式阶段</button>}
  />;
}

function draftMessages(): Message[] {
  return [message("mail_draft", "email_card", { draft_id: "drf_reviewed", status: "draft", subject: "Employee reviewed partnership subject" })];
}

function draftWorkbench(messages = draftMessages()) {
  return <div className="scope-task-rail-scroll"><SideWorkbench
    embedded
    sessionId={sessionId}
    messages={messages}
    status="idle"
    renderArtifact={(row) => row.kind === "email_card" ? (
      <article data-kind="email-card" data-card-id="drf_reviewed">
        <button type="button" data-email-action="send">确认发送</button>
      </article>
    ) : undefined}
  /></div>;
}

function mount(node: React.ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(node));
  return host;
}

function rerender(node: React.ReactNode) {
  act(() => root?.render(node));
}

function review(container: HTMLElement) {
  const element = container.querySelector<HTMLDetailsElement>(".mail-stage-review");
  expect(element).not.toBeNull();
  return element!;
}

function clickSummary(container: HTMLElement) {
  const summary = container.querySelector<HTMLElement>("summary[data-stage-review-summary]");
  expect(summary).not.toBeNull();
  act(() => {
    summary?.click();
    // Chromium emits the native details `toggle` after the summary activation.
    // jsdom does not reliably flush that queued event inside `click()`, so model
    // the settled browser event explicitly instead of relying on click-time state.
    container.querySelector<HTMLDetailsElement>(".mail-stage-review")?.dispatchEvent(new Event("toggle"));
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => {} });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  vi.unstubAllGlobals();
});

describe("SideWorkbench stage review", () => {
  it("opens a newly requested R3 stage card once it is ready and records that default", () => {
    const container = mount(workbench());
    const details = review(container);

    expect(details.dataset.stageReviewInitialized).toBe("true");
    expect(details.open).toBe(true);
    expect(sessionStorage.getItem(storageKey)).toBe("true");
  });

  it("keeps an explicit close across a same-ID props refresh instead of replaying the automatic default", () => {
    const container = mount(workbench());
    clickSummary(container);
    expect(review(container).open).toBe(false);
    expect(sessionStorage.getItem(storageKey)).toBe("false");

    rerender(workbench(true, [...stageMessages()]));

    expect(review(container).dataset.stageReviewInitialized).toBe("true");
    expect(review(container).open).toBe(false);
  });

  it("treats an early explicit open as authoritative when readiness arrives later and restores saved state on a fresh mount", () => {
    const container = mount(workbench(false));
    expect(review(container).dataset.stageReviewInitialized).toBe("false");
    clickSummary(container);
    expect(review(container).open).toBe(true);
    expect(sessionStorage.getItem(storageKey)).toBe("true");

    rerender(workbench(true, [...stageMessages()]));
    expect(review(container).dataset.stageReviewInitialized).toBe("true");
    expect(review(container).open).toBe(true);

    act(() => root?.unmount());
    root = createRoot(host!);
    act(() => root?.render(workbench()));
    expect(review(container).open).toBe(true);
  });

  it("persists the settled native details toggle without cancelling summary activation", () => {
    const container = mount(workbench(false));
    const details = review(container);
    const summary = container.querySelector<HTMLElement>("summary[data-stage-review-summary]");
    expect(summary).not.toBeNull();

    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => summary?.dispatchEvent(click));
    expect(click.defaultPrevented).toBe(false);

    act(() => {
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
    expect(details.dataset.stageReviewInitialized).toBe("true");
    expect(sessionStorage.getItem(storageKey)).toBe("true");

    act(() => {
      details.open = false;
      details.dispatchEvent(new Event("toggle"));
    });
    expect(sessionStorage.getItem(storageKey)).toBe("false");
  });

  it("does not reuse a prior card's open ref when a new stage is clicked before its own initialization", () => {
    const container = mount(workbench());
    expect(review(container).open).toBe(true);

    const nextStageId = "msg_stage_next";
    rerender(workbench(false, stageMessages(nextStageId)));
    expect(review(container).dataset.stageReviewInitialized).toBe("false");
    expect(review(container).open).toBe(false);

    clickSummary(container);

    expect(review(container).open).toBe(true);
    expect(sessionStorage.getItem(`ui:stage-review:${sessionId}:${nextStageId}`)).toBe("true");
  });

  it.each([true, false])("restores the prior card's own saved %s state when revisiting it", (open) => {
    const container = mount(workbench());
    if (!open) clickSummary(container);
    expect(review(container).open).toBe(open);

    rerender(workbench(true, stageMessages("msg_other_stage")));
    expect(review(container).dataset.stageReviewInitialized).toBe("true");
    expect(review(container).open).toBe(true);

    rerender(workbench(true, stageMessages(stageId)));
    expect(review(container).dataset.stageReviewInitialized).toBe("true");
    expect(review(container).open).toBe(open);
    expect(sessionStorage.getItem(storageKey)).toBe(String(open));
  });

  it("reveals a newly authored draft's actual send action once without replaying it on a same-card refresh", () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    const container = mount(draftWorkbench());

    const action = container.querySelector<HTMLElement>('[data-email-action="send"]');
    expect(action).not.toBeNull();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest", behavior: "auto" });

    rerender(draftWorkbench([...draftMessages()]));

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("retries an uncommitted draft reveal after its frame was cancelled by a state transition", () => {
    const frames = new Map<number, FrameRequestCallback>();
    let next = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++next, callback); return next; });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    mount(draftWorkbench());
    rerender(draftWorkbench([message("mail_draft", "email_card", { draft_id: "drf_reviewed", status: "draft", send_disabled: true })]));
    expect(frames.size).toBe(0);
    rerender(draftWorkbench());
    expect(frames.size).toBe(1);
    act(() => { for (const callback of frames.values()) callback(0); frames.clear(); });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("does not reveal the draft after the employee starts scrolling its result rail", () => {
    const frames = new Map<number, FrameRequestCallback>();
    let next = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++next, callback); return next; });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    const container = mount(draftWorkbench());
    act(() => container.querySelector(".scope-task-rail-scroll")?.dispatchEvent(new Event("wheel")));
    expect(frames.size).toBe(0);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
