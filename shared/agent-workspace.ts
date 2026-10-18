import type {AgentOrganizationState,AgentOrganizationAssignment} from './agent-organization.js';
export type AgentBindingTarget={target_type:'organization_unit'|'person';target_id:string;company_id:string};
export type AgentOrganizationTarget={company_id:string;org_unit_id:string};
export type AgentGovernanceDraft={organization:AgentOrganizationTarget|null;bindings:AgentBindingTarget[];reason:string;basis:string};
export type AgentSkillRelease = { skill_id: string; release_hash: string; knowledge_revision: number | null };
export type AgentContent = { name: string; description: string; skills: AgentSkillRelease[] };
export type AgentDraft = AgentContent & { revision: number; updated_at: string; updated_by: string; governance?:AgentGovernanceDraft };
export type AgentSkillOption = {
  id: string; label: string; summary: string; category: string; release_hash: string;
  published: boolean; document_query: boolean; risk: "R1" | "R2" | "R3" | null;
  knowledge_revision: number | null; knowledge_ready: boolean;
  ontology_dependencies?:Array<{object:string;revision:number;actions?:string[]}>;
  capabilities_ready?:boolean;
  resources: Array<{ id: string; configured: boolean; enabled: boolean; tool_count: number }>;
  execution: "async_job" | "skill";
};
export type AgentWorkspaceState = {
  id: string; name: string; description: string; status: "draft" | "published" | "disabled";
  version: number; published_revision: number | null; created_at: string; updated_at: string;
  effective: AgentContent; draft: AgentDraft | null;
  organization: AgentOrganizationState;
  governance_basis?:string;
  actions: { edit: boolean; publish: boolean; disable: boolean; enable: boolean };
};
export type AgentReleaseCheck = {
  preparation_id: string; expires_at: string; revision: number; org_version: number;
  content: AgentContent; added_skills: string[]; removed_skills: string[]; updated_skills: string[];
  coverage_count: number; binding_count: number; blockers: string[]; warnings: string[];
  changes?:{name:{before:string;after:string}|null;description:{before:string;after:string}|null;organization:{before:AgentOrganizationAssignment|null;after:AgentOrganizationAssignment|null}|null;bindings_added:AgentBindingTarget[];bindings_removed:AgentBindingTarget[];users_added:Array<{user_id:string;display_name:string|null}>;users_removed:Array<{user_id:string;display_name:string|null}>;reason:string;total:number};
};
export type AgentReleaseReceipt = { id: string; agent_id: string; version: number; published_at: string; request_id: string };
export type AgentVersionRecord = AgentContent & { version: number; published_at: string; published_by: string; receipt_id: string | null };
