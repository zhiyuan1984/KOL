export type EmployeeStatus = "active" | "leave" | "inactive" | "vacant";

export type RelationshipType =
  | "REPORTS_TO"
  | "FUNCTIONAL_MANAGER"
  | "DEPARTMENT_LEADER"
  | "COST_CENTER_OWNER"
  | "FINANCE_OWNER";

export type Employee = {
  id: string;
  name: string;
  department_id: string;
  position: string;
  manager_id: string | null;
  status: EmployeeStatus;
  cost_center: string;
  brand?: string;
  mailboxes: string[];
  delegate_to: string | null;
};

export type OrgUnit = {
  id: string;
  name: string;
  parent_id: string | null;
  leader_id: string | null;
  level: number;
};

export type Relationship = {
  type: RelationshipType;
  from_id: string;
  to_id: string;
};

export type OrgSnapshot = {
  employees: Employee[];
  units: OrgUnit[];
  relationships: Relationship[];
};

export type PolicyApprover =
  | { kind: "manager"; level: number }
  | { kind: "role"; role: "finance_owner" | "gm" | "department_leader" };

export type PolicyRule = {
  id: string;
  amount_min: number;
  amount_max: number | null;
  approvers: PolicyApprover[];
};

export type ApprovalPolicy = {
  id: string;
  name: string;
  business_type: string;
  currency: string;
  skip_self: boolean;
  skip_inactive: boolean;
  skip_vacant: boolean;
  skip_same_person: boolean;
  rules: PolicyRule[];
};

export type ManagerChainNode = {
  level: number;
  employee_id: string;
  name: string;
  role: string;
  status: EmployeeStatus;
  delegate_to: string | null;
};

export type ApprovalStep = {
  sequence: number;
  employee_id: string;
  name: string;
  role: string;
  source: string;
  parallel_group?: string;
};

export type SearchCitation = {
  id?: string;
  pair?: string;
  rate?: number;
  title?: string;
  as_of?: string;
  source_title?: string;
  source_url?: string;
  quote?: string;
};

export type ApprovalPlan = {
  policy_id: string;
  rule_id: string;
  business_type: string;
  amount: number;
  currency: string;
  amount_base: number;
  currency_base: string;
  fx_rate: number;
  requester_id: string;
  requester_name: string;
  steps: ApprovalStep[];
  explanation: string;
  blocked?: { code: string; message: string };
  fx_citation?: SearchCitation;
  policy_citation?: SearchCitation;
  source?: "search" | "stub_fallback";
};
