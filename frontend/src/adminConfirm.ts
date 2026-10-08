/** L3 confirm copy for admin destructive writes. Object / scope / consequence only. */

export type AdminConfirmTone = "danger" | "primary" | "work";
export type AdminConfirmFocus = "cancel" | "confirm" | "reason";

export type AdminConfirmCopy = {
  kind: AdminConfirmKind;
  title: string;
  object: string;
  scope: string;
  consequence: string;
  /** 人员紧凑布局：姓名与邮箱同行，范围与影响分行（员工停用等确认卡）。 */
  person?: { name: string; email?: string };
  /** 紧凑布局的范围行前缀，如「停用范围」；缺省「范围」。 */
  scopeLabel?: string;
  /** 紧凑布局的次要说明行：保留项与可恢复入口。 */
  note?: string;
  change?: string;
  approvalState?: string;
  ruleVersion?: string;
  mailBody?: string;
  confirmLabel: string;
  cancelLabel?: string;
  cancelHint?: string;
  requireReason?: boolean;
  /** 可选输入：展示原因/说明输入框，但不强制填写。 */
  reasonOptional?: boolean;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  /** 执行中按钮文案，如「停用中…」；缺省仍为「执行中…」。 */
  busyLabel?: string;
  confirmTone?: AdminConfirmTone;
  initialFocus?: AdminConfirmFocus;
};

export type AdminConfirmKind =
  | "work-order-binding"
  | "work-order-publish"
  | "work-order-disable"
  | "work-order-automation"
  | "review-command"
  | "user-deactivate"
  | "employee-tool-grants"
  | "connector-disable"
  | "grant-revoke"
  | "grant-write"
  | "grant-read"
  | "knowledge-archive"
  | "knowledge-hard-delete"
  | "knowledge-publish"
  | "knowledge-document-publish"
  | "knowledge-document-archive"
  | "knowledge-document-delete"
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
  | "starry-unbind"
  | "knowledge-rollback"
  | "knowledge-binding-delete"
  | "skill-declared-mount"
  | "skill-stage"
  | "skill-rollback"
  | "agent-publish"
  | "agent-disable"
  | "agent-binding-revoke"
  | "agent-knowledge-unbind";

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
  const personName = String(name || "").trim() || "未命名";
  const personEmail = String(email || "").trim();
  return {
    kind: "user-deactivate",
    title: "停用员工",
    object: named(personName, personEmail),
    person: personEmail ? { name: personName, email: personEmail } : { name: personName },
    scopeLabel: "停用范围",
    scope: "组织账号 · 登录与工作台授权",
    consequence: "停用后立即无法登录或使用工作台。",
    note: "已发邮件与审计记录保留，可在本页再次启用。",
    cancelLabel: "取消",
    confirmLabel: "确认停用",
    busyLabel: "停用中…",
  };
}

