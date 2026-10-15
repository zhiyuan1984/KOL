import { createHash } from 'node:crypto';
import type { KnowledgeScope, ScopeEvidence } from '../../../shared/knowledge-scope.js';
const canonical=(value:unknown):string=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value && typeof value==='object'?`{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`:JSON.stringify(value) ?? 'null';
export const scopeHash = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex');
// Batch and full-document scopes share a contract, but not a fixed 80-item capacity.
// Capacity derives only from server-owned source evidence; never truncate supported rows.
const scopeItemLimit = (evidence: ScopeEvidence[]) => Math.max(80, Math.min(2000, evidence.length * 8));
const strings = (value: unknown, limit = 80): string[] => {
  if (!Array.isArray(value) || value.length > limit || value.some(v => typeof v !== 'string' || !v.trim() || v.length > 1000)) throw new Error('知识范围列表格式无效');
  return [...new Set(value.map(v => String(v).trim()))];
};
export function validateScope(value: unknown, evidence: ScopeEvidence[], coverage: KnowledgeScope['coverage']): KnowledgeScope {
  if (!value || typeof value !== 'object') throw new Error('知识范围格式无效');
  const row = value as Record<string, unknown>;
  if (typeof row.summary !== 'string' || !row.summary.trim() || row.summary.length > 2000) throw new Error('知识范围摘要必须有内容，最多 2000 字');
  const ids = new Set(evidence.map(e => e.id));
  const itemLimit = scopeItemLimit(evidence);
  function supported(key: 'entities' | 'topics', label: 'name' | 'label') {
    if (!Array.isArray(row[key]) || row[key].length > itemLimit) throw new Error('知识范围主题过多或格式无效');
    return (row[key] as Record<string, unknown>[]).map(item => {
      if (!item || typeof item[label] !== 'string' || !String(item[label]).trim() || String(item[label]).length > 200) throw new Error('请输入有效的主题或对象');
      const refs = strings(item.evidence_ids, Math.max(80, ids.size));
      if (!refs.length || refs.some(id => !ids.has(id))) throw new Error('每项主题和对象必须关联当前原文证据');
      return { [label]: String(item[label]).trim(), evidence_ids: refs };
    });
  }
  const types = strings(row.question_types);
  if (types.some(t => !['overview','parameter_lookup','conditions','usage','comparison'].includes(t))) throw new Error('知识问题类别无效');
  const entities = supported('entities','name') as KnowledgeScope['entities'];
  const topics = supported('topics','label') as KnowledgeScope['topics'];
  if (!topics.length && !entities.length) throw new Error('原文没有支持的知识范围，不能声明问答能力');
  return {schema_version:1,summary:row.summary.trim(),entities,topics,question_types:types,
    limitations:strings(row.limitations,itemLimit),unverified_notes:strings(row.unverified_notes,itemLimit),evidence,coverage};
}
export function mergeScopes(scopes: KnowledgeScope[]): KnowledgeScope {
  const merge=(items:{evidence_ids:string[];[key:string]:unknown}[],label:string)=>{
    const rows=new Map<string,{evidence_ids:string[];[key:string]:unknown}>();
    for(const item of items){const key=String(item[label]);const previous=rows.get(key);rows.set(key,{...item,evidence_ids:[...new Set([...(previous?.evidence_ids || []),...item.evidence_ids])]});}
    return [...rows.values()];
  };
  const evidence=scopes.flatMap(s=>s.evidence);
  const coverage:KnowledgeScope['coverage']={status:scopes.some(s=>s.coverage.status==='partial')?'partial':'complete',unreadable_pages:[...new Set(scopes.flatMap(s=>s.coverage.unreadable_pages))],catalog_completeness:'unknown'};
  return validateScope({schema_version:1,summary:scopes.map(s=>s.summary).join('；').slice(0,2000),entities:merge(scopes.flatMap(s=>s.entities),'name'),topics:merge(scopes.flatMap(s=>s.topics),'label'),
    question_types:[...new Set(scopes.flatMap(s=>s.question_types))],limitations:[...new Set(scopes.flatMap(s=>s.limitations))],
    unverified_notes:[...new Set(scopes.flatMap(s=>s.unverified_notes))]},evidence,coverage);
}
/** Keep all source chunks, bounded by both page count and prompt text size. */
export function scopeEvidenceBatches(evidence: ScopeEvidence[]): ScopeEvidence[][] {
  const batches:ScopeEvidence[][]=[];
  let batch:ScopeEvidence[]=[],length=0;
  for(const item of evidence){
    if(batch.length && (batch.length>=12 || length+item.text.length>48000)){batches.push(batch);batch=[];length=0;}
    batch.push(item);length+=item.text.length;
  }
  if(batch.length)batches.push(batch);
  return batches;
}
export function scopeDescription(scope: KnowledgeScope): string {
  return JSON.stringify({summary:scope.summary,entities:scope.entities.map(e=>e.name),topics:scope.topics.map(t=>t.label),question_types:scope.question_types,
    limitations:scope.limitations,catalog_completeness:'unknown'});
}
