import { beforeEach, describe, expect, it } from 'vitest';
import { freshTestDatabase } from './support/pg.js';
import { postgresPool } from '../src/postgres/pool.js';
import { buildUnion, facetCounts, parseWorkspaceFilter, ROW_COLS, DOC_COLS, type NormFilter } from '../src/knowledge/workspace.js';
const filter=(input:Record<string,string>={})=>parseWorkspaceFilter(input) as NormFilter;
const base={ids:['fixture-owner'],tenant:'fixture-company'};
beforeEach(async()=>{
 await freshTestDatabase();
 const db=postgresPool();
 const now='2026-10-09T00:00:00Z';
 await db.query(`INSERT INTO knowledge_domains(id,code,name,level,status,created_at,updated_at) VALUES('facet-family','facet_family','Family','family','active',$1,$1)`,[now]);
 await db.query(`INSERT INTO knowledge_domains(id,code,name,level,parent_id,status,created_at,updated_at) VALUES('facet-domain','facet_domain','Domain','domain','facet-family','active',$1,$1)`,[now]);
 await db.query(`INSERT INTO knowledge_bases(id,code,name,domain_id,kind,status,created_at,updated_at)
 VALUES('facet-base','facet_base','Facet base','facet-domain','unstructured','active',$1,$1)`,[now]);
 await db.query(`INSERT INTO knowledge_documents(id,base_id,title,filename,media_type,mime,size_bytes,source_path,status,retry_count,artifacts,created_by,created_at,updated_at)
 VALUES('pdf-lt','facet-base','PDF LT','A.PDF','pdf','application/pdf',10,'fake','draft',0,$1,'fixture-owner',$3,$3),
 ('txt-pq','facet-base','TXT PQ','notes.txt','text','text/plain',10,'fake','draft',0,$2,'fixture-owner',$3,$3),
 ('generic','facet-base','Generic','all.pdf','pdf','application/pdf',10,'fake','draft',0,NULL,'fixture-owner',$3,$3)`,[
  JSON.stringify({applicability:{brands:['LT','TB','LT'],stages:['INITIAL_CONTACT','CONTENT_REVIEW','INITIAL_CONTACT']}}),
  JSON.stringify({applicability:{brands:['PQ'],stages:['CONTENT_REVIEW']}}),now]);
});
async function list(input:Record<string,string>){
 const union=buildUnion(base,filter(input),null,entry=>entry?ROW_COLS:DOC_COLS);
 return (await postgresPool().query(`SELECT * FROM (${union.sql}) u ORDER BY id`,union.params)).rows;
}
describe('file type + applicability facets on isolated PostgreSQL',()=>{
 it('filters actual filename suffix and supports generic matching metadata',async()=>{
  const rows=await list({file_type:'pdf',brands:'LT',stages:'INITIAL_CONTACT'});
  expect(rows.map(row=>row.id)).toEqual(['generic','pdf-lt']);
  expect(rows.map(row=>row.file_type)).toEqual(['pdf','pdf']);
  expect((await list({file_type:'txt',brands:'LT'}))).toHaveLength(0);
  expect((await list({file_type:'txt',brands:'PQ'})).map(row=>row.id)).toEqual(['txt-pq']);
  expect((await list({brands:'TB',stages:'CONTENT_REVIEW'})).map(row=>row.id)).toEqual(['generic','pdf-lt']);
 });
 it('counts multi-value documents once per option and skips both mutually exclusive type axes',async()=>{
  const facets=await facetCounts(postgresPool() as any,base,filter({file_type:'pdf'}));
  expect(facets.kind.values.document).toBe(3);
  expect(facets.file_type.values).toEqual({pdf:2,txt:1});
  expect(facets.brand).toEqual({all:2,values:{LT:1,TB:1},unbranded:1});
  expect(facets.stage).toEqual({all:2,values:{INITIAL_CONTACT:1,CONTENT_REVIEW:1},empty:1});
  const all=await facetCounts(postgresPool() as any,base,filter({kind:'document'}));
  expect(all.file_type.values).toEqual({pdf:2,txt:1});
  expect(all.brand.all).toBe(3);expect(all.brand.values.PQ).toBe(1);
 });
});
