// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('./kolSurfaceApi', () => ({ loadHomeFollowing: mocks.load, releaseFollowedKol: vi.fn() }));
vi.mock('../components/ChatBlocks', () => ({ storePending: vi.fn() }));
import { useFollowedWorkspace } from './useFollowedWorkspace';
import FollowedInteraction from './FollowedInteraction';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => mocks.load.mockReset());
it('failed overview has no contradictory still-loading title or final zero count', () => {
  const html = renderToStaticMarkup(<FollowedInteraction cards={[]} completeness="incomplete-error" stageFilter="" situation=""
    onStageFilter={() => {}} onSituation={() => {}} onPrimary={() => {}} publicPoolNewCount={null} onOpenPublicPoolNew={() => {}} />);
  expect(html).toContain('名单核对未完成');
  expect(html).not.toContain('正在核对服务端授权名单');
  expect(html).not.toContain('目前跟进了 0 位');
});
it('unexpected read rejection reaches terminal failure and explicit retry can complete', async () => {
  const div = document.createElement('div');
  const root = createRoot(div);
  let current: ReturnType<typeof useFollowedWorkspace>;
  const latestFollowScope = {current:null};
  const setFollowScope = vi.fn();
  function Harness() {
    current = useFollowedWorkspace({loadBoard:async()=>true, boardKols:()=>[], followScope:null, latestFollowScope, setFollowScope,
      selectedIds:[],todoItems:[],openTask:async()=>{},onFillComposer:()=>{},navigate:()=>{},onError:()=>{},onReleased:async()=>{}});
    return <span>{current.completeness}</span>;
  }
  try {
    await act(async()=>{root.render(<Harness/>);});
    mocks.load.mockRejectedValueOnce(new Error('unexpected read failure'));
    await act(async()=>{await current!.ensureLoaded();});
    expect(current!.completeness).toBe('incomplete-error');
    expect(current!.loading).toBe(false);
    expect(current!.error).toBe('unexpected read failure');
    mocks.load.mockResolvedValueOnce({items:[],follow_scope:null});
    await act(async()=>{await current!.loadSurface();});
    expect(current!.completeness).toBe('complete');
    expect(current!.error).toBe('');
  } finally {await act(async()=>root.unmount());}
});

it('caller entry effect registered before the hook survives scope reset on mount and actor change', async () => {
  const div = document.createElement('div');
  const root = createRoot(div);
  let current: ReturnType<typeof useFollowedWorkspace>;
  const ref = { current: null as ReturnType<typeof useFollowedWorkspace> | null };
  const latestFollowScope = { current: null };
  const setFollowScope = vi.fn();
  mocks.load.mockResolvedValue({ items: [], follow_scope: null });
  function Harness({ actor }: { actor: string }) {
    // Deliberately reproduce Home.tsx: entry effect is declared before the hook.
    React.useEffect(() => { void ref.current!.ensureLoaded(); }, [actor]);
    current = useFollowedWorkspace({ readScopeKey: actor, loadBoard: async () => true, boardKols: () => [],
      followScope: null, latestFollowScope, setFollowScope, selectedIds: [], todoItems: [],
      openTask: async () => {}, onFillComposer: () => {}, navigate: () => {}, onError: () => {}, onReleased: async () => {} });
    ref.current = current;
    return <span>{current.completeness}</span>;
  }
  try {
    await act(async () => { root.render(<Harness actor="actor-a" />); });
    expect(current!.completeness).toBe('complete');
    expect(current!.loading).toBe(false);
    expect(mocks.load).toHaveBeenCalledTimes(1);
    await act(async () => { root.render(<Harness actor="actor-b" />); });
    expect(current!.completeness).toBe('complete');
    expect(current!.loading).toBe(false);
    expect(mocks.load).toHaveBeenCalledTimes(2);
  } finally { await act(async () => root.unmount()); }
});

it.each([
  ['resolved', false], ['rejected', false], ['resolved', true], ['rejected', true],
] as const)('stale %s read reloads only a not-started current scope (current started: %s)', async (outcome, startCurrent) => {
  const root = createRoot(document.createElement('div'));
  let current: ReturnType<typeof useFollowedWorkspace>;
  let finishOld!: (value: unknown) => void;
  let rejectOld!: (reason: Error) => void;
  const oldRead = new Promise((resolve, reject) => { finishOld = resolve; rejectOld = reject; });
  const latestFollowScope = { current: null };
  const setFollowScope = vi.fn();
  mocks.load.mockReturnValueOnce(oldRead).mockResolvedValue({ items: [], follow_scope: null });
  function Harness({ actor }: { actor: string }) {
    current = useFollowedWorkspace({ readScopeKey: actor, loadBoard: async () => true, boardKols: () => [],
      followScope: null, latestFollowScope, setFollowScope, selectedIds: [], todoItems: [],
      openTask: async () => {}, onFillComposer: () => {}, navigate: () => {}, onError: () => {}, onReleased: async () => {} });
    return <span>{current.completeness}</span>;
  }
  let pending!: Promise<void>;
  try {
    await act(async () => { root.render(<Harness actor={`old-${outcome}-${startCurrent}`} />); });
    await act(async () => { pending = current!.ensureLoaded(); });
    await act(async () => { root.render(<Harness actor={`new-${outcome}-${startCurrent}`} />); });
    if (startCurrent) await act(async () => { await current!.ensureLoaded(); });
    await act(async () => {
      if (outcome === 'resolved') finishOld({ items: [{ uid: 'private-old' }], follow_scope: { private: 'old-scope' } });
      else rejectOld(new Error('denied old actor'));
      await pending;
    });
    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(current!.completeness).toBe('complete');
    expect(current!.loading).toBe(false);
    expect(current!.rows).toEqual([]);
    expect(current!.error).toBe('');
    expect(setFollowScope).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); }
});
