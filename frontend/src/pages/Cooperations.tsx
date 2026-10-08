import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type KolCooperation, type KolCooperationDetailResponse } from "../api";
import { MAIN_STAGE_TABS, EXCEPTION_TAB } from "../kolStages";
import { randomUuid } from "../uuid";
import {
  apiErrorMessage, coopStageFullLabel, coopStageLabel, COOP_EVENT_OPTIONS, COOP_TYPE_LABELS, formatTime,
  workOrderStatusLabel,
} from "./kol-shared";
import "./kol-lead-coop.css";

const MAIN_ORDER = MAIN_STAGE_TABS.map((t) => t.code);
/** 相邻 +1 前进原因可选；跨段/回退/进出异常必须写原因（产品法）。 */
function moveNeedsReason(from: string, to: string): boolean {
  if (from === to) return false;
  const fi = MAIN_ORDER.indexOf(from);
  const ti = MAIN_ORDER.indexOf(to);
  if (fi >= 0 && ti === fi + 1) return false;
  return true;
}

function StageChip({ stage, exceptionKind }: { stage: string; exceptionKind?: string | null }) {
  const isException = stage === "exception";
  return <span className={`kol-stage-chip${isException ? " is-exception" : ""}`}>{coopStageLabel(stage, exceptionKind)}</span>;
}

