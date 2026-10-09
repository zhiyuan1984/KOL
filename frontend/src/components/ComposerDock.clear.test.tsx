import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillTemplate } from "../api";
import type { ComposerDraftStash } from "../composer/draft";
import ComposerDock from "./ComposerDock";

let root: Root | undefined;
let host: HTMLDivElement | undefined;

// React 19 uses this flag to validate that the explicit `act` calls below wrap
// every component update in the jsdom environment.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const template = {
  id: "template:review",
  kind: "skill_template",
  skill_id: "template-skill",
  version: "v1",
  title: "审核模板",
  description: "未提交模板",
  steps: [],
  inputs: [],
  starter: "审核",
  output: { type: "task_result", title: "审核结果" },
  constraints: [],
  evidence: [],
  decisions: [],
  recovery: [],
  source: "skill",
  read_only: true,
} as SkillTemplate;

function mount(node: React.ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(node));
  return host;
}

function ControlledComposer({
  initialValue = "",
  onSubmit = () => {},
  ...props
}: Omit<React.ComponentProps<typeof ComposerDock>, "value" | "onChange"> & { initialValue?: string }) {
  const [value, setValue] = useState(initialValue);
  return (
    <MemoryRouter>
      <ComposerDock value={value} onChange={setValue} onSubmit={onSubmit} {...props} />
    </MemoryRouter>
  );
}

function click(container: HTMLElement, selector: string) {
  const element = container.querySelector<HTMLElement>(selector);
  expect(element, `missing ${selector}`).not.toBeNull();
  act(() => element?.click());
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  vi.unstubAllGlobals();
});

