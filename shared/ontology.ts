/** Definitions describe business semantics. They never grant runtime authority. */
export const ontologyDimensions = ['properties', 'relations', 'events', 'rules', 'actions'] as const;
export type OntologyDimension = typeof ontologyDimensions[number];
export type OntologyRisk = 'R1' | 'R2' | 'R3';
export type OntologyItem = {
  code: string; name: string; description: string; source: string;
  type?: string; required?: boolean; defaultValue?: string; dictionary?: string;
  target?: string; cardinality?: string; inverse?: string;
  producer?: string; payload?: string; condition?: string;
  clause?: string; executionPoint?: string; priority?: string;
  risk?: OntologyRisk; executor?: string; asynchronous?: boolean; input?: string;
};
export type OntologyDefinition = {
  code: string; id: string; name: string; description: string; layer: 'platform' | 'kol_business' | 'org_governance';
  taxonomy: [string, string, string]; source: string; items: Record<OntologyDimension, OntologyItem[]>;
  applicability?: Partial<Record<OntologyDimension,{status:'not_applicable';reason:string}>>;
};
export type OntologyDocument = {
  code: string; revision: number; draft: OntologyDefinition | null; published: OntologyDefinition | null;
  status: 'registered' | 'published' | 'disabled' | 'draft'; updatedAt: string | null;
};
export type OntologyContext = { companyId: string; companies: { id: string; name: string }[]; admin: boolean };
export type OntologyTaxonomy = {nodes:{id:string;parentId:string|null;level:number;name:string;scope?:string;detailStatus?:string}[];placements:{objectCode:string;path:[string,string,string];primary:boolean}[];missing:{family:string;detail:string}[]};
export type OntologyCatalog = { context: OntologyContext; sourceVersion: string; objects: OntologyDocument[]; taxonomy?:OntologyTaxonomy; relevance?:OntologyRelevance };
export type OntologyVersion = { id: string; code: string; revision: number; action: string; actor: string; reason: string; createdAt: string; definition: OntologyDefinition | null };
export type OntologyReceipt = { id: string; code: string; revision: number; action: string; createdAt: string };
export type OntologyConfirmation = { token: string; code: string; revision: number; action: string; expiresAt: string; previous: OntologyDefinition | null; next: OntologyDefinition | null };

/** Discovery defaults only; never grants/revokes access to definitions or tools. */
export type OntologyScopeMapping = {id:string;subjectType:'organization_unit'|'position'|'person';subjectId:string;domain:[string,string];includeDescendants:boolean;ownerPersonRef?:string};
export type OntologyScopeSettings = {revision:number;mappings:OntologyScopeMapping[];updatedAt:string|null};
export type OntologyScopeOptions = {units:{id:string;name:string}[];positions:string[];people:{id:string;name:string}[]};
export type OntologyRelevance = {configured:boolean;relatedDomains:[string,string][];matchedMappings:string[];owners:{domain:[string,string];name:string}[]};
export type OntologyMaintenanceRequest = {id:string;code:string;dimension:OntologyDimension;note:string;createdAt:string};
