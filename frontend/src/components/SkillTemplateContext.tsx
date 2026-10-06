import type { SkillTemplate } from "../api";
import { NO_REQUIRED_INPUTS_COPY } from "../skillTemplate";
import "./skill-template-context.css";

/**
 * Read-only presentation of the SKILL.md interaction contract. It deliberately
 * describes expected steps rather than reporting any execution state.
 */
export default function SkillTemplateContext({
  template,
  className = "",
  showOptionalInputs = true,
}: {
  template: SkillTemplate;
  className?: string;
  /** Parameter editors render these in a collapsed form; avoid a duplicate list. */
  showOptionalInputs?: boolean;
}) {
  const optionalInputs = template.inputs.filter((field) => !field.required);
  const outputTitle = String(template.output?.title || template.output?.type || "任务结果").trim();
  const noRequiredInputs = !template.inputs.some((field) => field.required);

  return (
    <section
      className={`skill-template-context ${className}`.trim()}
      data-skill-template-context={template.id}
      data-skill-template-version={template.version}
      aria-label={`${template.title}技能交互模板`}
    >
      <header className="skill-template-context-head">
        <span className="skill-template-context-kicker">技能交互模板 · 只读</span>
        <strong>{template.title}</strong>
      </header>
      <div className="skill-template-context-grid">
        <section>
          <h2>功能</h2>
          <p>{template.description || "按已发布技能契约处理你的请求。"}</p>
        </section>
        <section>
          <h2>预计执行步骤</h2>
          {template.steps.length ? (
            <ol data-skill-template-steps>
              {template.steps.map((step, index) => <li key={`${index}:${step}`}>{step}</li>)}
            </ol>
          ) : (
            <p className="muted" data-skill-template-steps-empty>步骤未登记；发送后以实际任务状态为准。</p>
          )}
        </section>
        <section>
          <h2>输出说明</h2>
          <p>{outputTitle}</p>
        </section>
        {template.evidence?.length ? (
          <section data-skill-template-evidence>
            <h2>结果依据</h2>
            <ul>{template.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
          </section>
        ) : null}
        {template.decisions?.length ? (
          <section data-skill-template-decisions>
            <h2>需要你决定</h2>
            <ul>{template.decisions.map((item) => <li key={item}>{item}</li>)}</ul>
          </section>
        ) : null}
      </div>
      {noRequiredInputs ? <p className="skill-template-no-required" data-skill-template-no-required>{NO_REQUIRED_INPUTS_COPY}</p> : null}
      {showOptionalInputs && optionalInputs.length ? (
        <details className="skill-template-optional" data-skill-template-optional>
          <summary>可选条件（{optionalInputs.length}）</summary>
          <ul>
            {optionalInputs.map((field) => <li key={field.key}>{field.label}</li>)}
          </ul>
        </details>
      ) : null}
      {template.constraints.length ? (
        <details className="skill-template-constraints">
          <summary>使用边界</summary>
          <ul>{template.constraints.map((constraint) => <li key={constraint}>{constraint}</li>)}</ul>
        </details>
      ) : null}
      {template.recovery?.length ? (
        <details className="skill-template-constraints" data-skill-template-recovery>
          <summary>异常与恢复</summary>
          <ul>{template.recovery.map((item) => <li key={item}>{item}</li>)}</ul>
        </details>
      ) : null}
    </section>
  );
}
