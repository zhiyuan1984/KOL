export type AgentOrganizationUnit = {
  id:string; company_id:string; display_name:string; parent_id:string|null;
  level:number; status:string; org_version:number;
};
export type AgentOrganizationAssignment = {
  id:string; company_id:string; org_unit_id:string; path:AgentOrganizationUnit[];
  valid:boolean; issues:string[]; assigned_at:string; assigned_by:string;
};
export type AgentOrganizationState = { revision:number; assignment:AgentOrganizationAssignment|null; system:boolean };
export type AgentOrganizationDirectory = { units:AgentOrganizationUnit[]; versions:Record<string,number>; selectable_ids:string[] };
export type AgentOrganizationCheck = {
  preparation_id:string; expires_at:string; revision:number; org_version:number;
  before:AgentOrganizationAssignment|null; after:AgentOrganizationAssignment|null;
};
export type AgentOrganizationReceipt = {
  id:string; agent_id:string; revision:number; actor:string; changed_at:string;
  before:AgentOrganizationAssignment|null; after:AgentOrganizationAssignment|null; reason:string;
};
export type AgentBrowseFilters = {
  query:string; status:string; binding:string; draft:string;
  level1:string; level2:string; level3:string; ownership:string;
};
export type AgentFacetOption = { value:string; label:string; count:number; parent_id?:string|null; path?:string };
export type AgentBrowseResult<T> = { rows:T[]; total:number; filters:AgentBrowseFilters; facets:Record<Exclude<keyof AgentBrowseFilters,'query'>,AgentFacetOption[]> };
