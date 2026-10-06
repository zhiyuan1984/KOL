import {describe,it,expect} from 'vitest';
import {mergeScopes,scopeHash,validateScope} from '../src/knowledge/scope-contract.js';
import type {ScopeEvidence} from '../../shared/knowledge-scope.js';
const evidence:ScopeEvidence[]=[{id:'p1',document_id:'v1',original_pages:[5],text:'A 型号，参数与测试条件'}];
const coverage={status:'partial' as const,unreadable_pages:[6],catalog_completeness:'unknown' as const};
const value={summary:'规格资料',entities:[{name:'A',evidence_ids:['p1']}],topics:[{label:'条件',evidence_ids:['p1']}],question_types:['overview','conditions'],limitations:['仅覆盖资料'],unverified_notes:['上传解释中提到的完整目录尚无依据']};
describe('knowledge scope trust boundary',()=>{
  it('retains server original page evidence and quality despite forged model metadata',()=>{
    const scope=validateScope({...value,evidence:[{id:'p1',original_pages:[99]}],coverage:{status:'complete'}},evidence,coverage);
    expect(scope.evidence[0].original_pages).toEqual([5]);expect(scope.coverage.status).toBe('partial');
    expect(()=>validateScope({...value,topics:[{label:'不存在的事实',evidence_ids:['invented']}]},evidence,coverage)).toThrow('原文证据');
  });
  it('merges repeated themes without losing later evidence or missing pages',()=>{
    const first=validateScope(value,evidence,coverage),second=validateScope({...value,topics:[{label:'条件',evidence_ids:['p2']}],entities:[]},[{id:'p2',document_id:'v1',original_pages:[7],text:'第二页条件'}],{...coverage,unreadable_pages:[8]});
    const merged=mergeScopes([first,second]);expect(merged.topics).toEqual([{label:'条件',evidence_ids:['p1','p2']}]);expect(merged.coverage.unreadable_pages).toEqual([6,8]);expect(merged.coverage.catalog_completeness).toBe('unknown');
  });
  it('uses a stable fingerprint across JSONB key reordering',()=>{expect(scopeHash({a:1,b:{d:2,c:3}})).toBe(scopeHash({b:{c:3,d:2},a:1}));});
});
