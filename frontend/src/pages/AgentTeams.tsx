import { useNavigate } from "react-router-dom";
import { AGENT_TEAMS, REMOTE_BACKEND_LABEL, remoteForSkill } from "../agentConfig";
import { api } from "../api";
import { storePending } from "../components/ChatBlocks";
import { profileNameLabel } from "../labels";
import { useViewMode } from "../viewMode";

export default function AgentTeams() {
  const { debug } = useViewMode();
  const nav = useNavigate();

  const startTeam = async (teamId: string, stepIndex = 0) => {
    const team = AGENT_TEAMS.find((t) => t.id === teamId);
    if (!team) return;
    const step = team.steps[stepIndex] || team.steps[0];
    const title = `${team.title} · ${step.label}`;
    const ses = await api.createSession(title.slice(0, 24));
    storePending(ses.id, {
      text: step.prompt,
    });
    sessionStorage.setItem(`team:${ses.id}`, JSON.stringify({ teamId, stepIndex }));
    nav(`/s/${ses.id}`);
  };

  return (
    <div className="list-page agent-page">
      <div className="page-hero agent-hero">
        <div className="page-kicker">智能体</div>
        <h1>智能体团队</h1>
        <p className="muted">
          团队是合作之旅上的预设编组，不是群聊。每一步仍走已发布动作；发送不等于改阶段。
        </p>
      </div>
      <div className="team-grid">
        {AGENT_TEAMS.map((team) => (
          <article key={team.id} className="panel team-card" data-team={team.id}>
            <h2>{team.title}</h2>
            <p className="muted">{team.summary}</p>
            <p className="team-profiles">
              {team.profileIds.map((id) => (
                <span key={id} className="chip">{profileNameLabel(id)}</span>
              ))}
            </p>
            <ol className="team-steps">
              {team.steps.map((step, index) => (
                <li key={step.skillId} data-step={index}>
                  <span className="team-step-idx">{index + 1}</span>
                  <div>
                    <strong className="nowrap">{step.label}</strong>
                    {debug && <span className="muted remote-tag nowrap">{REMOTE_BACKEND_LABEL[remoteForSkill(step.skillId)]}</span>}
                    <p className="muted step-prompt">{step.prompt}</p>
                  </div>
                </li>
              ))}
            </ol>
            <button type="button" className="btn work" onClick={() => void startTeam(team.id, 0)}>
              用此团队开始
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}
