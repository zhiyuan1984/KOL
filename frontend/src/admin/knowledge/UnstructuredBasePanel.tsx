import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import type { KnowledgeSearchResult } from "../../api";
import {
  KB_DOC_ACTION,
  KB_DOC_EMPTY,
  KB_DOC_QA_CONTEXT,
  KB_DOC_TRIAL_LEAD,
  formatKbTime,
  kbDocProgressText,
  kbDocStatusLabel,
} from "../../knowledgeCopy";
import type { QaRewriteDiagnostic, QaScope } from "../../../../shared/knowledge-qa.js";
import {
  applyQaMaintenance,
  createQaSession,
  failQaMaintenance,
  planQaMaintenance,
  qaScopeKey,
  qaSearchContext,
  type QaSession,
} from "./qaSession";
import { formatBytes, useKbData, type KbFeed } from "./shared";

type SearchOutcome = KnowledgeSearchResult & { rewrite?: QaRewriteDiagnostic };
type MaintenanceState = "idle" | "maintaining" | "degraded";

function copyScope(scope: QaScope): QaScope {
  return {
    base_id: scope.base_id,
    ...(scope.doc_ids?.length ? { doc_ids: [...scope.doc_ids] } : {}),
    ...(scope.include_pending ? { include_pending: true } : {}),
  };
}

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
  const [result, setResult] = useState<SearchOutcome | null>(null);
  const [trialError, setTrialError] = useState("");
  const [maintenanceState, setMaintenanceState] = useState<MaintenanceState>("idle");
  const [maintenanceMessage, setMaintenanceMessage] = useState("");
  const [session, setSession] = useState<QaSession>(() => createQaSession());

  const scopedDoc = documents.find((doc) => doc.id === scope) || null;
  const pendingScope = scopedDoc?.status === "pending_review";
  const includePending = Boolean(pendingScope && auditPending);
  const activeScope = useMemo<QaScope>(() => ({
    base_id: baseId,
    ...(scope ? { doc_ids: [scope] } : {}),
    ...(includePending ? { include_pending: true } : {}),
  }), [baseId, scope, includePending]);
  const activeScopeKey = useMemo(() => qaScopeKey(activeScope), [activeScope]);

  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const requestIdRef = useRef(0);
  const scopeKeyRef = useRef(activeScopeKey);
  const inFlightRef = useRef(false);
  const sessionRef = useRef<QaSession>(session);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** 清空只作逻辑取消：所有旧响应必须同时通过 scope、generation 和 requestId 三道校验。 */
  const resetContext = useCallback((nextScopeKey: string) => {
    scopeKeyRef.current = nextScopeKey;
    generationRef.current += 1;
    requestIdRef.current += 1;
    inFlightRef.current = false;
    const next = createQaSession();
    sessionRef.current = next;
    if (!mountedRef.current) return;
    setSession(next);
    setBusy(false);
    setResult(null);
    setTrialError("");
    setMaintenanceState("idle");
    setMaintenanceMessage("");
  }, []);

  /** effect 覆盖选择框变化；提交时还会同步一次，避免 effect 与快速点击竞态。 */
  const synchronizeScope = useCallback(() => {
    if (scopeKeyRef.current !== activeScopeKey) resetContext(activeScopeKey);
  }, [activeScopeKey, resetContext]);

  useLayoutEffect(() => {
    synchronizeScope();
  }, [synchronizeScope]);

  const runTrial = useCallback(async () => {
    synchronizeScope();
    const query = question.trim();
    if (!query) {
      if (mountedRef.current) setTrialError("先写一个问题。");
      return;
    }
    // disabled 只是体验；ref 才是同一会话快速双击/回车的幂等保护。
    if (inFlightRef.current) return;

    const scopeAtStart = copyScope(activeScope);
    const scopeKeyAtStart = activeScopeKey;
    const generationAtStart = generationRef.current;
    const requestAtStart = requestIdRef.current + 1;
    requestIdRef.current = requestAtStart;
    inFlightRef.current = true;
    const isCurrent = () => mountedRef.current
      && scopeKeyRef.current === scopeKeyAtStart
      && generationRef.current === generationAtStart
      && requestIdRef.current === requestAtStart;

    if (mountedRef.current) {
      setBusy(true);
      setTrialError("");
      setResult(null);
      setMaintenanceState("idle");
      setMaintenanceMessage("");
    }

    try {
      let outcome: SearchOutcome;
      try {
        outcome = await api.adminKnowledgeSearch({
          query,
          ...scopeAtStart,
          context: qaSearchContext(sessionRef.current, scopeAtStart),
        }) as SearchOutcome;
      } catch (cause) {
        if (isCurrent()) {
          const status = (cause as { status?: number } | null)?.status;
          if (status === 401 || status === 403) resetContext(scopeKeyAtStart);
          setTrialError(cause instanceof Error ? cause.message : "试算失败");
          fail?.(cause, "试算失败");
        }
        return;
      }

      if (!isCurrent()) return;
      // 回答、引用先呈现；维护只影响下一轮上下文，不能把 resolved_entities 当作回答实体。
      setResult(outcome);
      setMaintenanceState("maintaining");
      setMaintenanceMessage(KB_DOC_QA_CONTEXT.maintaining);
      const diagnostic = outcome.rewrite;
      const effectiveQuery = diagnostic?.effective_query || query;
      const plan = planQaMaintenance(sessionRef.current, scopeAtStart, {
        query,
        answer: String(outcome.answer || ""),
        citations: outcome.citations || [],
        effectiveQuery,
      });

      try {
        const maintained = await api.adminKnowledgeQaContext(plan.input);
        if (!isCurrent()) return;
        const next = applyQaMaintenance(sessionRef.current, plan, maintained);
        sessionRef.current = next;
        setSession(next);
        if (maintained.status === "degraded") {
          setMaintenanceState("degraded");
          setMaintenanceMessage(maintained.summary_truncated ? KB_DOC_QA_CONTEXT.compressionFailed : KB_DOC_QA_CONTEXT.degraded);
        } else {
          setMaintenanceState("idle");
          setMaintenanceMessage("");
        }
      } catch (cause) {
        if (!isCurrent()) return;
        const status = (cause as { status?: number } | null)?.status;
        if (status === 401 || status === 403) {
          resetContext(scopeKeyAtStart);
          setTrialError("权限已失效，已清空临时上下文。请重新登录或核对权限。");
          return;
        }
        const fallback = failQaMaintenance(sessionRef.current, plan);
        sessionRef.current = fallback.session;
        setSession(fallback.session);
        setMaintenanceState("degraded");
        setMaintenanceMessage(fallback.degradedSummary
          ? KB_DOC_QA_CONTEXT.compressionFailed
          : KB_DOC_QA_CONTEXT.maintenanceFailed
        );
      }
    } finally {
      // 旧请求 finally 绝不能解除新 scope / 新 generation 的 busy 状态。
      if (isCurrent()) {
        inFlightRef.current = false;
        setBusy(false);
      }
    }
  }, [activeScope, activeScopeKey, fail, question, resetContext, synchronizeScope]);

  const clearContext = useCallback(() => {
    // 对同一 scope 强制 generation 递增，以逻辑作废正在等待的 search / maintenance。
    resetContext(activeScopeKey);
  }, [activeScopeKey, resetContext]);

  const appliedRewrite = result?.rewrite?.status === "applied" ? result.rewrite : null;

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
          <button className="btn text" type="button" data-admin-kb-trial-clear onClick={clearContext}>
            {KB_DOC_QA_CONTEXT.clear}
          </button>
        </div>
        <p className="muted" data-admin-kb-trial-context>
          {session.turns.length ? KB_DOC_QA_CONTEXT.turns(session.turns.length) : KB_DOC_QA_CONTEXT.empty}
        </p>
        {maintenanceState === "maintaining" ? (
          <p className="muted" role="status" data-admin-kb-trial-context-status>{maintenanceMessage}</p>
        ) : null}
        {maintenanceState === "degraded" ? (
          <p className="muted" role="status" data-admin-kb-trial-context-status>{maintenanceMessage}</p>
        ) : null}
        {trialError ? <p className="error" role="alert" data-admin-kb-trial-error>{trialError}</p> : null}
        {result ? (
          <section className="kbadmin-trial-result" data-admin-kb-trial-result>
            <p className="kbadmin-trial-answer" data-admin-kb-trial-answer>{result.answer || "（空回答）"}</p>
            {appliedRewrite ? (
              <p className="muted" data-admin-kb-trial-effective-query>
                实际检索问题：{appliedRewrite.effective_query}
              </p>
            ) : null}
            {result.rewrite && !appliedRewrite ? (
              <p className="muted" data-admin-kb-trial-rewrite-status>
                {result.rewrite.status === "unchanged"
                  ? `未改写：${result.rewrite.reason || "按原问题检索"}`
                  : "上下文改写未采用，本次按原问题检索。"}
              </p>
            ) : null}
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
