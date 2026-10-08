import { Link } from "react-router-dom";
import type { TaskResultCard, TaskResultMetric, TaskResultSection } from "../api";
import { ResultDraftPreview, storeComposerDraft } from "./ChatBlocks";
import Markdown from "./Markdown";
import { SuggestedFollowTags } from "./FollowStyleTags";
import { fieldLabel } from "../labels";
import { stripEngineCopy } from "../employeeCopy";

function displayValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(displayValue).filter(Boolean).join(" · ");
  return Object.entries(value as Record<string, unknown>)
    .map(([key, item]) => `${fieldLabel(key)}：${displayValue(item)}`)
    .join(" · ");
}

function actionPrompt(
  action: string | { label?: string; title?: string; description?: string; prompt?: string; href?: string },
  index: number,
): { label: string; prompt: string; href?: string } {
  if (typeof action === "string") return { label: action, prompt: action };
  const label = action.label || action.title || action.description || `建议 ${index + 1}`;
  return { label, prompt: action.prompt || action.description || label, href: action.href };
}

export function isComposeResultCard(card: TaskResultCard): boolean {
  const title = String(card.title || "");
  if (title === "邮件草稿" || title === "邮件已发送" || title === "写合作邮件") return true;
  if (card.subject || card.body || card.draft_id || card.draft) return true;
  if (card.compose_loop && typeof card.compose_loop === "object") return true;
  const sections = Array.isArray(card.sections) ? card.sections : [];
  return sections.some((section) => {
    const name = String(section.title || section.heading || "");
    if (/收发说明|预览正文|已发正文|往来依据|本封要点|建联要点|跟进要点|评估要点|报价要点|谈判要点|方案要点|合同要点|寄样资料|发货要点|测试要点|内容要点|审核要点|排期要点|发布要点|结算要点/.test(name)) return true;
    const blob = `${name} ${JSON.stringify(section.items || [])}`;
    return name === "摘要数据" && /发件邮箱|邮件主题|state：SENT|SYNC_SENT/.test(blob);
  });
}

const COMPOSE_INTERMEDIATE_SECTION = /^(KOL 智能体|本阶段 SOP|生命周期|收发说明|预览正文|已发正文|往来依据|本封要点|建联要点|跟进要点)$/;

function composeResultSections(card: TaskResultCard, sections: TaskResultSection[]): TaskResultSection[] {
  if (!isComposeResultCard(card)) return sections;
  return sections.filter((section) => {
    const title = String(section.title || section.heading || "");
    if (title === "摘要数据") return false;
    return !COMPOSE_INTERMEDIATE_SECTION.test(title);
  });
}

function composeResultSummary(card: TaskResultCard, stacked: boolean): string {
  const summary = String(card.summary || "").trim();
  if (!summary) return "";
  if (stacked && /确认发送|发送不等于|发送\s*≠/.test(summary)) return "";
  return summary;
}

export function composeResultActions(
  card: TaskResultCard,
  actions: Array<string | { label?: string; title?: string; description?: string; prompt?: string; href?: string }>,
): Array<string | { label?: string; title?: string; description?: string; prompt?: string; href?: string }> {
  if (!isComposeResultCard(card)) return actions;
  const gap = card.compose_loop && typeof card.compose_loop === "object" ? card.compose_loop.gap : null;
  const cleaned = actions.filter((action) => {
    const label = typeof action === "string" ? action : (action.label || action.title || action.prompt || "");
    return !/补全发件|后再执行|记状态|费用审批|提出阶段变更/.test(label);
  });
  if (cleaned.length) return cleaned;
  if (String(card.title || "") === "邮件已发送") return ["再写一封"];
  if (gap && gap.field) {
    return [{ label: gap.result_action || gap.label || "补全后再确认发送", prompt: gap.prompt || "", title: gap.label }];
  }
  return ["核对预览后回复「确认发送」"];
}

