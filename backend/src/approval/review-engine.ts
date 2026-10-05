import {
  numericConfigurationErrors,
  validDecimal,
  validMoney,
} from "./review-numeric.js";
import { validateCondition, evaluateCondition } from "./review-conditions.js";
import type {
  ReviewDefinition,
  ReviewInstance,
  ReviewIssue,
  ReviewNode,
  ReviewTask,
} from "../../../shared/review.js";
import { randomUUID } from "node:crypto";

const idPattern = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const unsafe = new Set(["__proto__", "constructor", "prototype"]);
export function validateDefinition(input: unknown): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });
  if (!input || typeof input !== "object")
    return [{ path: "", message: "流程必须为对象" }];
  const d = input as ReviewDefinition;
  for (const key of Object.keys(d))
    if (!["schema", "name", "description", "fields", "nodes", "subjectType"].includes(key))
      add(key, "不支持的流程属性");
  if (d.schema !== "review.definition.v1") add("schema", "不支持的契约版本");
  if (typeof d.name !== "string" || !d.name.trim() || d.name.length > 120)
    add("name", "名称必填，最多 120 字");
  if (typeof d.description !== "string" || d.description.length > 2000)
    add("description", "说明最多 2000 字");
  if (!Array.isArray(d.fields) || !Array.isArray(d.nodes))
    return [...issues, { path: "", message: "字段和节点必须为数组" }];
  if (d.subjectType !== undefined && d.subjectType !== "knowledge_publication") add("subjectType", "未知的资料类型");
  if (d.subjectType === "knowledge_publication") {
    if (d.fields.length !== 2 || !d.fields.some(f => f?.id === "knowledge_request" && f.type === "text" && f.required)
      || !d.fields.some(f => f?.id === "publication_note" && f.type === "textarea" && f.required))
      add("fields", "知识发布流程须保留系统资料引用和发布说明两个字段");
    if (!d.nodes.some(n => n?.type === "review")) add("nodes", "知识发布必须经过人工审核");
    for (const n of d.nodes) if (Array.isArray(n?.operations?.amendment?.fields) && n.operations.amendment.fields.some(f => f !== "publication_note"))
      add(`nodes.${n.id}.operations`, "仅可补充发布说明；原件变化须创建新版本重新申请");
  }
  if (d.fields.length > 100 || d.nodes.length > 100 || !d.nodes.length)
    add("", "流程须有 1–100 个节点，最多 100 个字段");
  const fields = new Map<string, (typeof d.fields)[number]>();
  d.fields.forEach((f, i) => {
    const p = `fields.${i}`;
    if (!f || typeof f !== "object") {
      add(p, "字段格式错误");
      return;
    }
    for (const key of Object.keys(f))
      if (
        ![
          "id",
          "label",
          "type",
          "required",
          "options",
          "numeric",
          "currencies",
          "currencySource",
        ].includes(key)
      )
        add(`${p}.${key}`, "不支持的字段属性");
    if (!idPattern.test(f.id) || unsafe.has(f.id) || fields.has(f.id))
      add(`${p}.id`, "字段标识必须合法且唯一");
    fields.set(f.id, f);
    for (const message of numericConfigurationErrors(f)) add(p, message);
    if (typeof f.label !== "string" || !f.label.trim() || f.label.length > 120)
      add(`${p}.label`, "字段名称必填，最多 120 字");
    if (
      ![
        "text",
        "textarea",
        "number",
        "decimal",
        "money",
        "date",
        "select",
        "multiselect",
        "attachment",
      ].includes(f.type)
    )
      add(`${p}.type`, "当前版本不支持此字段类型");
    if (typeof f.required !== "boolean")
      add(`${p}.required`, "必填配置必须为布尔值");
    if (
      ["select", "multiselect"].includes(f.type) &&
      (!Array.isArray(f.options) ||
        !f.options.length ||
        f.options.length > 100 ||
        f.options.some(
          (o) => typeof o !== "string" || !o.trim() || o.length > 120,
        ) ||
        new Set(f.options).size !== f.options.length)
    )
      add(`${p}.options`, "须配置 1–100 个不重复的有效选项");
  });
  const nodes = new Map<string, ReviewNode>();
  d.nodes.forEach((n, i) => {
    const p = `nodes.${i}`;
    if (!n || typeof n !== "object") {
      add(p, "节点格式错误");
      return;
    }
    for (const key of Object.keys(n))
      if (
        ![
          "id",
          "name",
          "type",
          "next",
          "otherwise",
          "condition",
          "assignee",
          "mode",
          "reject",
          "timeoutHours",
          "operations",
          "x",
          "y",
        ].includes(key)
      )
        add(`${p}.${key}`, "不支持的节点属性");
    if (!idPattern.test(n.id) || unsafe.has(n.id) || nodes.has(n.id))
      add(`${p}.id`, "节点标识必须合法且唯一");
    nodes.set(n.id, n);
    if (typeof n.name !== "string" || !n.name.trim() || n.name.length > 120)
      add(`${p}.name`, "节点名称必填，最多 120 字");
    if (
      ![
        "start",
        "review",
        "condition",
        "end",
        "cc",
        "consult",
        "handler",
      ].includes(n.type)
    )
      add(`${p}.type`, "当前版本不支持此节点类型");
    if (["review", "cc", "consult", "handler"].includes(n.type)) {
      if (n.type !== "review" && n.operations)
        add(`${p}.operations`, "抄送、征询和办理节点暂不支持评审补充操作");
      if (n.operations) {
        const ops = n.operations;
        if (typeof ops !== "object" || Array.isArray(ops))
          add(`${p}.operations`, "操作策略格式错误");
        for (const key of Object.keys(ops))
          if (
            !["transfer", "countersign", "amendment", "timeout"].includes(key)
          )
            add(`${p}.operations.${key}`, "未知操作策略");
        for (const rule of [
          ops.transfer,
          ops.countersign,
          ops.timeout?.action === "transfer" ? ops.timeout : undefined,
        ])
          if (rule) {
            const a = rule.candidates;
            if (
              !a ||
              !["named", "role", "manager"].includes(a.kind) ||
              (a.kind === "role" &&
                (typeof a.role !== "string" || !a.role.trim())) ||
              (a.kind === "named" &&
                (!Array.isArray(a.userIds) ||
                  !a.userIds.length ||
                  a.userIds.length > 100 ||
                  a.userIds.some((x) => typeof x !== "string" || !x) ||
                  new Set(a.userIds).size !== a.userIds.length))
            )
              add(`${p}.operations`, "必须配置有效的授权候选人集合");
          }
        if (
          ops.transfer &&
          !["preserve", "reset"].includes(ops.transfer.deadline)
        )
          add(`${p}.operations.transfer`, "须明确转交后保留或重置时限");
        if (ops.countersign && !["all", "sequential"].includes(n.mode || ""))
          add(`${p}.operations.countersign`, "仅会签和依次评审支持加签");
        if (
          ops.amendment &&
          (ops.amendment.restart !== "start" ||
            !Array.isArray(ops.amendment.fields) ||
            !ops.amendment.fields.length ||
            ops.amendment.fields.some((f) => !fields.has(f)) ||
            new Set(ops.amendment.fields).size !== ops.amendment.fields.length)
        )
          add(
            `${p}.operations.amendment`,
            "补充材料必须选择已有字段并从开始重审",
          );
        if (
          ops.timeout &&
          (!n.timeoutHours ||
            !["remind", "transfer"].includes(ops.timeout.action) ||
            (ops.timeout.action === "transfer" &&
              ops.timeout.deadline !== "reset"))
        )
          add(`${p}.operations.timeout`, "超时策略需要时限；升级后须重置时限");
      }
      if (!["single", "all", "any", "sequential"].includes(n.mode!))
        add(`${p}.mode`, "请选择评审方式");
      if (
        n.type === "review" &&
        (!["any_reject", "all_reject"].includes(n.reject!) ||
          (n.reject === "all_reject" && n.mode !== "any"))
      )
        add(`${p}.reject`, "全部拒绝仅适用于或签");
      if (!["named", "manager", "role"].includes(n.assignee?.kind || ""))
        add(`${p}.assignee`, "请选择权威组织人员、角色或直属负责人");
      if (
        n.assignee?.kind === "role" &&
        (typeof n.assignee.role !== "string" || !n.assignee.role.trim())
      )
        add(`${p}.assignee`, "请选择已授权评审角色");
      if (
        n.assignee?.kind === "named" &&
        (!Array.isArray(n.assignee.userIds) ||
          !n.assignee.userIds.length ||
          n.assignee.userIds.length > 100 ||
          n.assignee.userIds.some((u) => typeof u !== "string" || !u) ||
          new Set(n.assignee.userIds).size !== n.assignee.userIds.length ||
          (n.mode === "single" && n.assignee.userIds.length !== 1))
      )
        add(`${p}.assignee`, "单人评审须选一人，多人评审须选不重复的人员");
      if (
        n.timeoutHours !== undefined &&
        (!Number.isInteger(n.timeoutHours) ||
          n.timeoutHours < 1 ||
          n.timeoutHours > 8760)
      )
        add(`${p}.timeoutHours`, "期限须为 1–8760 小时");
    }
    if (n.type === "condition") {
      issues.push(...validateCondition(n.condition, fields, `${p}.condition`));
    }
  });
  const starts = d.nodes.filter((n) => n?.type === "start");
  if (starts.length !== 1) add("nodes", "必须且只能有一个开始节点");
  if (!d.nodes.some((n) => n?.type === "review"))
    add("nodes", "至少配置一个评审节点");
  const edges = (n: ReviewNode) =>
    n.type === "end"
      ? []
      : n.type === "condition"
        ? [n.next, n.otherwise]
        : [n.next];
  for (const n of nodes.values()) {
    for (const target of edges(n))
      if (!target || !nodes.has(target) || nodes.get(target)?.type === "start")
        add(`nodes.${n.id}`, "连线缺失、目标不存在或回到开始");
    if (n.type === "end" && (n.next || n.otherwise))
      add(`nodes.${n.id}`, "结束节点不得有后继");
    if (n.type !== "condition" && n.otherwise)
      add(`nodes.${n.id}`, "只有条件节点可以有条件不满足分支");
  }
  const visited = new Set<string>(),
    stack = new Set<string>();
  const visit = (id: string) => {
    if (stack.has(id)) {
      add(`nodes.${id}`, "不支持循环流程");
      return;
    }
    if (visited.has(id) || !nodes.has(id)) return;
    visited.add(id);
    stack.add(id);
    for (const target of edges(nodes.get(id)!)) if (target) visit(target);
    stack.delete(id);
  };
  if (starts.length === 1) visit(starts[0].id);
  if (visited.size !== nodes.size) add("nodes", "存在无法从开始到达的节点");
  // Every route must obtain a human decision before reaching an end.
  const noReview = (id: string, seen = new Set<string>()): boolean => {
    const n = nodes.get(id);
    if (!n || seen.has(id) || n.type === "review") return false;
    if (n.type === "end") return true;
    seen.add(id);
    return edges(n).some((t) => t && noReview(t, new Set(seen)));
  };
  if (starts.length === 1 && noReview(starts[0].id))
    add("nodes", "存在绕过评审直接结束的分支");
  return issues;
}

