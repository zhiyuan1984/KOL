import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PropertyList, RecordRow, ActionGroup } from './InformationLayout';

describe('shared information patterns', () => {
  it('preserves property semantics and differentiates missing from zero', () => {
    const html=renderToStaticMarkup(<PropertyList items={[{key:'count',label:'数量',value:0},{key:'missing',label:'手机号',value:null,emptyText:'未登记'}]} />);
    expect(html).toContain('<dt>数量</dt><dd>0</dd>');
    expect(html).toContain('<dt>手机号</dt><dd>未登记</dd>');
    expect(html).not.toContain('<input');
  });
  it('keeps status and actions independent and preserves failure detail', () => {
    const html=renderToStaticMarkup(<RecordRow data-record="test" title="发现任务" status="等待外部" actions={<ActionGroup><button>重试读取</button></ActionGroup>} detail="源服务未恢复，没有完成" />);
    expect(html).toContain('data-record="test"'); expect(html).toContain('ui-record-status');
    expect(html).toContain('源服务未恢复，没有完成'); expect(html).toContain('重试读取');
  });
});
