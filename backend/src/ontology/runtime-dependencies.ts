import { createHash } from 'node:crypto';
import { postgresPool } from '../postgres/pool.js';
import { HttpFail } from '../host/errors.js';
import { employeeDefinition } from './catalog.js';
import type { OntologyDefinition } from '../../../shared/ontology.js';
import type { OntologyReference } from '../capability/contracts.js';

type Query = Pick<ReturnType<typeof postgresPool>, 'query'>;
export type PublishedBusinessContext = { company_id: string; fingerprint: string; objects: Array<{revision: number; definition: OntologyDefinition}> };

/** Called after Agent/skill authorization and again before actual IO. Definitions grant no access. */
export async function publishedBusinessContext(userId: string, references: readonly OntologyReference[], suppliedDb?: Query): Promise<PublishedBusinessContext | null> {
  if (!references.length) return null;
  const db=suppliedDb||postgresPool();
  return publishedBusinessDefinitions(await businessCompanyForUser(userId,db),references,db);
}

export async function businessCompanyForUser(userId:string,db:Query):Promise<string>{
  const fail = (code: string): never => { throw new HttpFail(409,{code}); };
  const companies = (await db.query<{company_id: string}>(`SELECT DISTINCT m.company_id FROM organization_people p
    JOIN users u ON u.id=p.user_id AND u.active=1
    JOIN organization_memberships m ON m.person_ref=p.person_ref
    JOIN organization_units ou ON ou.id=m.org_unit_id AND ou.company_id=m.company_id
    WHERE p.user_id=$1 AND p.status='active' AND m.status='active' AND ou.status='active'
      AND (m.effective_from IS NULL OR m.effective_from<=$2) AND (m.effective_to IS NULL OR m.effective_to>$2)`,[userId,new Date().toISOString()])).rows;
  if (companies.length !== 1) fail('ontology_company_context_required');
  return companies[0].company_id;
}

/** Governance callers must provide their already-authorized target company; this function grants no access. */
export async function publishedBusinessDefinitions(company:string,references:readonly OntologyReference[],db:Query):Promise<PublishedBusinessContext|null>{
  if(!references.length)return null;
  const fail=(code:string):never=>{throw new HttpFail(409,{code});};
  if(!company)fail('ontology_company_context_required');
  const rows = (await db.query<{code: string; published: OntologyDefinition | null; disabled: boolean; published_revision: number | null}>(`SELECT d.code,d.published,d.disabled,
    (SELECT max(v.revision) FROM ontology_versions v WHERE v.company_id=d.company_id AND v.code=d.code AND v.action IN ('publish','restore')) AS published_revision
    FROM ontology_documents d WHERE d.company_id=$1 AND d.code=ANY($2::text[])`,[company,references.map(reference=>reference.object)])).rows;
  const objects = references.map(reference => {
    const row=rows.find(value=>value.code===reference.object);
    if (!row || row.disabled || !row.published) return fail('ontology_dependency_not_published');
    if (Number(row.published_revision)!==reference.revision) return fail('ontology_dependency_version_conflict');
    if ((reference.actions||[]).some(action=>!row.published!.items.actions.some(item=>item.code===action))) return fail('ontology_action_dependency_missing');
    return {revision:reference.revision,definition:employeeDefinition(row.published)};
  });
  return {company_id:company,fingerprint:createHash('sha256').update(JSON.stringify([company,objects])).digest('hex'),objects};
}
