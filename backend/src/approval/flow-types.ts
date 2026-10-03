/**
 * Phase 2 流程定义（方案 §7.2 四件套之三：流程设计）。
 *
 * 结构化节点编排（非拖拽）：审批节点 / 条件分支 / 抄送 / 办理人 / 结束。
 * 结束节点锁定 CEO 终审（已确认决策②）。
 */

/** 审批人规则（方案 §3.4，按推荐优先级） */
export type FlowApproverRule =
  | { kind: "role"; role: string } // 指定审批角色（如 "manager"），走品牌/区域解析
  | { kind: "manager_chain"; levels: number } // 申请人的 n 级上级（组织语义）
  | { kind: "named"; employee_id: string } // 指定人（点名）
  | { kind: "self_selected" } // 申请人自选（仅低风险，需发起时指定）
  | { kind: "node_approver"; node_id: string } // 复用前面节点的实际审批人
  | { kind: "ceo" }; // CEO 终审

export type ApprovalMode = "single" | "countersign" | "orsign" | "sequential";
// single=单人审批 countersign=会签(全部通过) orsign=或签(一人通过) sequential=依次审批

export type FlowNode =
  | {
      id: string;
      type: "approval";
      title?: string;
      approver: FlowApproverRule;
      mode: ApprovalMode;
      /** 异常兜底（方案 §3.4，发布前必填）：解析为空时的处理 */
      fallback?: { action: "transfer_to" | "auto_approve"; employee_id?: string };
      next: string;
    }
  | {
      id: string;
      type: "condition";
      title?: string;
      branches: Array<{ id: string; label: string; when: string; next: string }>;
      default_next: string;
    }
  | {
      id: string;
      type: "cc";
      title?: string;
      approvers: FlowApproverRule[];
      next: string;
    }
  | {
      id: string;
      type: "handler";
      title?: string;
      approver: FlowApproverRule;
      next: string;
    }
  | {
      id: string;
      type: "end";
      title?: string;
    };

export type FlowDefinition = {
  start: string;
  nodes: Record<string, FlowNode>;
};

/** 表单字段配置（方案 §7.2 四件套之二） */
export type FormFieldDef = {
  id: string;
  label: string;
  field_type: "text" | "number" | "select" | "date" | "file" | "textarea";
  required: boolean;
  options?: string[];
  /** 条件必填表达式，如 "amount_cny > 5000"；为空表示无条件 */
  required_when?: string;
  validate?: string;
};

export type ApprovalTypeRecord = {
  id: string;
  code: string;
  name: string;
  group: string;
  owner: string;
  visibility: string; // "all" | 部门/角色范围描述
  form_schema: FormFieldDef[];
  flow: FlowDefinition;
  version: number;
  status: "draft" | "published";
  created_at: string;
  updated_at: string;
};

/** 试运行输入 */
export type FlowTestInput = {
  amount?: number;
  currency?: string;
  requester_name?: string;
  brand?: string;
  region?: string;
  fields?: Record<string, string | number>;
  /** 申请人自选的审批人（self_selected 用） */
  selected_approver?: string;
};

export type FlowTestResult = {
  ok: boolean;
  path: string[]; // 命中的节点 id 序列
  steps: Array<{ node_id: string; name: string; role: string; mode?: ApprovalMode }>;
  cc: Array<{ node_id: string; name: string }>;
  error?: string;
};
