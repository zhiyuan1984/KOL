import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AssetStatStrip from './AssetStatStrip';
import type { WsStats } from './shared';
const stats:WsStats={status:{draft:2,pending_review:1,published:4,archived:0,failed:3},pending_review:{count:1,max_wait_days:7},pending_documents:{count:0,max_wait_days:0},expiring:{count:0,nearest:null}};
const render=(props:Partial<Parameters<typeof AssetStatStrip>[0]>={})=>renderToStaticMarkup(<AssetStatStrip view="all" onView={()=>undefined} {...props}/>);
describe('knowledge asset strip',()=>{
 it('does not fabricate zero counts before global statistics load',()=>{
  const html=render();expect(html).toContain('正在加载资产分布');expect(html).not.toContain('data-kb-status=');
 });
 it('reports summary failure instead of showing cached or fabricated counts',()=>{
  const html=render({stats,error:'统计服务暂不可用',reload:()=>undefined});expect(html).toContain('role="alert"');expect(html).toContain('重试');expect(html).not.toContain('data-kb-status=');
 });
 it('uses lifecycle counts only and keeps zero states visible',()=>{
  const html=render({stats});expect((html.match(/data-kb-status=/g)||[]).length).toBe(4);expect(html).not.toContain('data-kb-status="failed"');expect(html).toContain('data-kb-status="archived"');expect(html).toContain('占比 29%');
 });
 it('shows only server-provided pending wait and pressed selection',()=>{
  const html=render({stats,view:'pending'});expect(html).toContain('最长等待');expect(html).toContain('7 天');expect(html).toContain('aria-pressed="true"');expect(html).toContain('取消「待审批」筛选');
 });
 it('keeps four real zero states without invented percentages',()=>{
  const html=render({stats:{...stats,status:{},pending_review:{count:0,max_wait_days:0}}});expect((html.match(/data-kb-status=/g)||[]).length).toBe(4);expect(html).not.toContain('占比');expect(html).not.toContain('最长等待');
 });
});
