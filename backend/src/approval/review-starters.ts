import { emptyReviewDefinition, knowledgeReviewDefinition, type ReviewStarter, type ReviewDefinition } from "../../../shared/review.js";

/** Reusable configuration starting points. These are drafts, never company policies. */
export function reviewStarters(): ReviewStarter[] {
  const base = (): ReviewDefinition => ({ ...emptyReviewDefinition(), fields: [
    { id: "purpose", label: "申请事项与依据", type: "textarea" as const, required: true },
    { id: "materials", label: "佐证材料", type: "attachment" as const, required: false },
    { id: "object_reference", label: "关联业务对象或原文链接", type: "text" as const, required: false },
  ] });
  const single = base();
  single.name = "单人审批"; single.description = "适用于由一位负责人判断的事项。请按公司现行职责核对人员。";
  const multiple = base();
  multiple.name = "多人会签"; multiple.description = "适用于多个职责人员共同核对的事项。发布前选择实际审批人员。";
  multiple.nodes[1] = { ...multiple.nodes[1], name: "相关职责人员会签", assignee: { kind: "named", userIds: [] }, mode: "all" };
  const general = base();
  general.name = "通用事项审批"; general.description = "没有专用流程时说明事项，在管理员发布的候选范围内选择本次审批人。";
  general.nodes[1] = { ...general.nodes[1], name: "事项审批", assignee: { kind: "requester_choice", candidates: { kind: "manager" } } };
  const handling = base();
  handling.name = "审批后办理"; handling.description = "负责人批准后交指定人员办理，办理人须填写完成证据。不会自动付款、发送或推进业务阶段。";
  handling.nodes[1].next = "handler";
  handling.nodes.splice(2, 0, { id: "handler", name: "事项办理与结果登记", type: "handler", assignee: { kind: "named", userIds: [] }, mode: "single", next: "end" });
  const conditional = base();
  conditional.name = "条件审批"; conditional.description = "按事项类别选择审批路径；请配置公司现行人员职责，不内置金额阈值。";
  conditional.fields.unshift({ id: "category", label: "事项类别", type: "select", required: true, options: ["常规事项", "专项事项"] });
  conditional.nodes[0].next = "condition";
  conditional.nodes.splice(1, 0, { id: "condition", name: "事项类别判断", type: "condition", condition: { field: "category", op: "eq", value: "专项事项" }, next: "special", otherwise: "review" },
    { id: "special", name: "专项职责审批", type: "review", assignee: { kind: "named", userIds: [] }, mode: "single", reject: "any_reject", next: "end" });
  return [single, multiple, conditional, handling, general, knowledgeReviewDefinition()].map((definition, index) => ({
    id: ["single", "countersign", "conditional", "handling", "general", "knowledge"][index], name: definition.name,
    description: definition.description, definition,
  }));
}
