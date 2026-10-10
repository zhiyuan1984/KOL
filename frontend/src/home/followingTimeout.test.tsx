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
  const html = renderToStaticMarkup(<FollowedInteraction cards={[]} completeness="incomplete-error" stageFilter="" situation="" selectedCount={0}
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
