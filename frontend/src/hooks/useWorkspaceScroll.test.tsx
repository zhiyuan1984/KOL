// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceScroll } from './useWorkspaceScroll';

let root: Root;
let host: HTMLDivElement;
let element: HTMLDivElement;
let content: HTMLDivElement;
let controller: ReturnType<typeof useWorkspaceScroll>;
let top = 0;
let height = 1000;
let requested: number[] = [];

function Harness() {
  controller = useWorkspaceScroll('scroll-regression:current-actor', true, false);
  return <div ref={node => {
    controller.ref.current = node;
    if (!node) return;
    element = node;
    Object.defineProperties(node, {
      scrollHeight: { configurable: true, get: () => height },
      clientHeight: { configurable: true, get: () => 300 },
      scrollTop: { configurable: true, get: () => top, set: (value: number) => { top = Math.max(0, Math.min(value, height - 300)); } },
    });
    node.scrollTo = ((options: ScrollToOptions) => { requested.push(Number(options.top)); }) as typeof node.scrollTo;
  }}><div ref={node => { if (node) content = node; }}>初始只读内容</div></div>;
}

beforeEach(async () => {
  top = 0; height = 1000; requested = [];
  sessionStorage.clear();
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host);
  root = createRoot(host);
  await act(async () => { root.render(<Harness />); });
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  sessionStorage.clear();
});

async function intermediateScroll() {
  await act(async () => {
    controller.jump(false);
    top = 200;
    element.dispatchEvent(new Event('scroll'));
  });
  expect(requested[0]).toBe(1000);
  expect(top).toBe(200);
}
async function lateContent() {
  await act(async () => {
    height = 1400;
    content.append(document.createTextNode('异步读取的真实后续内容'));
    await Promise.resolve();
  });
}

describe('Workspace latest jump respects explicit reading intent', () => {
  it('keeps following while smooth scroll emits intermediate positions and new content arrives', async () => {
    await intermediateScroll();
    await lateContent();
    expect(top).toBe(1100);
    expect(height - top - 300).toBe(0);
  });
  it('cancels a pending latest jump when the reader explicitly wheels to inspect history', async () => {
    await intermediateScroll();
    await act(async () => { element.dispatchEvent(new Event('wheel')); });
    await lateContent();
    expect(top).toBe(200);
    expect(controller.position.updated).toBe(true);
  });
  it('does not follow new content after an explicit jump to the top', async () => {
    await act(async () => { controller.jump(true); top = 0; element.dispatchEvent(new Event('scroll')); });
    expect(requested).toEqual([0]);
    await lateContent();
    expect(top).toBe(0);
    expect(controller.position.updated).toBe(true);
  });
});
