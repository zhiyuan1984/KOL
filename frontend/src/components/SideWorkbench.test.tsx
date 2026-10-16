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
  act(() => summary?.click());
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
});
