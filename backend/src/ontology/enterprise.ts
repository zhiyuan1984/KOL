import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { OntologyDefinition, OntologyTaxonomy } from '../../../shared/ontology.js';
const file=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../config/ontology-enterprise-catalog.json');
export function enterpriseSource(){return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')) as {
 dataset:string;source:string;sourceSha256:string;families:{code:string;name:string;scope:string;detailStatus:string}[];
 objects:{code:string;id:string;name:string;family:string;domain:string;theme:string;existing:boolean;sourceLine:number;sourceName?:string}[];
 placements:{family:string;domain:string;theme:string;objectCode:string;sourceLine:number}[];
 definitionOverrides?:Record<string,{name:string;description:string;taxonomy:[string,string,string]}>;
 legacyTaxonomy:Record<string,[string,string,string]>;missing:{family:string;detail:string}[];
};}
export const enterpriseHash=()=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export function enterpriseDefinitions(existing:OntologyDefinition[]):OntologyDefinition[]{
 const source=enterpriseSource();const families=new Map(source.families.map(f=>[f.code,f.name]));
 const result=existing.map(d=>({...d,taxonomy:source.legacyTaxonomy[d.code]||d.taxonomy}));
 for(const o of source.objects)if(!o.existing)result.push({code:o.code,id:o.id,name:o.name,layer:'kol_business',taxonomy:[families.get(o.family)!,o.domain,o.theme],source:source.source+'；附件第'+o.sourceLine+'行',description:'企业业务架构规划目录，仅登记对象类型；不代表已有业务实例或可执行能力。'+(o.sourceName?'原文名称：'+o.sourceName+'。':''),items:{properties:[],relations:[],events:[],rules:[],actions:[]}});
 return result.map(d=>{const correction=source.definitionOverrides?.[d.code];return correction?{...d,name:correction.name,description:correction.description,taxonomy:correction.taxonomy}:d;});
}
export type CatalogNode={id:string;parentId:string|null;level:number;name:string;scope?:string;detailStatus?:string};
export const themeId=(p:string[])=>'theme_'+createHash('sha256').update(JSON.stringify(p)).digest('hex').slice(0,24);
export function enterpriseTaxonomy(definitions:OntologyDefinition[]):OntologyTaxonomy{
 const source=enterpriseSource();const nodes=new Map<string,CatalogNode>();const links=new Map<string,{objectCode:string;path:[string,string,string];primary:boolean}>();
 for(const f of source.families)nodes.set(f.code,{id:f.code,parentId:null,level:1,name:f.name,scope:f.scope,detailStatus:f.detailStatus});
 const add=(p:[string,string,string],objectCode:string,primary:boolean)=>{
  const f=source.families.find(f=>f.name===p[0]);if(!f)throw Error('Unknown enterprise family '+p[0]);
  const domain='domain_'+createHash('sha256').update(JSON.stringify(p.slice(0,2))).digest('hex').slice(0,24);const theme=themeId(p);
  nodes.set(domain,{id:domain,parentId:f.code,level:2,name:p[1]});nodes.set(theme,{id:theme,parentId:domain,level:3,name:p[2]});
  const key=objectCode+':'+theme;links.set(key,{objectCode,path:p,primary:primary||links.get(key)?.primary||false});
 };
 for(const p of source.placements)add([source.families.find(f=>f.code===p.family)!.name,p.domain,p.theme],p.objectCode,false);
 for(const d of definitions)add(d.taxonomy,d.code,true);
 return {nodes:[...nodes.values()],placements:[...links.values()],missing:source.missing};
}
export const enterpriseSchema=`
CREATE TABLE IF NOT EXISTS ontology_catalog_nodes (
 id text PRIMARY KEY,parent_id text REFERENCES ontology_catalog_nodes(id),level integer NOT NULL CHECK(level BETWEEN 1 AND 3),
 name text NOT NULL,metadata jsonb NOT NULL,source_version text NOT NULL
);
CREATE TABLE IF NOT EXISTS ontology_catalog_objects (
 code text PRIMARY KEY,definition jsonb NOT NULL,primary_theme_id text NOT NULL REFERENCES ontology_catalog_nodes(id),
 dataset text NOT NULL,source_version text NOT NULL
);
CREATE TABLE IF NOT EXISTS ontology_catalog_placements (
 object_code text NOT NULL REFERENCES ontology_catalog_objects(code),theme_id text NOT NULL REFERENCES ontology_catalog_nodes(id),
 is_primary boolean NOT NULL,source_version text NOT NULL,PRIMARY KEY(object_code,theme_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ontology_catalog_one_primary ON ontology_catalog_placements(object_code) WHERE is_primary;
CREATE TABLE IF NOT EXISTS ontology_catalog_imports (
 source_version text PRIMARY KEY,dataset text NOT NULL,source_sha256 text NOT NULL,actor text NOT NULL,
 summary jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
`;
export async function importEnterpriseCatalog(db:PoolClient,definitions:OntologyDefinition[],actor:string){
 const source=enterpriseSource();const hash=enterpriseHash();const tree=enterpriseTaxonomy(definitions);
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['ontology-enterprise-catalog']);
 const prior=await db.query('SELECT summary FROM ontology_catalog_imports WHERE source_version=$1',[hash]);
 if(prior.rows.length)return {...prior.rows[0].summary,replayed:true};
 for(const n of tree.nodes.sort((a,b)=>a.level-b.level))await db.query(`INSERT INTO ontology_catalog_nodes(id,parent_id,level,name,metadata,source_version) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET name=$4,metadata=$5,source_version=$6`,[n.id,n.parentId,n.level,n.name,JSON.stringify(n),hash]);
 for(const d of definitions)await db.query(`INSERT INTO ontology_catalog_objects(code,definition,primary_theme_id,dataset,source_version) VALUES($1,$2,$3,$4,$5) ON CONFLICT(code) DO UPDATE SET definition=$2,primary_theme_id=$3,source_version=$5 WHERE ontology_catalog_objects.dataset=$4`,[d.code,JSON.stringify(d),themeId(d.taxonomy),source.dataset,hash]);
 // No tenant drafts, published overrides, instances, permissions or historical events are changed.
 await db.query('UPDATE ontology_catalog_placements SET is_primary=false WHERE object_code=ANY($1::text[])',[definitions.map(d=>d.code)]);
 for(const p of tree.placements)await db.query(`INSERT INTO ontology_catalog_placements(object_code,theme_id,is_primary,source_version) VALUES($1,$2,$3,$4) ON CONFLICT(object_code,theme_id) DO UPDATE SET is_primary=$3,source_version=$4`,[p.objectCode,themeId(p.path),p.primary,hash]);
 const summary={families:source.families.length,domains:tree.nodes.filter(n=>n.level===2).length,themes:tree.nodes.filter(n=>n.level===3).length,sourceObjects:source.objects.length,objects:definitions.length,placements:tree.placements.length,missing:source.missing};
 await db.query('INSERT INTO ontology_catalog_imports(source_version,dataset,source_sha256,actor,summary) VALUES($1,$2,$3,$4,$5)',[hash,source.dataset,source.sourceSha256,actor,JSON.stringify(summary)]);
 return {...summary,replayed:false};
}
