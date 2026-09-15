/** L3 confirm copy for admin destructive writes. Object / scope / consequence only. */

export type AdminConfirmCopy = {
  kind: AdminConfirmKind;
  title: string;
  object: string;
  scope: string;
  consequence: string;
  confirmLabel: string;
  requireReason?: boolean;
  reasonLabel?: string;
  reasonPlaceholder?: string;
};

export type AdminConfirmKind =
  | "user-deactivate"
  | "connector-disable"
  | "grant-revoke"
  | "grant-write"
  | "knowledge-archive"
  | "knowledge-hard-delete"
  | "knowledge-publish"
  | "skill-delete"
  | "skill-unpublish"
  | "credential-ref"
  | "retention-policy"
  | "proposal-reject"
  | "pipeline-stage"
  | "memory-delete"
  | "session-delete"
  | "starry-unbind";

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

export function knowledgePublishConfirm(title: string, version?: number): AdminConfirmCopy {
  const ver = version && version > 0 ? `第 ${version} 版` : "";
  return {
    kind: "knowledge-publish",
    title: "审批发布知识",
    object: named(title, ver),
    scope: "待审 / 草稿 → 运营知识库正式资产",
    consequence: "发布后运营可启用本版。邮件模板启用后会进入写信底稿。不是草稿预览。",
    confirmLabel: "确认发布",
  };
}

export function grantWriteConfirm(userLabel: string, connectorLabel: string): AdminConfirmCopy {
  return {
    kind: "grant-write",
    title: "授予连接器 write",
    object: `${named(userLabel)} × ${named(connectorLabel)}`,
    scope: "该员工对此连接器的 write（含 read）",
    consequence: "该员工立即获得此连接器写入权。write 不等于发送、改阶段或解密旁路。审计留下授权记录。",
    confirmLabel: "确认授予 write",
  };
}

export function credentialRefConfirm(label: string, id = ""): AdminConfirmCopy {
  return {
    kind: "credential-ref",
    title: "更新凭据引用",
    object: named(label, id),
    scope: "组织连接器 credential_ref · 位置标识，不是秘密原值",
    consequence: "新引用立即生效。本页不回显原值。旧引用不再被本组织使用，秘密本身不在此删除。",
    confirmLabel: "确认更新引用",
  };
}

export function retentionPolicyConfirm(sessionDays: number, auditDays: number): AdminConfirmCopy {
  return {
    kind: "retention-policy",
    title: "保存留存策略",
    object: `会话 ${sessionDays} 天 · 审计 ${auditDays} 天`,
    scope: "组织数据留存 · 会话与治理审计",
    consequence: "新策略立即生效。短于当前天数的数据可能按策略被清理。分享链接过期规则仍按现有摘要。",
    confirmLabel: "确认保存策略",
  };
}

export function skillUnpublishConfirm(title: string, id = ""): AdminConfirmCopy {
  return {
    kind: "skill-unpublish",
    title: "下架技能",
    object: named(title, id),
    scope: "员工技能目录可见性 · 不是删除技能包",
    consequence: "员工技能目录不再出现此项。已打开的会话不受影响。可再次上架。",
    confirmLabel: "确认下架",
  };
}

export function knowledgeProposalRejectConfirm(title: string): AdminConfirmCopy {
  return {
    kind: "proposal-reject",
    title: "否决隔离提案",
    object: named(title),
    scope: "知识演化隔离队列 · 不会改线上技能说明",
    consequence: "提案留档为已否决。必须填写否决原因，不能用固定「否决保留」。线上邮件与技能说明不变。",
    confirmLabel: "确认否决",
    requireReason: true,
    reasonLabel: "否决原因",
    reasonPlaceholder: "说明为何否决，将写入提案记录",
  };
}

export function memoryDeleteConfirm(title: string, scopeLabel = "仅自己"): AdminConfirmCopy {
  return {
    kind: "memory-delete",
    title: "删除记忆",
    object: named(title),
    scope: `本账号 Markdown 记忆 · ${scopeLabel}`,
    consequence: "这条记忆立即从任务上下文移除，不可恢复。已完成的任务结果不受影响。",
    confirmLabel: "确认删除",
  };
}

export function sessionDeleteConfirm(title: string): AdminConfirmCopy {
  return {
    kind: "session-delete",
    title: "删除会话",
    object: named(title),
    scope: "该会话的消息、草稿、运行箱与可归属附件",
    consequence: "会话从工作台移除，不可恢复。合规迁移记录保留。",
    confirmLabel: "确认删除",
  };
}

export function starryUnbindConfirm(mailbox = "", owner = ""): AdminConfirmCopy {
  return {
    kind: "starry-unbind",
    title: "解除跟进邮箱绑定",
    object: named(mailbox || "已绑定的跟进邮箱", owner),
    scope: "当前账号的个人跟进邮箱绑定",
    consequence: "首页「我跟进的红人」不再按该邮箱过滤。组织连接器与已发出的邮件不受影响。可再次绑定。",
    confirmLabel: "确认解除",
  };
}