export function validateValues(
  d: ReviewDefinition,
  values: unknown,
): ReviewIssue[] {
  if (!values || typeof values !== "object" || Array.isArray(values))
    return [{ path: "values", message: "表单值必须为对象" }];
  const data = values as Record<string, unknown>,
    issues: ReviewIssue[] = [];
  for (const key of Object.keys(data))
    if (!d.fields.some((f) => f.id === key))
      issues.push({ path: key, message: "不允许未声明字段" });
  for (const f of d.fields) {
    const v = data[f.id],
      empty =
        v === undefined ||
        v === null ||
        (typeof v === "string" && !v.trim()) ||
        (Array.isArray(v) && !v.length);
    if (empty) {
      if (f.required) issues.push({ path: f.id, message: `${f.label}必填` });
      continue;
    }
    let valid = true;
    if (f.type === "number")
      valid = typeof v === "number" && Number.isFinite(v);
    else if (f.type === "decimal") valid = validDecimal(v, f);
    else if (f.type === "money") valid = validMoney(v, f);
    else if (f.type === "attachment")
      valid =
        Array.isArray(v) &&
        v.length <= 10 &&
        new Set(v).size === v.length &&
        v.every(
          (id) => typeof id === "string" && /^[a-zA-Z0-9-]{1,64}$/.test(id),
        );
    else if (f.type === "multiselect")
      valid =
        Array.isArray(v) &&
        new Set(v).size === v.length &&
        v.every((x) => typeof x === "string" && f.options?.includes(x));
    else if (f.type === "select")
      valid = typeof v === "string" && Boolean(f.options?.includes(v));
    else if (f.type === "date")
      valid =
        typeof v === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(v) &&
        Number.isFinite(Date.parse(v)) &&
        new Date(v).toISOString().slice(0, 10) === v;
    else valid = typeof v === "string" && v.length <= 10000;
    if (!valid)
      issues.push({
        path: f.id,
        message: ["decimal", "money"].includes(f.type)
          ? `${f.label}须填写普通十进制数值：整数最多 ${(f.numeric?.precision || 0) - (f.numeric?.scale || 0)} 位，小数最多 ${f.numeric?.scale || 0} 位${f.numeric?.min !== undefined ? `，下限 ${f.numeric.min}` : ""}${f.numeric?.max !== undefined ? `，上限 ${f.numeric.max}` : ""}${f.type === "money" ? `；币种须为 ${f.currencies?.join("、")}` : ""}。不接受科学计数法或自动取整。`
          : `${f.label}格式不正确`,
      });
  }
  return issues;
}

