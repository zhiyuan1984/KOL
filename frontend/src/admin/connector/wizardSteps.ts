export type WizardStep = "save" | "test" | "tools" | "enable";

/** 只要够判断起始步的字段，方便单测；ConnectorCardView 结构上兼容。 */
export type WizardCardState = { enabled?: boolean; status?: string };

/**
 * 弹窗从服务端记录的最近状态开始，而不是每次都回到「保存」：
 * 已启用或已验证 → 「启用」；验证失败 → 「测试」；其余（含新建）→ 「保存」。
 * 这样「测试通过、还没启用」的连接器再打开时直接落在可以完成的那一步。
 */
export function initialWizardStep(mode: "create" | "configure", card?: WizardCardState): WizardStep {
  if (mode === "create" || !card) return "save";
  if (card.enabled || card.status === "verified") return "enable";
  if (card.status === "verification_failed") return "test";
  return "save";
}
