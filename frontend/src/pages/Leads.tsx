import { useCallback, useEffect, useState } from "react";
import { api, type KolLead, type KolLeadDetailResponse } from "../api";
import { randomUuid } from "../uuid";
import {
  apiErrorMessage, formatFollowers, formatTime,
  LEAD_SOURCE_LABELS, LEAD_SOURCES, LEAD_STAGE_LABELS, LEAD_STAGE_ORDER,
  workOrderStatusLabel,
} from "./kol-shared";
import "./kol-lead-coop.css";

const TERMINAL_STAGES = new Set(["rejected", "converted"]);

function StageChip({ stage }: { stage: string }) {
  const done = stage === "converted";
  return <span className={`kol-stage-chip${done ? " is-done" : ""}`}>{LEAD_STAGE_LABELS[stage] || stage}</span>;
}

export default function Leads() {
  const [stage, setStage] = useState("");
  const [source, setSource] = useState("");
  const [mine, setMine] = useState(false);
  const [search, setSearch] = useState("");
  const [leads, setLeads] = useState<KolLead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<KolLeadDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showConvert, setShowConvert] = useState(false);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const page = await api.kolLeadList({ stage: stage || undefined, source: source || undefined, mine, search: search || undefined, limit: 50 });
      setLeads(page.leads); setTotal(page.total);
    } catch (e) { setError(apiErrorMessage(e)); } finally { setLoading(false); }
  }, [stage, source, mine, search]);

  useEffect(() => { void load(); }, [load]);

  const openDetail = useCallback(async (id: string) => {
    setSelectedId(id); setDetailLoading(true);
    try { setDetail(await api.kolLeadDetail(id)); }
    catch (e) { setError(apiErrorMessage(e)); } finally { setDetailLoading(false); }
  }, []);

  const refreshDetail = useCallback(async () => {
    if (selectedId) { await openDetail(selectedId); }
    await load();
  }, [selectedId, openDetail, load]);

  const advanceStage = async (next: string) => {
    if (!selectedId || !next) return;
    setBusy("stage");
    try { await api.kolLeadUpdate(selectedId, { lead_stage: next }); await refreshDetail(); }
    catch (e) { setError(apiErrorMessage(e)); } finally { setBusy(""); }
  };

  const archive = async () => {
    if (!selectedId || !window.confirm("确认归档这条线索吗？")) return;
    setBusy("archive");
    try { await api.kolLeadUpdate(selectedId, { is_archived: true, archived_reason: "手动归档" }); setSelectedId(null); setDetail(null); await load(); }
    catch (e) { setError(apiErrorMessage(e)); } finally { setBusy(""); }
  };

  return (
    <main className="kol-page" aria-label="线索管理">
      <div className="kol-page-head">
        <h1>线索管理</h1>
        <span className="kol-hint">共 {total} 条</span>
        <button type="button" className="btn primary" onClick={() => setShowCreate(true)}>新建线索</button>
      </div>
      {error ? <p className="kol-error" role="alert">{error}</p> : null}
      <div className="kol-filters">
        <div className="kol-search-row">
          <input className="kol-search" aria-label="搜索线索" placeholder="搜索账号名 / 平台" value={search}
            onChange={(e) => setSearch(e.target.value)} />
          <button type="button" className="kol-chip" aria-pressed={mine} onClick={() => setMine((v) => !v)}>只看我负责</button>
        </div>
        <div className="kol-chip-row" role="group" aria-label="阶段筛选">
          <span className="kol-chip-group-label">阶段</span>
          <button type="button" className="kol-chip" aria-pressed={stage === ""} onClick={() => setStage("")}>全部</button>
          {LEAD_STAGE_ORDER.map((s) => (
            <button key={s} type="button" className="kol-chip" aria-pressed={stage === s} onClick={() => setStage(stage === s ? "" : s)}>
              {LEAD_STAGE_LABELS[s]}
            </button>
          ))}
        </div>
        <div className="kol-chip-row" role="group" aria-label="来源筛选">
          <span className="kol-chip-group-label">来源</span>
          <button type="button" className="kol-chip" aria-pressed={source === ""} onClick={() => setSource("")}>全部</button>
          {LEAD_SOURCES.map((s) => (
            <button key={s.value} type="button" className="kol-chip" aria-pressed={source === s.value} onClick={() => setSource(source === s.value ? "" : s.value)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className="kol-layout">
        <div className="kol-list" role="listbox" aria-label="线索列表">
          {loading ? <p className="muted">加载中…</p> : leads.length === 0 ? <p className="muted">暂无线索</p> :
            leads.map((lead) => (
              <button key={lead.id} type="button" role="option" aria-selected={selectedId === lead.id}
                className="kol-row" onClick={() => void openDetail(lead.id)}>
                <span className="kol-row-top"><strong>{lead.display_name}</strong><StageChip stage={lead.lead_stage} /></span>
                <span className="kol-row-meta">
                  <span>{lead.platform} · {lead.account_handle}</span>
                  {lead.brand ? <span>品牌 {lead.brand}</span> : null}
                  <span>粉丝 {formatFollowers(lead.follower_count)}</span>
                  {lead.open_work_order_count != null && lead.open_work_order_count > 0
                    ? <span>未完成工单 {lead.open_work_order_count}</span> : null}
                </span>
              </button>
            ))}
        </div>
        <div className="kol-detail" aria-live="polite">
          {detailLoading ? <p className="muted">加载中…</p> : !detail ? <p className="kol-empty">选择一条线索查看跟进动态</p> : (
            <>
              <div className="kol-detail-head">
                <h2>{detail.lead.display_name}</h2>
                <div className="kol-row-meta">
                  <span>{detail.lead.platform} · {detail.lead.account_handle}</span>
                  <span>来源 {LEAD_SOURCE_LABELS[detail.lead.source] || detail.lead.source}</span>
                  {detail.lead.has_contact ? <span>有联系方式（已脱敏）</span> : null}
                </div>
              </div>
              <dl className="kol-meta-grid">
                <div><dt>阶段</dt><dd><StageChip stage={detail.lead.lead_stage} /></dd></div>
                <div><dt>粉丝</dt><dd>{formatFollowers(detail.lead.follower_count)}</dd></div>
                <div><dt>品类</dt><dd>{detail.lead.category || "—"}</dd></div>
                <div><dt>品牌</dt><dd>{detail.lead.brand || "—"}</dd></div>
                <div><dt>更新时间</dt><dd>{formatTime(detail.lead.updated_at)}</dd></div>
              </dl>
              <div className="kol-actions">
                {!TERMINAL_STAGES.has(detail.lead.lead_stage) ? <>
                  <select aria-label="推进到阶段" id="lead-stage-select" defaultValue=""
                    onChange={(e) => { const v = e.target.value; e.target.value = ""; if (v) void advanceStage(v); }}
                    disabled={busy === "stage"}>
                    <option value="">推进阶段…</option>
                    {LEAD_STAGE_ORDER.filter((s) => s !== detail.lead.lead_stage && !TERMINAL_STAGES.has(s)).map((s) => (
                      <option key={s} value={s}>{LEAD_STAGE_LABELS[s]}</option>
                    ))}
                  </select>
                  {detail.lead.lead_stage === "intent_pending"
                    ? <button type="button" className="btn primary" onClick={() => setShowConvert(true)}>标记转化</button>
                    : null}
                  <button type="button" className="btn ghost" disabled={busy === "archive"} onClick={() => void archive()}>归档</button>
                </> : <span className="kol-hint">该线索已终态（{LEAD_STAGE_LABELS[detail.lead.lead_stage]}）</span>}
              </div>
              <section className="kol-section" aria-label="跟进动态">
                <h3>跟进动态</h3>
                {!TERMINAL_STAGES.has(detail.lead.lead_stage) ? <RecordLeadEventForm leadId={detail.lead.id} onDone={() => void refreshDetail()} /> : null}
                {!detail.task || detail.task.work_orders.length === 0
                  ? <p className="muted">暂无工单。建档后会自动创建初次建联工单（需管理端发布模板并开启自动化）。</p>
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
      {showCreate ? <CreateLeadDrawer onClose={() => setShowCreate(false)} onDone={(id) => { setShowCreate(false); void load().then(() => void openDetail(id)); }} /> : null}
      {showConvert && detail ? <ConvertLeadDrawer lead={detail.lead} onClose={() => setShowConvert(false)}
        onDone={() => { setShowConvert(false); void refreshDetail(); }} /> : null}
    </main>
  );
}

const LEAD_EVENT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "lead.reply_received", label: "达人回复" },
  { value: "lead.followup_due", label: "跟进到期" },
  { value: "lead.sample_requested", label: "索要样品" },
  { value: "lead.intent_confirmed", label: "意向确认" },
  { value: "lead.high_potential_detected", label: "高潜线索" },
];

function RecordLeadEventForm({ leadId, onDone }: { leadId: string; onDone: () => void }) {
  const [eventType, setEventType] = useState("lead.reply_received");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!summary.trim()) { setError("请填写事实摘要"); return; }
    setBusy(true); setError("");
    try {
      await api.kolLeadRecordEvent(leadId, { event_type: eventType, summary: summary.trim(), idempotency_key: randomUuid() });
      setSummary(""); onDone();
    } catch (err) { setError(apiErrorMessage(err)); } finally { setBusy(false); }
  };

  return (
    <form className="kol-actions" style={{ marginBottom: 8 }} onSubmit={(e) => void submit(e)} aria-label="记录跟进事件">
      <select aria-label="事件类型" value={eventType} onChange={(e) => setEventType(e.target.value)} disabled={busy}>
        {LEAD_EVENT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <input aria-label="事实摘要" placeholder="仅写已核验事实，如：达人已回复报价邮件" value={summary}
        onChange={(e) => setSummary(e.target.value)} style={{ minWidth: 220, flex: 1 }} disabled={busy} />
      <button type="submit" className="btn ghost" disabled={busy}>{busy ? "提交中…" : "记录事件"}</button>
      {error ? <span className="kol-error" role="alert">{error}</span> : null}
    </form>
  );
}

function CreateLeadDrawer({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const [form, setForm] = useState({ platform: "", account_handle: "", account_url: "", display_name: "", follower_count: "", category: "", brand: "", platform_creator_id: "", source: "manual", contact: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.platform.trim() || !form.account_handle.trim()) { setError("平台和账号名为必填"); return; }
    setBusy(true); setError("");
    try {
      const contact: Record<string, unknown> = {};
      if (form.contact.trim()) contact.note = form.contact.trim();
      const result = await api.kolLeadCreate({
        platform: form.platform.trim(), account_handle: form.account_handle.trim(),
        account_url: form.account_url.trim() || undefined,
        display_name: form.display_name.trim() || undefined,
        follower_count: form.follower_count ? Number(form.follower_count) : undefined,
        category: form.category.trim() || undefined,
        brand: form.brand.trim() || undefined,
        platform_creator_id: form.platform_creator_id.trim() || undefined,
        source: form.source,
        contact: Object.keys(contact).length ? contact : undefined,
        idempotency_key: randomUuid(),
      });
      onDone(result.lead.id);
    } catch (err) { setError(apiErrorMessage(err)); } finally { setBusy(false); }
  };

  return (
    <div className="kol-drawer" role="dialog" aria-modal="true" aria-label="新建线索">
      <div className="kol-drawer-head"><h2>新建线索</h2><button type="button" className="btn ghost" onClick={onClose}>关闭</button></div>
      <form id="kol-lead-create-form" className="kol-drawer-body" onSubmit={(e) => void submit(e)}>
        {error ? <p className="kol-error" role="alert">{error}</p> : null}
        <label className="kol-field"><span>平台 *</span><input value={form.platform} onChange={set("platform")} placeholder="如 douyin / xiaohongshu" /></label>
        <label className="kol-field"><span>账号名 *</span><input value={form.account_handle} onChange={set("account_handle")} /></label>
        <label className="kol-field"><span>账号链接</span><input value={form.account_url} onChange={set("account_url")} /></label>
        <label className="kol-field"><span>显示名</span><input value={form.display_name} onChange={set("display_name")} placeholder="默认与账号名相同" /></label>
        <label className="kol-field"><span>粉丝数</span><input type="number" min={0} value={form.follower_count} onChange={set("follower_count")} /></label>
        <label className="kol-field"><span>品类</span><input value={form.category} onChange={set("category")} placeholder="如 美妆 / 3C" /></label>
        <label className="kol-field"><span>品牌</span><input value={form.brand} onChange={set("brand")} placeholder="如 LT；留空则按你的唯一品牌自动归属" /></label>
        <label className="kol-field"><span>平台稳定编号</span><input value={form.platform_creator_id} onChange={set("platform_creator_id")} placeholder="如 YouTube channelId（用于公海品牌可见性）" /></label>
        <label className="kol-field"><span>来源</span><select value={form.source} onChange={set("source")}>
          {LEAD_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select></label>
        <label className="kol-field"><span>联系方式备注（入库脱敏展示）</span><input value={form.contact} onChange={set("contact")} /></label>
        <p className="kol-hint">提交后自动创建跟进目标任务，并触发初次建联工单（需模板已发布且自动化已开启）。</p>
      </form>
      <div className="kol-drawer-foot">
        <button type="button" className="btn ghost" onClick={onClose}>取消</button>
        <button type="submit" form="kol-lead-create-form" className="btn primary" disabled={busy}>
          {busy ? "提交中…" : "创建"}
        </button>
      </div>
    </div>
  );
}

function ConvertLeadDrawer({ lead, onClose, onDone }: { lead: KolLead; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ title: "", brand: "", coop_type: "short_video", budget_amount: "", settlement_terms: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) { setError("项目标题为必填"); return; }
    setBusy(true); setError("");
    try {
      await api.kolLeadConvert(lead.id, {
        title: form.title.trim(), brand: form.brand.trim() || undefined, coop_type: form.coop_type,
        budget_amount: form.budget_amount ? Number(form.budget_amount) : undefined,
        settlement_terms: form.settlement_terms.trim() || undefined,
        idempotency_key: randomUuid(),
      });
      onDone();
    } catch (err) { setError(apiErrorMessage(err)); } finally { setBusy(false); }
  };

  return (
    <div className="kol-drawer" role="dialog" aria-modal="true" aria-label="转化为合作项目">
      <div className="kol-drawer-head"><h2>转化为合作项目</h2><button type="button" className="btn ghost" onClick={onClose}>关闭</button></div>
      <form id="kol-lead-convert-form" className="kol-drawer-body" onSubmit={(e) => void submit(e)}>
        {error ? <p className="kol-error" role="alert">{error}</p> : null}
        <p className="kol-hint">线索：{lead.display_name}（{lead.platform}）。确认后将创建合作项目与项目任务，线索标记为已转化，其未完成跟进工单将被取消。</p>
        <label className="kol-field"><span>项目标题 *</span><input value={form.title} onChange={set("title")} placeholder="如 2026Q4 短视频带货合作" /></label>
        <label className="kol-field"><span>品牌</span><input value={form.brand} onChange={set("brand")} /></label>
        <label className="kol-field"><span>合作类型</span><select value={form.coop_type} onChange={set("coop_type")}>
          <option value="short_video">短视频</option><option value="live">直播</option>
          <option value="graphic">图文</option><option value="custom">定制</option>
        </select></label>
        <label className="kol-field"><span>预算金额</span><input type="number" min={0} value={form.budget_amount} onChange={set("budget_amount")} /></label>
        <label className="kol-field"><span>结算条款</span><textarea value={form.settlement_terms} onChange={set("settlement_terms")} /></label>
      </form>
      <div className="kol-drawer-foot">
        <button type="button" className="btn ghost" onClick={onClose}>取消</button>
        <button type="submit" form="kol-lead-convert-form" className="btn primary" disabled={busy}>
          {busy ? "提交中…" : "确认转化"}
        </button>
      </div>
    </div>
  );
}