export function ResultActions({
  actions,
  sessionId,
  onPrefill,
}: {
  actions: Array<string | { label?: string; title?: string; description?: string; prompt?: string; href?: string }>;
  sessionId: string;
  onPrefill?: (text: string) => void;
}) {
  if (!actions.length) return null;
  return (
    <section className="result-actions">
      <h3>可补全</h3>
      <ol>
        {actions.map((action, index) => {
          const item = actionPrompt(action, index);
          return (
            <li key={index}>
              {item.href ? (
                <Link to={item.href}>{item.label}</Link>
              ) : onPrefill ? (
                <button
                  type="button"
                  onClick={() => {
                    storeComposerDraft(sessionId, { text: item.prompt });
                    onPrefill(item.prompt);
                  }}
                >
                  {item.label}
                </button>
              ) : item.label}
              {typeof action !== "string" && action.description && (action.label || action.title) && <small>{action.description}</small>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function GenericResultArtifact({
  card,
  sessionId,
  onPrefill,
  stacked = false,
  collaborationId,
  handle,
  onRefresh,
  showDraftPreview = true,
}: {
  card: TaskResultCard;
  sessionId: string;
  onPrefill?: (text: string) => void;
  stacked?: boolean;
  collaborationId?: string;
  handle?: string;
  onRefresh?: () => void;
  showDraftPreview?: boolean;
}) {
  // 结果卡在中栏时间流里渲染，走同一套员工面清洗（DESIGN §15）：模型写的引擎名与技能 id 不外泄。
  const rawSections: TaskResultSection[] = Array.isArray(card.sections)
    ? card.sections
    : Object.entries(card.sections || {}).map(([title, content]) => ({
        title,
        content: displayValue(content),
      }));
  const sections = composeResultSections(card, rawSections).filter((section) => section.title !== "建议跟进标签" && section.heading !== "建议跟进标签");
  const metrics: TaskResultMetric[] = Array.isArray(card.metrics)
    ? card.metrics
    : Object.entries(card.metrics || {}).map(([label, value]) => ({ label, value }));
  const rawActions = card.recommended_actions || card.actions || [];
  const actions = composeResultActions(
    card,
    card.suggested_follow_tags?.length
      ? rawActions.filter((action) => !/打标签/.test(typeof action === "string" ? action : String(action.prompt || action.label || "")))
      : rawActions,
  );
  const summary = stripEngineCopy(composeResultSummary(card, stacked));
  const followTags = card.suggested_follow_tags || [];
  const draftPreview = (
    <ResultDraftPreview card={card as Record<string, unknown>} onRefresh={onRefresh} />
  );
  if (stacked && isComposeResultCard(card) && !summary && !metrics.length && !sections.length && !followTags.length && !card.subject && !card.body && !card.draft_id) {
    return null;
  }

  return (
    <article className="artifact task-result" data-kind="task-result-card">
      <header>
        {stacked ? null : <div className="page-kicker">任务结果</div>}
        {stacked && isComposeResultCard(card) ? null : <h2>{stripEngineCopy(String(card.title || "分析结果"))}</h2>}
        {summary ? <p className="task-result-summary">{summary}</p> : null}
      </header>
      {showDraftPreview ? draftPreview : null}
      {metrics.length > 0 && (
        <dl className="result-metrics">
          {metrics.map((metric, index) => (
            <div key={`${metric.label || metric.name}-${index}`}>
              <dt>{stripEngineCopy(metric.label || metric.name ? fieldLabel(String(metric.label || metric.name)) : `指标 ${index + 1}`)}</dt>
              <dd>{stripEngineCopy(displayValue(metric.value))}</dd>
              {(metric.detail || metric.change != null) && <small>{stripEngineCopy(metric.detail || displayValue(metric.change))}</small>}
            </div>
          ))}
        </dl>
      )}
      {sections.map((section, index) => (
        <section className="result-section" key={`${section.title || section.heading}-${index}`}>
          <h3>{stripEngineCopy(String(section.title || section.heading || `详情 ${index + 1}`))}</h3>
          {(section.content || section.body || section.summary) && <Markdown>{stripEngineCopy(String(section.content || section.body || section.summary || ""))}</Markdown>}
          {section.items && (
            <ul>
              {section.items.map((item, itemIndex) => <li key={itemIndex}>{stripEngineCopy(displayValue(item))}</li>)}
            </ul>
          )}
        </section>
      ))}
      {stacked ? null : <ResultActions actions={actions} sessionId={sessionId} onPrefill={onPrefill} />}
      <SuggestedFollowTags
        tags={(card.suggested_follow_tags || []).map((tag) => ({
          id: String(tag.id || tag.label || ""),
          label: String(tag.label || tag.id || ""),
          reason: tag.reason,
        }))}
        collaborationId={collaborationId}
        sessionId={sessionId}
        handle={handle}
        onPrefill={onPrefill}
        onApplied={() => onRefresh?.()}
      />
    </article>
  );
}
