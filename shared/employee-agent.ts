/** Employee-facing projections. Preferences never grant execution qualification. */
export type EmployeeAgentPreference = {
  expert_id: string;
  favorite: boolean;
  viewed_at: string | null;
};

/** Classification describes associated published knowledge, never execution grants. */
export type EmployeeAgentScope = {
  family_id: string | null; domain_id: string | null; base_id: string | null;
  brand: string | null; stage_codes: string[];
};
export type EmployeeAgentBrowseRow = {
  expert_id: string; published_by: string | null; updated_at: string | null;
  scopes: EmployeeAgentScope[];
};
export type EmployeeAgentBrowse = {
  rows: EmployeeAgentBrowseRow[];
  taxonomy: {
    domains: Array<{ id: string; name: string; level: string; parent_id: string | null }>;
    bases: Array<{ id: string; name: string; domain_id: string | null }>;
  };
};

export type EmployeeAgentWorkspace = {
  skills: Array<{ id: string; name: string; summary: string }>;
  knowledge: Array<{
    skill_id: string;
    skill_name: string;
    bases: Array<{ id: string; name: string; document_count: number; summaries: string[] }>;
  }>;
  recent_session: { id: string; title: string; updated_at: string } | null;
};