export default function Cooperations() {
  const [stage, setStage] = useState("");
  const [mine, setMine] = useState(false);
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<KolCooperation[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<KolCooperationDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [advanceTo, setAdvanceTo] = useState("");
  const [advanceReason, setAdvanceReason] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const page = await api.kolCooperationList({ stage: stage || undefined, mine, search: search || undefined, limit: 50 });
      setRows(page.cooperations); setTotal(page.total);
    } catch (e) { setError(apiErrorMessage(e)); } finally { setLoading(false); }
  }, [stage, mine, search]);

  useEffect(() => { void load(); }, [load]);

  const openDetail = useCallback(async (id: string) => {
    setSelectedId(id); setDetailLoading(true); setAdvanceTo(""); setAdvanceReason("");
    try { setDetail(await api.kolCooperationDetail(id)); }
    catch (e) { setError(apiErrorMessage(e)); } finally { setDetailLoading(false); }
  }, []);

  const refreshDetail = useCallback(async () => {
    if (selectedId) await openDetail(selectedId);
    await load();
  }, [selectedId, openDetail, load]);

  const submitAdvance = async () => {
    if (!selectedId || !advanceTo || !detail) return;
    if (moveNeedsReason(detail.cooperation.coop_stage, advanceTo) && !advanceReason.trim()) {
      setError("跨阶段/回退/进出异常必须填写原因"); return;
    }
    setBusy("advance"); setError("");
    try {
      await api.kolCooperationUpdate(selectedId, {
        coop_stage: advanceTo,
        reason: advanceReason.trim() || undefined,
        exception_kind: advanceTo === "exception" ? "PAUSED" : undefined,
      });
      await refreshDetail();
    } catch (e) { setError(apiErrorMessage(e)); } finally { setBusy(""); }
  };

  const archive = async () => {
    if (!selectedId || !window.confirm("确认归档该项目吗？交付类与结算类工单必须全部完成。")) return;
    setBusy("archive"); setError("");
    try { await api.kolCooperationUpdate(selectedId, { action: "archive" }); setSelectedId(null); setDetail(null); await load(); }
    catch (e) { setError(apiErrorMessage(e)); } finally { setBusy(""); }
  };

  const cancel = async () => {
    if (!selectedId) return;
    const reason = window.prompt("取消原因（必填，将写入审计）：");
    if (reason == null || !reason.trim()) return;
    setBusy("cancel"); setError("");
    try { await api.kolCooperationUpdate(selectedId, { action: "cancel", reason: reason.trim() }); setSelectedId(null); setDetail(null); await load(); }
    catch (e) { setError(apiErrorMessage(e)); } finally { setBusy(""); }
  };

  return (
    <main className="kol-page" aria-label="合作项目">
      <div className="kol-page-head">
        <h1>合作项目</h1>
        <span className="kol-hint">共 {total} 个</span>
        <button type="button" className="btn primary" onClick={() => setShowCreate(true)}>新建合作</button>
      </div>
      {error ? <p className="kol-error" role="alert">{error}</p> : null}
      <div className="kol-filters">
        <div className="kol-search-row">
          <input className="kol-search" aria-label="搜索合作项目" placeholder="搜索项目标题 / 品牌" value={search}
            onChange={(e) => setSearch(e.target.value)} />
          <button type="button" className="kol-chip" aria-pressed={mine} onClick={() => setMine((v) => !v)}>只看我负责</button>
        </div>
        <div className="kol-chip-row" role="group" aria-label="阶段筛选">
          <span className="kol-chip-group-label">阶段</span>
          <button type="button" className="kol-chip" aria-pressed={stage === ""} onClick={() => setStage("")}>全部</button>
          {MAIN_STAGE_TABS.map((t) => (
            <button key={t.code} type="button" className="kol-chip" aria-pressed={stage === t.code}
              onClick={() => setStage(stage === t.code ? "" : t.code)} title={t.label}>{t.short}</button>
          ))}
          <button type="button" className="kol-chip" aria-pressed={stage === "exception"}
            onClick={() => setStage(stage === "exception" ? "" : "exception")}>异常</button>
        </div>
      </div>
      <div className="kol-layout">
        <div className="kol-list" role="listbox" aria-label="合作项目列表">
          {loading ? <p className="muted">加载中…</p> : rows.length === 0 ? <p className="muted">暂无合作项目</p> :
            rows.map((coop) => (
              <button key={coop.id} type="button" role="option" aria-selected={selectedId === coop.id}
                className="kol-row" onClick={() => void openDetail(coop.id)}>
                <span className="kol-row-top">
                  {coop.blocked_work_order_count != null && coop.blocked_work_order_count > 0
                    ? <span className="kol-block-dot" title="有阻塞工单" /> : null}
                  <strong>{coop.title}</strong>
                  <StageChip stage={coop.coop_stage} exceptionKind={coop.exception_kind} />
                </span>
                <span className="kol-row-meta">
                  <span>{coop.lead_display_name || ""}（{coop.lead_platform || ""}）</span>
                  {coop.budget_amount ? <span>预算 {coop.budget_amount} {coop.currency}</span> : null}
                  {coop.open_work_order_count != null && coop.open_work_order_count > 0
                    ? <span>未完成工单 {coop.open_work_order_count}</span> : null}
                </span>
              </button>
            ))}
        </div>
        <div className="kol-detail" aria-live="polite">
          {detailLoading ? <p className="muted">加载中…</p> : !detail ? <p className="kol-empty">选择一个项目查看推进动态</p> : (
            <>
              <div className="kol-detail-head">
                <h2>{detail.cooperation.title}</h2>
                <div className="kol-row-meta">
                  {detail.lead ? <span>达人 <Link to={`/leads`} onClick={(e) => e.stopPropagation()}>{detail.lead.display_name}</Link>（{detail.lead.platform}）</span> : null}
                  <span>类型 {COOP_TYPE_LABELS[detail.cooperation.coop_type] || detail.cooperation.coop_type}</span>
                </div>
              </div>
              <dl className="kol-meta-grid">
                <div><dt>阶段</dt><dd><StageChip stage={detail.cooperation.coop_stage} exceptionKind={detail.cooperation.exception_kind} />
                  <span className="kol-hint">（{coopStageFullLabel(detail.cooperation.coop_stage)}）</span></dd></div>
                <div><dt>品牌</dt><dd>{detail.cooperation.brand || "—"}</dd></div>
                <div><dt>预算</dt><dd>{detail.cooperation.budget_amount ? `${detail.cooperation.budget_amount} ${detail.cooperation.currency}` : "—"}</dd></div>
                <div><dt>更新时间</dt><dd>{formatTime(detail.cooperation.updated_at)}</dd></div>
              </dl>
              {detail.cooperation.brand || detail.cooperation.budget_amount ? (
                <section className="kol-section" aria-label="商务条款">
                  <h3>商务条款</h3>
                  <p className="muted">条款修改请走变更工单，此处只读。</p>
                </section>
              ) : null}
              <div className="kol-actions">
                <select aria-label="推进到阶段" value={advanceTo} onChange={(e) => setAdvanceTo(e.target.value)} disabled={busy === "advance"}>
                  <option value="">推进阶段…</option>
                  {MAIN_STAGE_TABS.filter((t) => t.code !== detail.cooperation.coop_stage).map((t) => (
                    <option key={t.code} value={t.code}>{t.label}</option>
                  ))}
                  {detail.cooperation.coop_stage !== "exception" ? <option value="exception">异常</option> : null}
                </select>
                <input aria-label="原因（跨阶段/回退/进出异常必填）" placeholder="原因（跨阶段/回退/进出异常必填）"
                  value={advanceReason} onChange={(e) => setAdvanceReason(e.target.value)}
                  style={{ minWidth: 220 }} disabled={busy === "advance"} />
                <button type="button" className="btn primary" disabled={busy === "advance" || !advanceTo} onClick={() => void submitAdvance()}>
                  {busy === "advance" ? "提交中…" : "确认推进"}
                </button>
                <button type="button" className="btn ghost" disabled={busy === "archive"} onClick={() => void archive()}>归档</button>
                <button type="button" className="btn ghost" disabled={busy === "cancel"} onClick={() => void cancel()}>取消项目</button>
              </div>
              <section className="kol-section" aria-label="项目动态">
                <h3>项目动态</h3>
                {!detail.cooperation.archived_at ? <RecordCoopEventForm coopId={detail.cooperation.id} onDone={() => void refreshDetail()} /> : null}
                {!detail.task || detail.task.work_orders.length === 0
                  ? <p className="muted">暂无工单。项目创建后会自动创建合同签署工单（需模板已发布且自动化已开启）。</p>
                  : <ol className="kol-wo-list">
                    {detail.task.work_orders.map((wo) => (
                      <li key={wo.work_order_id}>
                        <span className="kol-wo-top"><strong>{wo.title}</strong><span className="kol-stage-chip">{workOrderStatusLabel(wo.status)}</span></span>
                        <span className="kol-wo-sub">{wo.template_title} · 主受理 {wo.primary_assignee?.person_ref || "尚未分派"} · {formatTime(wo.updated_at)}</span>
                      </li>
                    ))}
                  </ol>}
              </section>
            </>
          )}
        </div>
      </div>
      {showCreate ? <CreateCooperationDrawer onClose={() => setShowCreate(false)}
        onDone={(id) => { setShowCreate(false); void load().then(() => void openDetail(id)); }} /> : null}
    </main>
  );
}