describe("ComposerDock draft clear", () => {
  it("keeps the persistent clear control disabled for an empty draft", () => {
    const container = mount(<ControlledComposer />);
    const clear = container.querySelector<HTMLButtonElement>("[data-composer-clear-draft]");
    expect(clear?.disabled).toBe(true);
  });

  it("clears ordinary text and restores editor focus", () => {
    const onClearDraft = vi.fn();
    const container = mount(<ControlledComposer initialValue="整理本周达人回复" onClearDraft={onClearDraft} />);
    const input = container.querySelector<HTMLTextAreaElement>("[data-composer-input]")!;
    expect(input.value).toBe("整理本周达人回复");

    click(container, "[data-composer-clear-draft]");

    expect(input.value).toBe("");
    expect(onClearDraft).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(input);
    expect(container.querySelector<HTMLButtonElement>("[data-composer-clear-draft]")?.disabled).toBe(true);
  });

  it("clears draft-only structural state and routes lock cleanup to the owning page", async () => {
    const onKnowledgeChange = vi.fn();
    const onSkillTemplateChange = vi.fn();
    const onSkillRemoved = vi.fn();
    const onObjectRefsChange = vi.fn();
    const onClearDiscoveryLock = vi.fn();
    const onClearDraft = vi.fn();
    const draft: ComposerDraftStash = {
      text: "待发送的草稿",
      attachments: [{ id: "attachment-1", name: "brief.pdf", path: "/tmp/brief.pdf" }],
      chips: [
        { kind: "skill", id: "review", label: "审核" },
        { kind: "kb", id: "kb-1", label: "资料库" },
        { kind: "connector", id: "connector-1", label: "邮件连接器" },
        { kind: "project", id: "project-1", label: "春季合作" },
      ],
      skill_template: template,
    };
    const container = mount(
      <ControlledComposer
        initialDraft={draft}
        entryIntent="discover"
        lockedIntent="locked-skill"
        lockedKnowledgeId="locked-kb"
        objectRefs={[{ kind: "kol", id: "kol-1", label: "小美" }]}
        onKnowledgeChange={onKnowledgeChange}
        onSkillTemplateChange={onSkillTemplateChange}
        onSkillRemoved={onSkillRemoved}
        onObjectRefsChange={onObjectRefsChange}
        onClearDiscoveryLock={onClearDiscoveryLock}
        onClearDraft={onClearDraft}
      />,
    );
    await settle();
    expect(container.querySelectorAll("[data-composer-chip]")).not.toHaveLength(0);

    click(container, "[data-composer-clear-draft]");

    expect(container.querySelector("[data-composer-chip]")).toBeNull();
    expect(container.querySelector<HTMLButtonElement>("[data-composer-clear-draft]")?.disabled).toBe(true);
    expect(onObjectRefsChange).toHaveBeenCalledWith([]);
    expect(onKnowledgeChange).toHaveBeenLastCalledWith(null);
    expect(onSkillTemplateChange).toHaveBeenLastCalledWith(null, null);
    expect(onSkillRemoved.mock.calls.map(([skillId]) => skillId)).toEqual(expect.arrayContaining(["review", "template-skill", "locked-skill"]));
    expect(onClearDiscoveryLock).toHaveBeenCalledOnce();
    expect(onClearDraft).toHaveBeenCalledOnce();
  });

  it("clears a draft while a submitted run remains active and never stops that run", () => {
    const onStop = vi.fn();
    const container = mount(<ControlledComposer initialValue="下一条草稿" running onStop={onStop} />);
    const clear = container.querySelector<HTMLButtonElement>("[data-composer-clear-draft]");
    expect(clear?.disabled).toBe(false);

    click(container, "[data-composer-clear-draft]");

    expect(container.querySelector<HTMLTextAreaElement>("[data-composer-input]")?.value).toBe("");
    expect(onStop).not.toHaveBeenCalled();
    expect(container.querySelector("[data-stop-run]")).not.toBeNull();
  });

  it("submits the next ordinary question without the cleared intent, attachments, skills or object references", () => {
    const onSubmit = vi.fn();
    const container = mount(<ControlledComposer initialValue="旧的发现草稿" entryIntent="discover" lockedIntent="discover"
      initialDraft={{ text: "旧的发现草稿", attachments: [{ id: "old", name: "old.pdf", path: "/tmp/old.pdf" }], chips: [{ kind: "skill", id: "old-skill", label: "旧技能" }] }}
      objectRefs={[{ kind: "kol", id: "old-kol", label: "旧对象" }]} onSubmit={onSubmit} />);
    click(container, '[data-composer-clear-draft]');
    const input = container.querySelector<HTMLTextAreaElement>('[data-composer-input]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    act(() => { setter.call(input, '新的普通问题'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    click(container, '[data-ai-prompt-submit]');
    expect(onSubmit).toHaveBeenCalledOnce();
    const submitted = onSubmit.mock.calls[0][0];
    expect(submitted.text).toBe('新的普通问题');
    expect(submitted.intent).toBeUndefined();
    expect(submitted.attachments).toBeUndefined();
    expect(submitted.object_refs).toEqual([]);
    expect(submitted.scope).toMatchObject({ intent: 'free', skills: [], knowledge_bases: [], connectors: [] });
  });

  it("does not reattach a late upload after clear", async () => {
    let resolveUpload: ((value: { ok: boolean; json: () => Promise<unknown> }) => void) | undefined;
    vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => { resolveUpload = resolve; })));
    const container = mount(<ControlledComposer initialValue="上传中的草稿" />);
    const input = container.querySelector<HTMLInputElement>("[data-attach-input]")!;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["brief"], "brief.txt", { type: "text/plain" })],
    });
    act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(container.querySelector("[data-composer-clear-draft]")).not.toBeNull();

    click(container, "[data-composer-clear-draft]");
    await act(async () => {
      resolveUpload?.({
        ok: true,
        json: async () => ({ id: "late", name: "brief.txt", path: "/uploads/brief.txt", size: 5, type: "text/plain" }),
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector("[data-composer-chip=attachment]")).toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>("[data-composer-input]")?.value).toBe("");
  });
});
