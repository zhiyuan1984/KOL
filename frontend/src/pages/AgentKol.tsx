import { Link } from "react-router-dom";
import {
  expertCanHelpCopy,
  expertMissionCopy,
  expertPromptExamples,
  expertRoleCopy,
  type Expert,
} from "../experts";

export default function AgentKol({
  expert,
  busy,
  error,
  onSummon,
}: {
  expert: Expert;
  busy: boolean;
  error?: string;
  onSummon: (expert: Expert, prompt?: string) => void;
}) {
  const mission = expertMissionCopy(expert);
  const role = expertRoleCopy(expert);
  const canHelp = expertCanHelpCopy(expert);
  const prompts = expertPromptExamples(expert);

  return (
    <div className="list-page agent-page expert-page" data-expert-page="kol" data-expert-kind="business">
      <div className="expert-hero">
        <Link className="expert-back" to="/agents">← 数字员工</Link>
        <div className="expert-hero-row">
          <div className="expert-hero-copy">
            <h1>{expert.name}</h1>
            {role && role !== expert.name ? <p className="muted">{role}</p> : null}
          </div>
          <div className="expert-hero-actions">
            <button
              type="button"
              className="btn work"
              data-expert-summon={expert.id}
              data-expert-primary={expert.id}
              disabled={busy}
              onClick={() => onSummon(expert)}
            >
              {busy ? "正在开始…" : "开始工作"}
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="error" role="alert">
          <p>{error}</p>
        </div>
      ) : null}

      <article className="expert-detail" data-expert-detail={expert.id} data-expert-qa={expert.id}>
        <section>
          <h2>岗位使命</h2>
          <p>{mission}</p>
        </section>
        <section>
          <h2>岗位说明</h2>
          <p>{expert.working_style || role}</p>
        </section>
        {canHelp.length > 0 && (
          <section>
            <h2>可以帮你</h2>
            <ul className="expert-help-list">
              {canHelp.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>
        )}
        <section data-expert-home-links>
          <h2>今天的工作</h2>
          <div className="expert-work-links">
            <Link className="btn ghost" to="/" data-expert-link="today">今日任务</Link>
            <Link className="btn ghost" to="/?tab=todo" data-expert-link="todo">我的待办</Link>
          </div>
        </section>
        {prompts.length > 0 && (
          <section data-expert-prompts>
            <h2>你可以这样说</h2>
            <div className="expert-prompt-chips">
              {prompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className="expert-prompt"
                  data-expert-prompt={expert.id}
                  disabled={busy}
                  onClick={() => onSummon(expert, prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </section>
        )}
      </article>
    </div>
  );
}
