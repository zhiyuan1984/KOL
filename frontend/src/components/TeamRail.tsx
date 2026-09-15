import { Link } from "react-router-dom";
import { useAgentManifest } from "../hooks/useAgentManifest";

export type TeamProgress = { teamId: string; stepIndex: number };

export function readTeamProgress(sessionId?: string): TeamProgress | null {
  if (!sessionId) return null;
  const raw = sessionStorage.getItem(`team:${sessionId}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as TeamProgress;
    if (!parsed?.teamId) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Unimplemented #3 数字团队 chrome. Chat must not mount this until the surface exists. */
export default function TeamRail({ progress }: { progress: TeamProgress }) {
  const manifest = useAgentManifest();
  const team = manifest?.teams.find((row) => row.id === progress.teamId);
  if (!team) return null;
  return (
    <div className="team-rail" data-team-rail={team.id} aria-label={`${team.title} 进度`}>
      <Link to="/agents" className="team-rail-title">{team.title}</Link>
      <ol>
        {team.steps.map((step, index) => {
          const state = index < progress.stepIndex ? "done" : index === progress.stepIndex ? "current" : "idle";
          return (
            <li key={step.skillId} data-state={state} title={step.label}>
              <i>{index + 1}</i>
              <span>{step.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