export type ResolveReviewers = (
  node: ReviewNode,
  requester: string,
  task?: ReviewTask,
) => string[];
export function advanceReview(
  instance: ReviewInstance,
  from: string,
  resolve: ResolveReviewers,
  now: string,
): void {
  let id = from;
  for (let steps = 0; steps <= instance.definition.nodes.length; steps++) {
    const n = instance.definition.nodes.find((n) => n.id === id);
    if (!n) throw new Error("流程目标不存在");
    instance.currentNode = id;
    if (n.type === "end") {
      instance.status = "approved";
      return;
    }
    if (["review", "cc", "consult", "handler"].includes(n.type)) {
      const users = [...new Set(resolve(n, instance.requester))];
      if (
        !users.length ||
        (n.mode === "single" && users.length !== 1) ||
        (n.type === "review" && users.includes(instance.requester))
      ) {
        instance.status = "blocked";
        instance.blockedReason =
          "无法解析合格评审人，或发起人与评审人冲突。请修复组织配置后重试。";
        return;
      }
      instance.status = "reviewing";
      delete instance.blockedReason;
      instance.tasks.push(
        ...users.map((userId, i) => ({
          id: randomUUID(),
          round: instance.round || 1,
          assignmentSource: "default" as const,
          duty: n.type as "review" | "cc" | "consult" | "handler",
          nodeId: id,
          userId,
          status:
            n.type === "cc"
              ? ("completed" as const)
              : n.mode === "sequential" && i > 0
                ? ("waiting" as const)
                : ("pending" as const),
          ...(n.timeoutHours && !(n.mode === "sequential" && i > 0)
            ? {
                dueAt: new Date(
                  Date.parse(now) + n.timeoutHours * 3600000,
                ).toISOString(),
              }
            : {}),
        })),
      );
      if (n.type === "cc") {
        id = n.next!;
        continue;
      }
      return;
    }
    if (n.type === "condition") {
      const evaluation = evaluateCondition(
        n.condition!,
        instance.values,
        instance.definition.fields,
      );
      if (evaluation.missing.length) {
        instance.status = "blocked";
        instance.blockedReason = `条件字段 ${evaluation.missing.join("、")} 缺失、格式无效或币种与比较规则不一致，请撤回并核对材料后重新发起。`;
        return;
      }
      id = (evaluation.result ? n.next : n.otherwise)!;
    } else id = n.next!;
  }
  throw new Error("流程未能收敛");
}

