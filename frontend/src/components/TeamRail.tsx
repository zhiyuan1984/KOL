import { Link } from "react-router-dom";
import { AGENT_TEAMS, REMOTE_BACKEND_LABEL, remoteForSkill } from "../agentConfig";

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

export default function TeamRail({ progress }: { progress: TeamProgress }) {
  const team = AGENT_TEAMS.find((row) => row.id === progress.teamId);
  if (!team) return null;
  return (
    <div className="team-rail" data-team-rail={team.id} aria-label={`${team.title} 进度`}>
      <Link to="/teams" className="team-rail-title">{team.title}</Link>
      <ol>
        {team.steps.map((step, index) => {
          const state = index < progress.stepIndex ? "done" : index === progress.stepIndex ? "current" : "idle";
          return (
            <li key={step.skillId} data-state={state} title={`${step.label} · ${REMOTE_BACKEND_LABEL[remoteForSkill(step.skillId)]}`}>
              <i>{index + 1}</i>
              <span>{step.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