export function employeeToolGrantsConfirm(input: {
  name: string;
  email?: string;
  added: string[];
  revoked: string[];
}): AdminConfirmCopy {
  const changes = [
    input.added.length ? `授予：${input.added.join("、")}` : "",
    input.revoked.length ? `停用：${input.revoked.join("、")}` : "",
  ].filter(Boolean).join("；") || "授权范围不变";
  return {
    kind: "employee-tool-grants",
    title: "保存员工工具授权",
    object: named(input.name, input.email),
    scope: "员工个人 · 已发布工具",
    change: changes,
    consequence: "新增工具立即按现有运行时策略生效；被停用的工具将无法再由该员工调用。连接器、数据范围和高风险动作仍受原有闸门约束。",
    confirmLabel: "确认保存授权",
    confirmTone: "primary",
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

/**
 * 按技能定义挂载连接器工具。挂载是治理写入，必须显式确认并留回执；
 * 跳过项（策略未启用 / 连接器未登记）在确认里先讲清楚，不事后解释。
 */
export function skillDeclaredMountConfirm(input: {
  connectorLabel: string;
  connectorId?: string;
  skillCount: number;
  toolCount: number;
  skippedCount?: number;
}): AdminConfirmCopy {
  const skipped = input.skippedCount || 0;
  return {
    kind: "skill-declared-mount",
    title: "按技能定义挂载工具",
    object: `${named(input.connectorLabel, input.connectorId || "")} × ${input.skillCount} 个技能`,
    scope: `只挂这些技能在 SKILL.md 里声明的工具，共 ${input.toolCount} 个；且必须已登记并启用策略`,
    consequence: skipped
      ? `另有 ${skipped} 个声明工具不会挂载（策略未启用或连接器还没登记），需要逐项决定。挂载只授予这些技能调用该连接器的这些工具，不启用连接器本身。`
      : "挂载只授予这些技能调用该连接器的这些工具；不启用连接器本身，启用仍是独立动作。",
    confirmLabel: "确认挂载",
    confirmTone: "primary",
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

export function knowledgeDocumentPublishConfirm(title: string): AdminConfirmCopy {
  return {
    kind: "knowledge-document-publish",
    title: "发布资料到检索",
    object: named(title),
    scope: "待审资料 → 参与检索（管理端试算与后续 Worker 通道）",
    consequence: "发布后该资料参与检索问答；未发布资料默认不参与。发布前可重新加工。",
    confirmLabel: "确认发布",
  };
}

export function knowledgeDocumentArchiveConfirm(title: string): AdminConfirmCopy {
  return {
    kind: "knowledge-document-archive",
    title: "归档资料",
    object: named(title),
    scope: "已发布资料 → 归档（不是删除）",
    consequence: "归档后不再参与检索；原文件与索引留在本机，可按需重新加工。",
    confirmLabel: "确认归档",
  };
}

export function knowledgeDocumentDeleteConfirm(title: string): AdminConfirmCopy {
  return {
    kind: "knowledge-document-delete",
    title: "删除资料",
    object: named(title),
    scope: "未发布资料 · 原文件与索引一并清理",
    consequence: "从资料库移除，并删除该资料的原文件、加工产物、索引和作业历史；审计记录保留。不能撤销，已发布过的资料只能归档。",
    confirmLabel: "确认删除",
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

export function draftSendConfirm(input: { from?: string; to?: string; cc?: string; subject?: string; body?: string }, evidence?: { version: string; sources: Array<{ mailbox: string; checked_at: string | null }> }): AdminConfirmCopy {
  const from = String(input.from || "").trim() || "未指定发件邮箱";
  const to = String(input.to || "").trim() || "未指定收件邮箱";
  const subject = String(input.subject || "").trim() || "无主题";
  return {
    kind: "draft-send",
    title: "确认发送原文",
    object: `${from} → ${to} · ${subject}`,
    scope: `外发 SMTP · 英文原文（内部中文不发送）${input.cc ? ` · 抄送：${input.cc}` : " · 无抄送"}`,
    mailBody: input.body,
    consequence: `${evidence ? `依据版本 ${evidence.version.slice(0, 12)}；来源：${evidence.sources.map(source => `${source.mailbox}（核验于 ${source.checked_at || "未知"}）`).join("、")}。相关邮件或合作阶段变化后需要重新确认。` : ""}确认后将真正发出以下版本的邮件。发送不会推进正式阶段；若回执不确定，将停止重复发送并提示核对。`,
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

export function knowledgeRollbackConfirm(title: string, fromVersion: number, toVersion: number): AdminConfirmCopy {
  const from = fromVersion > 0 ? `第 ${fromVersion} 版` : "当前版本";
  const to = toVersion > 0 ? `第 ${toVersion} 版` : "历史版本";
  return {
    kind: "knowledge-rollback",
    title: "回滚知识版本",
    object: named(title, `${from} → ${to}`),
    scope: "知识版本回滚",
    consequence: "以历史版本生成新草稿，需重新审批后才对员工生效；历史版本保留。",
    confirmLabel: "确认生成新草稿",
  };
}

export function knowledgeBindingDeleteConfirm(skillLabel: string, selectorSummary: string): AdminConfirmCopy {
  return {
    kind: "knowledge-binding-delete",
    title: "删除知识绑定",
    object: named(skillLabel, selectorSummary),
    scope: "技能与知识的绑定关系",
    consequence: "删除后该技能不再解析到这些知识。",
    confirmLabel: "确认删除",
  };
}

/** Agent 发布前清单：技能数/绑定数/覆盖人数均为服务端当前值。 */
export function agentPublishConfirm(input: {
  name: string;
  id?: string;
  enabledSkills: number;
  bindings: number;
  users: number;
  orgVersion: number;
}): AdminConfirmCopy {
  return {
    kind: "agent-publish",
    title: "发布 Agent",
    object: named(input.name, input.id || ""),
    scope: "草稿 → 已发布 · 员工按绑定范围可用",
    change: `启用技能 ${input.enabledSkills} 项 · 绑定点 ${input.bindings} 个 · 覆盖 ${input.users} 人（组织版本 ${input.orgVersion}）`,
    consequence: "发布后绑定范围内的员工立即可通过此 Agent 使用已启用技能。发布不扩大绑定范围；解绑与停用是独立动作。",
    confirmLabel: "确认发布",
    confirmTone: "primary",
  };
}

export function agentDisableConfirm(name: string, id = ""): AdminConfirmCopy {
  return {
    kind: "agent-disable",
    title: "停用 Agent",
    object: named(name, id),
    scope: "已发布 → 停用 · 不解除绑定",
    consequence: "停用后员工不能再通过此 Agent 使用技能；绑定与覆盖名单保留，可再次发布。",
    confirmLabel: "确认停用",
  };
}

/** 撤销绑定前先跑 revoke-preview，把将移除的人写进「变更」再确认。 */
export function agentBindingRevokeConfirm(input: {
  agentName: string;
  agentId?: string;
  targetLabel: string;
  removed: string[];
}): AdminConfirmCopy {
  const removed = input.removed.filter(Boolean);
  return {
    kind: "agent-binding-revoke",
    title: "撤销 Agent 绑定",
    object: `${named(input.agentName, input.agentId || "")} × ${input.targetLabel}`,
    scope: "绑定解绑 · 覆盖名单按组织树重算",
    change: removed.length ? `将移除 ${removed.length} 人：${removed.join("、")}` : "本次撤销不移除任何已覆盖人员",
    consequence: "这些人若不再被其他绑定覆盖，将立即失去该 Agent 的使用资格。撤销必须填写原因并写入审计。",
    confirmLabel: "确认撤销",
    requireReason: true,
    reasonLabel: "撤销原因",
    reasonPlaceholder: "说明为什么撤销该绑定",
    initialFocus: "reason",
  };
}

export function agentKnowledgeUnbindConfirm(input: {
  agentName: string;
  agentId?: string;
  skillLabel: string;
  baseLabel: string;
}): AdminConfirmCopy {
  return {
    kind: "agent-knowledge-unbind",
    title: "移除知识库依赖",
    object: `${input.skillLabel} × ${input.baseLabel}`,
    scope: `${named(input.agentName, input.agentId || "")} · 技能知识依赖`,
    consequence: "该技能的其他 Agent 共享此依赖：移除后所有装配该技能的 Agent 都不再解析这个知识库。可重新绑定。",
    confirmLabel: "确认移除",
  };
}

export function skillStageConfirm(input: {
  title: string;
  id?: string;
  from: string;
  to: string;
  needReason?: boolean;
}): AdminConfirmCopy {
  return {
    kind: "skill-stage",
    title: input.needReason ? "停用技能" : "推进技能阶段",
    object: named(input.title, input.id || ""),
    scope: `${input.from} → ${input.to}`,
    consequence: input.needReason
      ? "停用后员工不能再通过 Agent 使用此技能；版本与历史保留，可重新启用。必须填写原因并写入审计。"
      : "阶段推进立即写入技能生命周期；员工当前使用的已发布版本不会自动改变。",
    confirmLabel: input.needReason ? "确认停用" : "确认推进",
    confirmTone: input.needReason ? "danger" : "primary",
    requireReason: input.needReason,
    reasonLabel: "操作原因",
    reasonPlaceholder: "说明本次操作原因",
    initialFocus: input.needReason ? "reason" : "cancel",
  };
}

export function skillLifecyclePublishConfirm(title: string, id = ""): AdminConfirmCopy {
  return {
    kind: "skill-publish",
    title: "发布技能",
    object: named(title, id),
    scope: "测试验证 → 发布上线",
    consequence: "发布应用待发布草稿并生成版本快照，员工通过 Agent 使用新版本。发布不会自动授予任何人员权限。",
    confirmLabel: "确认发布",
    confirmTone: "primary",
  };
}

export function skillVersionPublishConfirm(title: string, id = ""): AdminConfirmCopy {
  return {
    kind: "skill-publish",
    title: "发布草稿并生成版本",
    object: named(title, id),
    scope: "未发布草稿 → 版本快照",
    consequence: "发布会应用待发布草稿并生成版本快照；员工通过 Agent 使用新版本。",
    confirmLabel: "确认发布",
    confirmTone: "primary",
    reasonOptional: true,
    reasonLabel: "版本说明（可选）",
    reasonPlaceholder: "填写本次版本说明",
    initialFocus: "confirm",
  };
}

export function skillVersionRollbackConfirm(title: string, version: number): AdminConfirmCopy {
  return {
    kind: "skill-rollback",
    title: "回滚技能版本",
    object: named(title, `→ v${version}`),
    scope: "历史版本快照覆盖当前技能包",
    consequence: `员工使用的版本回滚为 v${version}；当前未发布草稿会被历史快照覆盖，操作不可撤销。`,
    confirmLabel: "确认回滚",
  };
}
