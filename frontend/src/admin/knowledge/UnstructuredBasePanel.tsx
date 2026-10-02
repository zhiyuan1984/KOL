import { useCallback, useMemo, useState } from "react";
import { api } from "../../api";
import type { KnowledgeSearchResult } from "../../api";
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
      const outcome = await api.adminKnowledgeSearch({
        query,
        base_id: baseId,
        ...(scope ? { doc_ids: [scope] } : {}),
        ...(includePending ? { include_pending: true } : {}),
      });
      setResult(outcome);
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
        </div>
        {trialError ? <p className="error" role="alert" data-admin-kb-trial-error>{trialError}</p> : null}
        {result ? (
          <section className="kbadmin-trial-result" data-admin-kb-trial-result>
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
