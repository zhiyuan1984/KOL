/** L3 confirm copy for admin destructive writes. Object / scope / consequence only. */

export type AdminConfirmTone = "danger" | "primary" | "work";
export type AdminConfirmFocus = "cancel" | "confirm" | "reason";

export type AdminConfirmCopy = {
  kind: AdminConfirmKind;
  title: string;
  object: string;
  scope: string;
  consequence: string;
  change?: string;
  approvalState?: string;
  ruleVersion?: string;
  mailBody?: string;
  confirmLabel: string;
  cancelLabel?: string;
  cancelHint?: string;
  requireReason?: boolean;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  confirmTone?: AdminConfirmTone;
  initialFocus?: AdminConfirmFocus;
};

export type AdminConfirmKind =
  | "user-deactivate"
  | "connector-disable"
  | "grant-revoke"
  | "grant-write"
  | "grant-read"
  | "knowledge-archive"
  | "knowledge-hard-delete"
  | "knowledge-publish"
  | "exam-publish"
  | "exam-assign"
  | "skill-delete"
  | "skill-publish"
  | "skill-list"
  | "skill-unpublish"
  | "skill-grant"
  | "approval-role"
  | "credential-ref"
  | "retention-policy"
  | "proposal-reject"
  | "pipeline-stage"
  | "approval-approve"
  | "approval-reject"
  | "approval-initiate"
  | "draft-send"
  | "memory-delete"
  | "session-delete"
  | "starry-unbind";

/** Admin-opened confirms: Cancel abandons the write. It is not Host-proposal 拒绝. */
export const ADMIN_CANCEL_LABEL = "取消，不执行";
export const ADMIN_CANCEL_HINT = "取消只关闭确认，不会写入，也不需要填原因。";

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

export function examPublishConfirm(title: string, version?: number): AdminConfirmCopy {
  const next = (version || 0) + 1;
  return {
    kind: "exam-publish",
    title: "发布考试题卷",
    object: named(title, `第 ${next} 版`),
    scope: "草稿题卷 → 已发布快照 · 员工作答与资格按此版本",
    consequence: "发布后才会写入快照并增加版本。草稿不能分配。前端自报通过不能成为授权依据。",
    confirmLabel: "确认发布",
    confirmTone: "primary",
  };
}