function RecordCoopEventForm({ coopId, onDone }: { coopId: string; onDone: () => void }) {
  const [eventType, setEventType] = useState("kol.script_submitted");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!summary.trim()) { setError("请填写事实摘要"); return; }
    setBusy(true); setError("");
    try {
      await api.kolCooperationRecordEvent(coopId, { event_type: eventType, summary: summary.trim(), idempotency_key: randomUuid() });
      setSummary(""); onDone();
    } catch (err) { setError(apiErrorMessage(err)); } finally { setBusy(false); }
  };

  return (
    <form className="kol-actions" style={{ marginBottom: 8 }} onSubmit={(e) => void submit(e)} aria-label="记录项目事件">
      <select aria-label="事件类型" value={eventType} onChange={(e) => setEventType(e.target.value)} disabled={busy}>
        {COOP_EVENT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <input aria-label="事实摘要" placeholder="仅写已核验事实，如：达人已提交脚本初稿" value={summary}
        onChange={(e) => setSummary(e.target.value)} style={{ minWidth: 220, flex: 1 }} disabled={busy} />
      <button type="submit" className="btn ghost" disabled={busy}>{busy ? "提交中…" : "记录事件"}</button>
      {error ? <span className="kol-error" role="alert">{error}</span> : null}
    </form>
  );
}

