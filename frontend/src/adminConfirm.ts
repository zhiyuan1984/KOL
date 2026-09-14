/** L3 confirm copy for admin destructive writes. Object / scope / consequence only. */

export type AdminConfirmCopy = {
  kind: AdminConfirmKind;
  title: string;
  object: string;
  scope: string;
  consequence: string;
  confirmLabel: string;
};

export type AdminConfirmKind =
  | "user-deactivate"
  | "connector-disable"
  | "grant-revoke"
  | "knowledge-archive"
  | "knowledge-hard-delete"
  | "skill-delete";

function named(label: string, extra = ""): string {
  const name = String(label || "").trim() || "未命名";
  const suffix = String(extra || "").trim();
  if (!suffix || suffix === name) return name;
  return `${name}（${suffix}）`;
}

export function userDeactivateConfirm(name: string, email = ""): AdminConfirmCopy {
  return {
    kind: "user-deactivate",
    title: "停用员工",
    object: named(name, email),
    scope: "组织账号 · 登录与工作台授权",
    consequence: "该员工立即无法登录或使用工作台。已发出的邮件与审计记录保留。可在本页再次启用。",
    confirmLabel: "确认停用",
  };
}

export function connectorDisableConfirm(label: string, id = ""): AdminConfirmCopy {
  return {
    kind: "connector-disable",
    title: "停用连接器",
    object: named(label, id),
    scope: "组织级启用状态 · 不影响凭据引用本身",
    consequence: "员工使用面不再可用该连接能力。凭据位置保留，秘密原值不回显、不删除。可再次启用。",
    confirmLabel: "确认停用",
  };
}

export function grantRevokeConfirm(userLabel: string, connectorLabel: string): AdminConfirmCopy {
  return {
    kind: "grant-revoke",
    title: "收回连接器授权",
    object: `${named(userLabel)} × ${named(connectorLabel)}`,
    scope: "该员工对此连接器的 read / write",
    consequence: "该员工立即失去此连接器权限，其他员工不受影响。审计留下收回记录。",
    confirmLabel: "确认收回",
  };
}

export function knowledgeArchiveConfirm(title: string, version?: number): AdminConfirmCopy {
  const ver = version && version > 0 ? `第 ${version} 版` : "";
  return {
    kind: "knowledge-archive",
    title: "归档知识",
    object: named(title, ver),
    scope: "已发布资产 → 归档（不是彻底删除）",
    consequence: "运营新会话选不到这份资料。已发出邮件仍保留当时的版本号。",
    confirmLabel: "确认归档",
  };
}

export function knowledgeHardDeleteConfirm(title: string): AdminConfirmCopy {
  return {
    kind: "knowledge-hard-delete",
    title: "彻底删除草稿",
    object: named(title),
    scope: "未发布草稿 · 不可恢复",
    consequence: "草稿从知识库移除，不能撤销。已被已发送邮件引用的条目不能彻底删除。",
    confirmLabel: "确认彻底删除",
  };
}

export function skillDeleteConfirm(title: string, id = ""): AdminConfirmCopy {
  return {
    kind: "skill-delete",
    title: "删除技能",
    object: named(title, id),
    scope: "已发布技能包 · 运行时目录",
    consequence: "从运行时目录移除，员工技能目录不再出现。内置技能不能删除。",
    confirmLabel: "确认删除",
  };
}
