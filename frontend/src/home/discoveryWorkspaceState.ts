import type { SkillTemplate, Task } from "../api";
import type { DiscoveryBrief } from "./discoveryTemplate";

export type DiscoveryWorkspaceState = {
  kind: "discovery"; version: 1; agent_id: string; profile: "lead";
  brief: DiscoveryBrief; template: SkillTemplate; submitted_text: string;
};
export function discoveryWorkspaceOf(task: Task | null): DiscoveryWorkspaceState | null {
  const input = task?.input;
  if (!input || typeof input !== "object") return null;
  const value = (input as Record<string, unknown>).discovery_workspace as DiscoveryWorkspaceState | undefined;
  return value?.kind === "discovery" && value.version === 1 && value.profile === "lead"
    && value.brief && Array.isArray(value.brief.platforms) ? value : null;
}