function CreateCooperationDrawer({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const [form, setForm] = useState({ lead_id: "", lead_search: "", title: "", brand: "", coop_type: "short_video", budget_amount: "", settlement_terms: "" });
  const [leadOptions, setLeadOptions] = useState<Array<{ id: string; display_name: string; platform: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const searchLeads = async () => {
    setError("");
    try {
      const page = await api.kolLeadList({ search: form.lead_search || undefined, limit: 20 });
      setLeadOptions(page.leads.map((l) => ({ id: l.id, display_name: l.display_name, platform: l.platform })));
      if (page.leads.length === 0) setError("没有找到匹配的线索");
    } catch (e) { setError(apiErrorMessage(e)); }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.lead_id) { setError("请先搜索并选择关联线索"); return; }
    if (!form.title.trim()) { setError("项目标题为必填"); return; }
    setBusy(true); setError("");
    try {
      const result = await api.kolCooperationCreate({
        lead_id: form.lead_id, title: form.title.trim(),
        brand: form.brand.trim() || undefined, coop_type: form.coop_type,
        budget_amount: form.budget_amount ? Number(form.budget_amount) : undefined,
        settlement_terms: form.settlement_terms.trim() || undefined,
        idempotency_key: randomUuid(),
      });
      onDone(result.cooperation.id);
    } catch (err) { setError(apiErrorMessage(err)); } finally { setBusy(false); }
  };

  return (
    <div className="kol-drawer" role="dialog" aria-modal="true" aria-label="新建合作项目">
      <div className="kol-drawer-head"><h2>新建合作项目</h2><button type="button" className="btn ghost" onClick={onClose}>关闭</button></div>
      <form id="kol-coop-create-form" className="kol-drawer-body" onSubmit={(e) => void submit(e)}>
        {error ? <p className="kol-error" role="alert">{error}</p> : null}
        <div className="kol-field">
          <span>关联线索 *</span>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={form.lead_search} onChange={set("lead_search")} placeholder="搜索账号名" style={{ flex: 1 }} />
            <button type="button" className="btn ghost" onClick={() => void searchLeads()}>搜索</button>
          </div>
          {leadOptions.length > 0 ? (
            <select value={form.lead_id} onChange={set("lead_id")} aria-label="选择线索">
              <option value="">请选择…</option>
              {leadOptions.map((l) => <option key={l.id} value={l.id}>{l.display_name}（{l.platform}）</option>)}
            </select>
          ) : null}
        </div>
        <label className="kol-field"><span>项目标题 *</span><input value={form.title} onChange={set("title")} /></label>
        <label className="kol-field"><span>品牌</span><input value={form.brand} onChange={set("brand")} /></label>
        <label className="kol-field"><span>合作类型</span><select value={form.coop_type} onChange={set("coop_type")}>
          <option value="short_video">短视频</option><option value="live">直播</option>
          <option value="graphic">图文</option><option value="custom">定制</option>
        </select></label>
        <label className="kol-field"><span>预算金额</span><input type="number" min={0} value={form.budget_amount} onChange={set("budget_amount")} /></label>
        <label className="kol-field"><span>结算条款</span><textarea value={form.settlement_terms} onChange={set("settlement_terms")} /></label>
        <p className="kol-hint">提交后自动创建项目任务，并触发合同签署工单（需模板已发布且自动化已开启）。</p>
      </form>
      <div className="kol-drawer-foot">
        <button type="button" className="btn ghost" onClick={onClose}>取消</button>
        <button type="submit" form="kol-coop-create-form" className="btn primary" disabled={busy}>
          {busy ? "提交中…" : "创建"}
        </button>
      </div>
    </div>
  );
}
