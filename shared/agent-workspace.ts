import type {AgentOrganizationState} from './agent-organization.js';
export type AgentSkillRelease = { skill_id: string; release_hash: string; knowledge_revision: number | null };
export type AgentContent = { name: string; description: string; skills: AgentSkillRelease[] };
export type AgentDraft = AgentContent & { revision: number; updated_at: string; updated_by: string };
export type AgentSkillOption = {
  id: string; label: string; summary: string; category: string; release_hash: string;
  published: boolean; document_query: boolean; risk: "R1" | "R2" | "R3" | null;
  knowledge_revision: number | null; knowledge_ready: boolean;
  resources: Array<{ id: string; configured: boolean; enabled: boolean; tool_count: number }>;
  execution: "async_job" | "skill";
};
export type AgentWorkspaceState = {
  id: string; name: string; description: string; status: "draft" | "published" | "disabled";
  version: number; published_revision: number | null; created_at: string; updated_at: string;
  effective: AgentContent; draft: AgentDraft | null;
  organization: AgentOrganizationState;
  actions: { edit: boolean; publish: boolean; disable: boolean; enable: boolean };
};
export type AgentReleaseCheck = {
  preparation_id: string; expires_at: string; revision: number; org_version: number;
  content: AgentContent; added_skills: string[]; removed_skills: string[]; updated_skills: string[];
  coverage_count: number; binding_count: number; blockers: string[]; warnings: string[];
};
export type AgentReleaseReceipt = { id: string; agent_id: string; version: number; published_at: string; request_id: string };
export type AgentVersionRecord = AgentContent & { version: number; published_at: string; published_by: string; receipt_id: string | null };
