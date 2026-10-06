/**
 * 平台后台作业的执行身份（ADR 待登记：后台作业执行身份）。
 *
 * - `agent:platform-sync`：平台系统智能体，只装配只读技能，不对应任何人员，不能绑定到组织或人员。
 * - `system:platform-sync`：只能使用上面这个智能体的系统主体；人员（含管理员）都不能使用该智能体。
 *
 * 后台同步因此走与员工相同的「智能体 → 技能 → 连接器 → 工具」挂载与风险档校验，
 * 撤掉挂载或停用智能体都会让同步如实失败，而不是由 Host 直连远端绕过。
 */
export const PLATFORM_SYNC_AGENT = "agent:platform-sync";
export const PLATFORM_PRINCIPAL = "system:platform-sync";
/** 平台系统智能体出厂装配的只读技能；管理端可以停用，不会被启动迁移复活。 */
export const PLATFORM_SYNC_SKILLS = ["creator_library_all"] as const;

export function isPlatformPrincipal(userId: string | null | undefined): boolean {
  return userId === PLATFORM_PRINCIPAL;
}

export function isPlatformAgent(agentId: string | null | undefined): boolean {
  return agentId === PLATFORM_SYNC_AGENT;
}
