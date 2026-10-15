import {describe,it,expect} from 'vitest';
import {mergeScopes,scopeHash,validateScope,scopeEvidenceBatches} from '../src/knowledge/scope-contract.js';
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
  it('keeps all 134 distinct themes and all references to a repeated entity, and supports saving the merged result',()=>{
    const parts=Array.from({length:134},(_,i)=>{
      const page={id:`page-${i+1}`,document_id:'large',original_pages:[i+1],text:`原文主题 ${i+1}`};
      return validateScope({...value,topics:[{label:`主题 ${i+1}`,evidence_ids:[page.id]}],entities:[{name:'战略解码',evidence_ids:[page.id]}],limitations:[`范围边界 ${i+1}`]},[page],coverage);
    });
    const merged=mergeScopes(parts);
    expect(merged.topics).toHaveLength(134);expect(merged.entities).toHaveLength(1);
    expect(merged.entities[0].evidence_ids).toHaveLength(134);expect(merged.evidence).toHaveLength(134);
    expect(merged.limitations).toHaveLength(134);
    expect(validateScope(merged,merged.evidence,merged.coverage)).toEqual(merged);
    expect(()=>validateScope({...merged,topics:[{label:'伪造范围',evidence_ids:['unknown']}]},merged.evidence,merged.coverage)).toThrow('原文证据');
  });
  it('retains a bounded item count rather than removing validation for long documents',()=>{
    const topics=Array.from({length:81},(_,i)=>({label:`主题 ${i}`,evidence_ids:['p1']}));
    expect(()=>validateScope({...value,topics},evidence,coverage)).toThrow('主题过多');
  });
  it('batches all 134 pages in order without skipping any page',()=>{
    const pages=Array.from({length:134},(_,i)=>({id:`p${i}`,document_id:'v1',original_pages:[i+1],text:'原文'}));
    const batches=scopeEvidenceBatches(pages);
    expect(batches).toHaveLength(12);expect(batches.flat()).toEqual(pages);
    expect(batches.every(batch=>batch.length<=12)).toBe(true);
  });
  it('also caps long-page prompt text and retains every original chunk',()=>{
    const pages=Array.from({length:10},(_,i)=>({id:`p${i}`,document_id:'v1',original_pages:[i+1],text:'文'.repeat(16000)}));
    const batches=scopeEvidenceBatches(pages);
    expect(batches.map(batch=>batch.length)).toEqual([3,3,3,1]);expect(batches.flat()).toEqual(pages);
    expect(batches.every(batch=>batch.reduce((sum,page)=>sum+page.text.length,0)<=48000)).toBe(true);
    expect(scopeEvidenceBatches([])).toEqual([]);
  });
});