export function examAssignConfirm(title: string, userLabel: string): AdminConfirmCopy {
  return {
    kind: "exam-assign",
    title: "分配已发布考试",
    object: `${named(title)} → ${named(userLabel)}`,
    scope: "已发布题卷 · 该员工的必修资格",
    consequence: "该员工立即出现待完成考试。未发布草稿不能分配。合格只按服务端对已发布快照的判分。",
    confirmLabel: "确认分配",
    confirmTone: "primary",
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

export function grantReadConfirm(userLabel: string, connectorLabel: string): AdminConfirmCopy {
  return {
    kind: "grant-read",
    title: "授予连接器 read",
    object: `${named(userLabel)} × ${named(connectorLabel)}`,
    scope: "该员工对此连接器的 read（不含 write）",
    consequence: "该员工立即获得此连接器读取权。read 不等于发送、改阶段或解密旁路。审计留下授权记录。",
    confirmLabel: "确认授予 read",
  };
}

export function approvalRoleSaveConfirm(userLabel: string, roleLabels: string[]): AdminConfirmCopy {
  const roles = roleLabels.map((item) => item.trim()).filter(Boolean);
  return {
    kind: "approval-role",
    title: "保存审批角色",
    object: named(userLabel),
    scope: roles.length ? roles.join(" / ") : "未选择角色",
    consequence: "该员工立即按所选角色进入审批链。未勾选的角色立即失效。审计留下授权记录。",
    confirmLabel: "确认保存授权",
  };
}

export function skillGrantSaveConfirm(
  title: string,
  grants: { org: string[]; team: string[]; user: string[] },
): AdminConfirmCopy {
  return {
    kind: "skill-grant",
    title: "保存技能分配",
    object: named(title),
    scope: `组织 ${grants.org.length} · 团队 ${grants.team.length} · 个人 ${grants.user.length}`,
    consequence: "命中的组织、团队或个人立即可以使用该技能。未勾选的立即失去授权。审计留下分配记录。",
    confirmLabel: "确认保存分配",
  };
}

export function skillPublishConfirm(title: string, id = "", inMarket = true): AdminConfirmCopy {
  return {
    kind: "skill-publish",
    title: "发布技能并写入 Codex",
    object: named(title, id),
    scope: "运行时目录 · 下一轮 Codex turn 可 extraRoots / config/write",
    consequence: inMarket
      ? "技能写入运行时目录，并出现在员工技能目录。不是草稿预览。内置技能不受影响。"
      : "技能写入运行时目录，但不会出现在员工技能目录。可稍后上架。",
    confirmLabel: "确认发布",
  };
}

export function skillListConfirm(title: string, id = ""): AdminConfirmCopy {
  return {
    kind: "skill-list",
    title: "上架技能",
    object: named(title, id),
    scope: "员工技能目录可见性 · 不是新建技能包",
    consequence: "员工技能目录将出现此项。已打开的会话不受影响。可再次下架。",
    confirmLabel: "确认上架",
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
    cancelLabel: "取消，不否决",
    cancelHint: "取消只关闭确认，不会否决提案。否决必须点确认并填写原因。",
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
    requireReason: true,
    reasonLabel: "拒绝原因",
    reasonPlaceholder: "关闭或取消删除前，说明为什么不继续",
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
    requireReason: true,
    reasonLabel: "拒绝原因",
    reasonPlaceholder: "关闭或取消删除前，说明为什么不继续",
  };
}

export function approvalDecideConfirm(input: {
  decision: "approve" | "reject";
  object: string;
  scope: string;
  consequence: string;
  change?: string;
  approvalState?: string;
  ruleVersion?: string;
}): AdminConfirmCopy {
  const reject = input.decision === "reject";
  return {
    kind: reject ? "approval-reject" : "approval-approve",
    title: reject ? "确认驳回？" : "确认同意？",
    object: input.object,
    scope: input.scope,
    change: input.change,
    consequence: input.consequence,
    approvalState: input.approvalState,
    ruleVersion: input.ruleVersion,
    confirmLabel: reject ? "确认驳回" : "确认同意",
    confirmTone: reject ? "danger" : "primary",
    requireReason: reject,
    reasonLabel: "驳回原因",
    reasonPlaceholder: "说明为什么驳回",
    initialFocus: reject ? "reason" : "confirm",
    cancelHint: "取消只关闭确认，不会写入，也不需要填原因。",
  };
}

export function approvalInitiateConfirm(input: {
  object: string;
  scope: string;
  change: string;
  consequence: string;
  approvalState?: string;
  ruleVersion?: string;
}): AdminConfirmCopy {
  return {
    kind: "approval-initiate",
    title: "确认提交费用审批？",
    object: input.object,
    scope: input.scope,
    change: input.change,
    consequence: input.consequence,
    approvalState: input.approvalState,
    ruleVersion: input.ruleVersion,
    confirmLabel: "确认提交",
    confirmTone: "primary",
    initialFocus: "confirm",
    cancelHint: "取消只关闭确认，不会提交。",
  };
}

export function draftSendConfirm(input: { from?: string; to?: string; cc?: string; subject?: string; body?: string }): AdminConfirmCopy {
  const from = String(input.from || "").trim() || "未指定发件邮箱";
  const to = String(input.to || "").trim() || "未指定收件邮箱";
  const subject = String(input.subject || "").trim() || "无主题";
  return {
    kind: "draft-send",
    title: "确认发送原文",
    object: `${from} → ${to} · ${subject}`,
    scope: `外发 SMTP · 英文原文（内部中文不发送）${input.cc ? ` · 抄送：${input.cc}` : " · 无抄送"}`,
    mailBody: input.body,
    consequence: "确认后将真正发出以下版本的邮件。发送不会推进正式阶段；若回执不确定，将停止重复发送并提示核对。",
    confirmLabel: "确认发送",
    confirmTone: "work",
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
    requireReason: true,
    reasonLabel: "拒绝原因",
    reasonPlaceholder: "关闭或取消解除前，说明为什么不继续",
  };
}
