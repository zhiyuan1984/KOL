import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import type { KnowledgeSearchResult, KnowledgeTrialLastTurn } from "../../api";
import {
  KB_DOC_ACTION,
  KB_DOC_EMPTY,
  KB_DOC_TRIAL_LEAD,
  formatKbTime,
  kbDocProgressText,
  kbDocStatusLabel,
} from "../../knowledgeCopy";
import { formatBytes, useKbData, type KbFeed } from "./shared";

/**
 * 非结构化库面板：资料清单（只读）+ 检索试算（PageIndex 直接给答案）。
 * 治理动作（上传/发布/归档/删除）只在「入库」与「待处置」视图出现。
 */
export default function UnstructuredBasePanel({ baseId, fail }: KbFeed & { baseId: string }) {
  const load = useCallback(async () => {
    const { documents } = await api.adminKnowledgeDocuments({ base: baseId });
    return { documents: documents || [] };
  }, [baseId]);
  const { data, loading } = useKbData(load, [baseId]);

  const documents = data?.documents || [];
  const published = useMemo(() => documents.filter((doc) => doc.status === "published"), [documents]);
  const pending = useMemo(() => documents.filter((doc) => doc.status === "pending_review"), [documents]);

  const [scope, setScope] = useState("");
  const [question, setQuestion] = useState("");
  const [auditPending, setAuditPending] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<KnowledgeSearchResult | null>(null);
  const [trialError, setTrialError] = useState("");
  /**
   * 实时上下文 P1：试算面板内会话状态（设计稿 §5.1，前端 state，不落库）。
   * turns 只保留明细，上一轮之外的更早轮次按 §5.2 R1 抽取式折进 historySummary。
   */
  const [turns, setTurns] = useState<KnowledgeTrialLastTurn[]>([]);
  const [historySummary, setHistorySummary] = useState("");

  // 换库即换会话：上文只属于当前库。
  useEffect(() => {
    setTurns([]);
    setHistorySummary("");
    setResult(null);
  }, [baseId]);

  const clearSession = useCallback(() => {
    setTurns([]);
    setHistorySummary("");
  }, []);

  const scopedDoc = documents.find((doc) => doc.id === scope) || null;
  const pendingScope = scopedDoc?.status === "pending_review";

  const runTrial = async () => {
    const query = question.trim();
    if (!query) {
      setTrialError("先写一个问题。");
      return;
    }
    setBusy(true);
    setTrialError("");
    setResult(null);
    try {
      const includePending = Boolean(pendingScope && auditPending);
      const lastTurn = turns.length ? turns[turns.length - 1] : null;
      const outcome = await api.adminKnowledgeSearch({
        query,
        base_id: baseId,
        ...(scope ? { doc_ids: [scope] } : {}),
        ...(includePending ? { include_pending: true } : {}),
        ...(lastTurn ? { last_turn: lastTurn, history_summary: historySummary } : {}),
      });
      setResult(outcome);
      // 会话推进：本轮明细入 turns，更早轮次按 R1（首句 + entities）折进摘要。
      const citations = Array.isArray(outcome.citations) ? outcome.citations : [];
      const entities = [
        ...citations.map((citation) => String(citation.title || citation.document || "").trim()),
        ...(outcome.rewrite?.resolved_entities || []),
      ].filter(Boolean);
      const newTurn: KnowledgeTrialLastTurn = {
        query,
        answer: String(outcome.answer || "").slice(0, 2000),
        entities: [...new Set(entities)].slice(0, 20),
        citations: citations.slice(0, 20).map((citation) => ({
          document: String(citation.document || ""),
          title: String(citation.title || ""),
        })),
      };
      const kept = [...turns, newTurn];
      if (kept.length > 1) {
        const folded = kept.slice(0, -1).map((turn) => {
          const firstSentence = turn.answer.split(/[。！？\n]/)[0]?.trim() || turn.query;
          const entityPart = turn.entities.length ? `（涉及：${turn.entities.slice(0, 5).join("、")}）` : "";
          return `问：${turn.query}；答：${firstSentence}${entityPart}`;
        });
        const merged = [historySummary, ...folded].filter(Boolean).join("\n");
        setHistorySummary(merged.slice(-1500));
      }
      setTurns(kept.slice(-8));
    } catch (cause) {
      setTrialError(cause instanceof Error ? cause.message : "试算失败");
      fail?.(cause, "试算失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <article className="panel" data-admin-kb-base-documents>
        <div className="admin-section-head">
          <div>
            <h2>资料</h2>
          </div>
          <span className="muted" role="status">{documents.length} 份</span>
        </div>
        {loading && !data ? <p className="muted" role="status">正在加载资料…</p> : null}
        {!documents.length && !loading ? <p className="muted">{KB_DOC_EMPTY.documents}</p> : null}
        {documents.map((doc) => {
          const progress = kbDocProgressText(doc);
          const status = String(doc.status || "");
          const chipClass = status === "published" ? "chip chip-ok" : status === "failed" ? "chip chip-warn" : "chip";
          return (
            <article className="admin-row" key={doc.id} data-admin-kb-doc={doc.id} data-admin-kb-doc-status={status}>
              <div>
                <strong>{doc.title}</strong>
                <p className="muted kbadmin-doc-meta">
                  {String(doc.media_type || "").toUpperCase()}
                  {" · "}{formatBytes(Number(doc.size_bytes || 0))}
                  {" · "}更新 {formatKbTime(doc.updated_at) || "—"}
                  {progress ? ` · ${progress}` : ""}
                </p>
              </div>
              <span className={chipClass} data-admin-kb-doc-status-chip={status}>{kbDocStatusLabel(status)}</span>
            </article>
          );
        })}
      </article>

      <article className="panel" data-admin-kb-trial>
        <div className="admin-section-head">
          <div>
            <h2>检索试算</h2>
            <p className="muted">{KB_DOC_TRIAL_LEAD}</p>
          </div>
        </div>
        <div className="kbadmin-toolbar kbadmin-trial-form" data-admin-kb-trial-form>
          <label className="field">范围
            <select data-admin-kb-trial-scope value={scope} onChange={(event) => setScope(event.target.value)}>
              <option value="">全部已发布（{published.length} 份）</option>
              {published.map((doc) => (
                <option key={doc.id} value={doc.id}>已发布 · {doc.title}</option>
              ))}
              {pending.map((doc) => (
                <option key={doc.id} value={doc.id}>待审 · {doc.title}（仅审核试算）</option>
              ))}
            </select>
          </label>
          <label className="field kbadmin-field-grow">问题
            <input
              data-admin-kb-trial-question
              value={question}
              placeholder="例如：这份资料的适用范围是什么？"
              onChange={(event) => setQuestion(event.target.value)}
            />
          </label>
          {pendingScope ? (
            <label className="field kbadmin-inline-check">
              <input
                type="checkbox"
                data-admin-kb-trial-pending-audit
                checked={auditPending}
                onChange={(event) => setAuditPending(event.target.checked)}
              />
              仅审核试算（单份待审资料）
            </label>
          ) : null}
          <button className="btn work" type="button" data-admin-kb-trial-run disabled={busy} onClick={() => void runTrial()}>
            {busy ? "试算中…" : KB_DOC_ACTION.trialRun}
          </button>
          {turns.length ? (
            <button className="link-button" type="button" data-admin-kb-trial-clear disabled={busy} onClick={clearSession}>
              清空上文（已记 {turns.length} 轮）
            </button>
          ) : null}
        </div>
        {trialError ? <p className="error" role="alert" data-admin-kb-trial-error>{trialError}</p> : null}
        {result ? (
          <section className="kbadmin-trial-result" data-admin-kb-trial-result>
            {result.rewrite?.rewrote && result.rewrite.used_question ? (
              <p className="muted" data-admin-kb-trial-rewrite>
                已结合上文改写为：「{result.rewrite.used_question}」
                {result.rewrite.resolved_entities.length ? `（${result.rewrite.resolved_entities.join("、")}）` : ""}
              </p>
            ) : null}
            <p className="kbadmin-trial-answer" data-admin-kb-trial-answer>{result.answer || "（空回答）"}</p>
            {result.citations.length ? (
              <ul className="kbadmin-trial-citations" data-admin-kb-trial-citations>
                {result.citations.map((citation, index) => (
                  <li
                    key={`${citation.engine_doc_id}-${citation.page}-${index}`}
                    data-admin-kb-trial-citation={citation.document_id || citation.engine_doc_id}
                  >
                    <span className="kbadmin-cite-tag">引用</span>
                    <span>{citation.title || citation.document}{citation.page ? ` · 第 ${citation.page} 页` : ""}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">本次没有引用。</p>
            )}
            {result.usage ? (
              <p className="muted kbadmin-trial-usage" data-admin-kb-trial-usage>
                用量：{String(result.usage.input_tokens ?? result.usage.prompt_tokens ?? "—")} 输入 / {String(result.usage.output_tokens ?? result.usage.completion_tokens ?? "—")} 输出 tokens
              </p>
            ) : null}
          </section>
        ) : null}
        {!result && !busy && !trialError ? <p className="muted">{KB_DOC_EMPTY.trial}</p> : null}
      </article>
    </>
  );
}
