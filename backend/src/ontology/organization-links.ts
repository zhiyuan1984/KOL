import type {PoolClient} from 'pg';
import type {OntologyScopeMapping,OntologyDefinition} from '../../../shared/ontology.js';
import {loadOntologyCatalog} from './catalog.js';
import {enterpriseTaxonomy} from './enterprise.js';
type DB={query:PoolClient['query']};
/** Explicit default-range relationships. Organization identities come from existing organization_units. */
export const organizationLinksSchema=`
CREATE TABLE IF NOT EXISTS ontology_organization_business_domains(
 company_id text NOT NULL,binding_id text NOT NULL,subject_type text NOT NULL CHECK(subject_type IN ('organization_unit','position','person')),
 subject_id text NOT NULL,organization_id text,family_name text NOT NULL,domain_name text NOT NULL,
 include_descendants boolean NOT NULL,owner_person_ref text,PRIMARY KEY(company_id,binding_id),
 CHECK((subject_type='organization_unit' AND organization_id=subject_id) OR (subject_type<>'organization_unit' AND organization_id IS NULL))
);
CREATE INDEX IF NOT EXISTS ontology_org_domains_subject ON ontology_organization_business_domains(company_id,subject_type,subject_id);
CREATE TABLE IF NOT EXISTS ontology_organization_business_objects(
 company_id text NOT NULL,binding_id text NOT NULL,organization_id text,object_code text NOT NULL,
 PRIMARY KEY(company_id,binding_id,object_code),
 FOREIGN KEY(company_id,binding_id) REFERENCES ontology_organization_business_domains(company_id,binding_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ontology_org_objects_object ON ontology_organization_business_objects(company_id,object_code);
-- Migrate only previously confirmed bindings; never guess domains from organization names.
INSERT INTO ontology_organization_business_domains(company_id,binding_id,subject_type,subject_id,organization_id,family_name,domain_name,include_descendants,owner_person_ref)
 SELECT s.company_id,m->>'id',m->>'subjectType',m->>'subjectId',CASE WHEN m->>'subjectType'='organization_unit' THEN m->>'subjectId' END,m->'domain'->>0,m->'domain'->>1,COALESCE((m->>'includeDescendants')::boolean,false),m->>'ownerPersonRef'
 FROM ontology_scope_settings s CROSS JOIN LATERAL jsonb_array_elements(s.mappings) m
 ON CONFLICT(company_id,binding_id) DO NOTHING;
INSERT INTO ontology_organization_business_objects(company_id,binding_id,organization_id,object_code)
 SELECT DISTINCT b.company_id,b.binding_id,b.organization_id,p.object_code FROM ontology_organization_business_domains b
 JOIN ontology_catalog_nodes f ON f.level=1 AND f.name=b.family_name
 JOIN ontology_catalog_nodes d ON d.parent_id=f.id AND d.name=b.domain_name
 JOIN ontology_catalog_nodes t ON t.parent_id=d.id
 JOIN ontology_catalog_placements p ON p.theme_id=t.id
 ON CONFLICT DO NOTHING;
`;
export async function readOrganizationMappings(db:DB,company:string):Promise<OntologyScopeMapping[]>{
 const rows=(await db.query(`SELECT binding_id AS id,subject_type AS "subjectType",subject_id AS "subjectId",jsonb_build_array(family_name,domain_name) AS domain,include_descendants AS "includeDescendants",owner_person_ref AS "ownerPersonRef" FROM ontology_organization_business_domains WHERE company_id=$1 ORDER BY binding_id`,[company])).rows;
 return rows.map(r=>({id:r.id,subjectType:r.subjectType,subjectId:r.subjectId,domain:r.domain,includeDescendants:r.includeDescendants,...(r.ownerPersonRef?{ownerPersonRef:r.ownerPersonRef}:{})}));
}
export async function syncOrganizationObjects(db:DB,company:string){
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['ontology-scope:'+company]);
 const bindings=await readOrganizationMappings(db,company);if(!bindings.length)return;
 const baseline=loadOntologyCatalog().objects;const placements=enterpriseTaxonomy(baseline).placements;
 const overrides=(await db.query<{code:string;published:OntologyDefinition|null;disabled:boolean}>('SELECT code,published,disabled FROM ontology_documents WHERE company_id=$1',[company])).rows;
 const disabled=new Set(overrides.filter(o=>o.disabled).map(o=>o.code));
 for(const override of overrides)if(override.published){for(let i=placements.length-1;i>=0;i--)if(placements[i].objectCode===override.code&&placements[i].primary)placements.splice(i,1);placements.push({objectCode:override.code,path:override.published.taxonomy,primary:true});}
 await db.query('DELETE FROM ontology_organization_business_objects WHERE company_id=$1',[company]);
 for(const binding of bindings){const codes=[...new Set(placements.filter(p=>p.path[0]===binding.domain[0]&&p.path[1]===binding.domain[1]&&!disabled.has(p.objectCode)).map(p=>p.objectCode))];
  await db.query(`INSERT INTO ontology_organization_business_objects(company_id,binding_id,organization_id,object_code) SELECT $1,$2,$3,unnest($4::text[]) ON CONFLICT DO NOTHING`,[company,binding.id,binding.subjectType==='organization_unit'?binding.subjectId:null,codes]);
 }
}
export async function writeOrganizationMappings(db:DB,company:string,mappings:OntologyScopeMapping[]){
 await db.query('DELETE FROM ontology_organization_business_domains WHERE company_id=$1',[company]);
 for(const m of mappings)await db.query('INSERT INTO ontology_organization_business_domains(company_id,binding_id,subject_type,subject_id,organization_id,family_name,domain_name,include_descendants,owner_person_ref) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[company,m.id,m.subjectType,m.subjectId,m.subjectType==='organization_unit'?m.subjectId:null,...m.domain,m.includeDescendants,m.ownerPersonRef||null]);
 await syncOrganizationObjects(db,company);
}
