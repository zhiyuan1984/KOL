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
};
export type OntologyDocument = {
  code: string; revision: number; draft: OntologyDefinition | null; published: OntologyDefinition | null;
  status: 'registered' | 'published' | 'disabled' | 'draft'; updatedAt: string | null;
};
export type OntologyContext = { companyId: string; companies: { id: string; name: string }[]; admin: boolean };
export type OntologyCatalog = { context: OntologyContext; sourceVersion: string; objects: OntologyDocument[] };
export type OntologyVersion = { id: string; code: string; revision: number; action: string; actor: string; reason: string; createdAt: string; definition: OntologyDefinition | null };
export type OntologyReceipt = { id: string; code: string; revision: number; action: string; createdAt: string };
export type OntologyConfirmation = { token: string; code: string; revision: number; action: string; expiresAt: string; previous: OntologyDefinition | null; next: OntologyDefinition | null };