export function decideReview(
  i: ReviewInstance,
  user: string,
  action: "approve" | "reject",
  reason: string,
  resolve: ResolveReviewers,
  now: string,
): void {
  if (i.status !== "reviewing") throw new Error("当前状态不允许评审");
  const task = i.tasks.find(
    (t) =>
      t.nodeId === i.currentNode &&
      (t.round || 1) === (i.round || 1) &&
      t.userId === user &&
      t.status === "pending",
  );
  const node = i.definition.nodes.find((n) => n.id === i.currentNode)!;
  if (node.type !== "review") throw new Error("此节点不接受审批决定");
  if (
    !task ||
    !resolve(node, i.requester, task).includes(user) ||
    user === i.requester
  )
    throw new Error("当前用户没有有效评审任务");
  task.status = action === "approve" ? "approved" : "rejected";
  task.reason = reason;
  task.decidedAt = now;
  const tasks = i.tasks.filter(
    (t) =>
      t.nodeId === i.currentNode &&
      (t.round || 1) === (i.round || 1) &&
      !["transferred", "superseded", "cancelled"].includes(t.status),
  );
  const reject =
    node.reject === "all_reject"
      ? tasks.every((t) => t.status === "rejected")
      : tasks.some((t) => t.status === "rejected");
  if (reject) {
    i.status = "rejected";
    tasks.forEach((t) => {
      if (["pending", "waiting"].includes(t.status)) t.status = "cancelled";
    });
    return;
  }
  const approved =
    node.mode === "any"
      ? tasks.some((t) => t.status === "approved")
      : tasks.every((t) => t.status === "approved");
  if (approved) {
    tasks.forEach((t) => {
      if (["pending", "waiting"].includes(t.status)) t.status = "cancelled";
    });
    advanceReview(i, node.next!, resolve, now);
  } else if (node.mode === "sequential") {
    const next = tasks.find((t) => t.status === "waiting");
    if (next) {
      next.status = "pending";
      if (node.timeoutHours)
        next.dueAt = new Date(
          Date.parse(now) + node.timeoutHours * 3600000,
        ).toISOString();
    }
  }
}
