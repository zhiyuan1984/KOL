import WorkspaceSearchInput from "../components/WorkspaceSearchInput";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button, Empty, Form, Input, Modal, Select, Steps, Tag, Timeline } from "antd";
import { api, type KolLead, type KolLeadAutomationStatus, type KolLeadDetailResponse, type KolLeadTimelineEvent } from "../api";
import { randomUuid } from "../uuid";
import { ActionGroup, HorizontalForm, PropertyList, RecordRow, TruncatableText } from "../components/InformationLayout";
import {
  apiErrorMessage, formatFollowers, formatTime,
  LEAD_SOURCE_LABELS, LEAD_SOURCES, LEAD_STAGE_LABELS, LEAD_STAGE_ORDER,
  workOrderStatusLabel,
} from "./kol-shared";
import "./kol-lead-coop.css";
import "./global-layout-leads.css";

const TERMINAL_STAGES = new Set(["rejected", "converted"]);

/** 线索主流程（步骤条用）：待建联 → 建联中 → 报价谈判 → 样品待发 → 意向待定 → 已转化。
 * 已拒绝是异常终态，不进主流程，单独用 Tag 展示。 */
const LEAD_FLOW_STAGES = ["pending_contact", "contacting", "price_negotiating", "sample_pending", "intent_pending"];
const LEAD_FLOW_ITEMS = [...LEAD_FLOW_STAGES, "converted"];

function stageTagColor(stage: string): string | undefined {
  if (stage === "converted") return "green";
  if (stage === "rejected") return "red";
  if (stage === "contacting" || stage === "price_negotiating") return "blue";
  return undefined;
}

function StageTag({ stage }: { stage: string }) {
  return <Tag color={stageTagColor(stage)}>{LEAD_STAGE_LABELS[stage] || stage}</Tag>;
}

/** 线索阶段步骤条：主流程 5 步 + 已转化终点；已拒绝是异常终态不进主流程。
 * 点击步骤 = 发起阶段变更（R3，需确认）；点"已转化"且当前为意向待定时走转化抽屉。 */
function LeadStageSteps({ stage, onChange }: { stage: string; onChange: (next: number) => void }) {
  const current = LEAD_FLOW_STAGES.indexOf(stage);
  return (
    <Steps
      size="small"
      current={current < 0 ? 0 : current}
      onChange={onChange}
      items={LEAD_FLOW_ITEMS.map((s) => ({ title: LEAD_STAGE_LABELS[s] || s }))}
    />
  );
}

export default function Leads() {
  const [query] = useSearchParams();
  const [stage, setStage] = useState(query.get("stage") || "");
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
  const [eventsRefreshKey, setEventsRefreshKey] = useState(0);
  const [automationError, setAutomationError] = useState(false);
  const [automation, setAutomation] = useState<KolLeadAutomationStatus | null>(null);

  useEffect(() => {
    api.kolLeadAutomationStatus().then(setAutomation, () => { setAutomation(null); setAutomationError(true); });
  }, []);

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

  useEffect(() => { setStage(query.get("stage") || ""); const id = query.get("id"); if (id) void openDetail(id); }, [query, openDetail]);
  const refreshDetail = useCallback(async () => {
    if (selectedId) { await openDetail(selectedId); }
    setEventsRefreshKey((k) => k + 1);
    await load();
  }, [selectedId, openDetail, load]);

  const advanceStage = (next: string) => {
    if (!selectedId || !next || !detail) return;
    const fromLabel = LEAD_STAGE_LABELS[detail.lead.lead_stage] || detail.lead.lead_stage;
    const toLabel = LEAD_STAGE_LABELS[next] || next;
    Modal.confirm({
      title: "确认推进阶段",
      content: `从「${fromLabel}」推进到「${toLabel}」？这次变更会记入时间线。`,
      okText: "确认推进",
      cancelText: "取消",
      onOk: async () => {
        setBusy("stage");
        try { await api.kolLeadUpdate(selectedId, { lead_stage: next, confirmed: true, expected_version: detail.lead.data_version }); await refreshDetail(); }
        catch (e) { setError(apiErrorMessage(e)); }
        finally { setBusy(""); }
      },
    });
  };

  const onStepChange = (next: number) => {
    if (!detail || TERMINAL_STAGES.has(detail.lead.lead_stage)) return;
    if (next >= LEAD_FLOW_STAGES.length) {
      // 点"已转化"：走原来的标记转化抽屉（带表单），不直接 PATCH
      if (detail.lead.lead_stage === "intent_pending") setShowConvert(true);
      return;
    }
    const target = LEAD_FLOW_STAGES[next]!;
    if (target === detail.lead.lead_stage) return;
    advanceStage(target);
  };

  const archive = () => {
    if (!selectedId || !detail) return;
    Modal.confirm({
      title: "确认归档",
      content: "归档后这条线索将不再跟进，并记入时间线。确认归档吗？",
      okText: "确认归档",
      cancelText: "取消",
      onOk: async () => {
        setBusy("archive");
        try { await api.kolLeadUpdate(selectedId, { is_archived: true, archived_reason: "手动归档", confirmed: true, expected_version: detail.lead.data_version }); setSelectedId(null); setDetail(null); await load(); }
        catch (e) { setError(apiErrorMessage(e)); }
        finally { setBusy(""); }
      },
    });
  };

  return (
    <main className="kol-page leads-layout-page" aria-label="线索管理">
      <div className="kol-page-head">
        <h1>线索管理</h1>
        <span className="kol-hint">共 {total} 条</span>
        <button type="button" className="btn primary" onClick={() => setShowCreate(true)}>新建线索</button>
      </div>
      {error ? <p className="kol-error" role="alert">{error}</p> : null}
      <div className="kol-filters">
        <div className="kol-search-row">
          <WorkspaceSearchInput className="kol-search" aria-label="搜索线索" placeholder="搜索账号名 / 平台" value={search}
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
        <div className="kol-list leads-record-list" role="listbox" aria-label="线索列表">
          {loading ? <p className="muted">加载中…</p> : leads.length === 0 ? <p className="muted">暂无线索</p> :
            leads.map((lead) => (
              <RecordRow key={lead.id} role="option" tabIndex={0} aria-selected={selectedId === lead.id}
                className="leads-list-record" onClick={() => void openDetail(lead.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void openDetail(lead.id); }
                }}
                title={<TruncatableText text={lead.display_name} className="leads-list-title" />}
                meta={<span className="leads-lead-identity">{lead.platform} · {lead.account_handle}</span>}
                status={<StageTag stage={lead.lead_stage} />}
                detail={<span className="leads-list-detail">
                  {lead.brand ? <span>品牌 {lead.brand}</span> : null}
                  <span>粉丝 {formatFollowers(lead.follower_count)}</span>
                  {lead.open_work_order_count != null && lead.open_work_order_count > 0
                    ? <span>未完成工单 {lead.open_work_order_count}</span> : null}
                </span>}
              />
            ))}
        </div>
        <div className="kol-detail" aria-live="polite">
          {detailLoading ? <p className="muted">加载中…</p> : !detail ? <p className="kol-empty">选择一条线索查看详情</p> : (
            <>
              <section className="kol-section" aria-label="属性快照">
                <h3>属性快照<span className="kol-obj-kind">对象 · creator_candidate</span></h3>
                <RecordRow className="leads-detail-summary"
                  title={<TruncatableText text={detail.lead.display_name} />}
                  meta={<div className="kol-row-meta leads-detail-meta">
                    <span>稳定标识 {detail.lead.platform} · {detail.lead.account_handle}</span>
                    <span>来源 {LEAD_SOURCE_LABELS[detail.lead.source] || detail.lead.source}</span>
                    {detail.lead.has_contact ? <span>有联系方式（已脱敏）</span> : null}
                  </div>}
                  status={<StageTag stage={detail.lead.lead_stage} />}
                />
                <PropertyList className="leads-property-list" labelWidth="default" items={[
                  { key: "follower_count", label: "粉丝", value: <>{formatFollowers(detail.lead.follower_count)} <span className="kol-hint">采集</span></> },
                  { key: "category", label: "品类", value: detail.lead.category, emptyText: <span className="kol-hint">未采集</span> },
                  { key: "brand", label: "品牌", value: detail.lead.brand, emptyText: <span className="kol-hint">未采集</span> },
                  { key: "platform_creator_id", label: "平台稳定编号", value: detail.lead.platform_creator_id, emptyText: "—" },
                  { key: "source_ref", label: "来源批次", value: detail.lead.source_ref, emptyText: "—" },
                  { key: "updated_at", label: "更新时间", value: formatTime(detail.lead.updated_at) },
                ]} />
              </section>
              <section className="kol-section" aria-label="动作">
                <h3>动作<Tag> R3 · 正式写入需确认</Tag></h3>
                {!TERMINAL_STAGES.has(detail.lead.lead_stage) ? <>
                  <LeadStageSteps stage={detail.lead.lead_stage} onChange={onStepChange} />
                  <ActionGroup className="leads-stage-actions">
                    {detail.lead.lead_stage === "intent_pending"
                      ? <Button type="text" onClick={() => setShowConvert(true)}>标记转化</Button>
                      : null}
                    <Button type="text" onClick={() => archive()} loading={busy === "archive"}>归档</Button>
                  </ActionGroup>
                </> : <span className="kol-hint">该线索已终态（{LEAD_STAGE_LABELS[detail.lead.lead_stage]}）</span>}
                <p className="kol-hint">此处推进的是线索跟进阶段（5 步主流程 + 已转化），不是合作项目阶段（15+exception）；点击步骤条即发起阶段变更（R3，需确认），完成后记入下方时间线。</p>
              </section>
              <section className="kol-section" aria-label="事件时间线">
                <h3>事件时间线</h3>
                {!TERMINAL_STAGES.has(detail.lead.lead_stage)
                  ? <><RecordLeadEventForm leadId={detail.lead.id} onDone={() => void refreshDetail()} />
                    <p className="kol-hint"><Tag> R3 · 事实记录</Tag> 仅写已核验事实，写入统一事件（lead.*）</p></>
                  : null}
                <LeadTimeline leadId={detail.lead.id} refreshKey={eventsRefreshKey} />
                <h4 className="kol-subhead">相关工单</h4>
                {!detail.task || detail.task.work_orders.length === 0
                  ? <p className="muted">{automationError ? "自动建单规则状态读取失败，请刷新页面重试；不能据此判断未配置。" : automation === null ? "自动建单规则状态读取中…"
                    : automation.configured && automation.template
                      ? `暂无工单。已发布初次建联模板：${automation.template.title}（${automation.template.code} v${automation.template.version}）。是否自动建单还需执行发布启用、判断通过与真实执行回执。`
                      : "暂无工单。自动建单规则未配置：建档后不会自动创建初次建联工单（需管理端发布模板并开启自动化）。"}</p>
                  : <ol className="leads-work-order-list">
                    {detail.task.work_orders.map((wo) => (
                      <li key={wo.work_order_id}>
                        <RecordRow className="leads-work-order-record"
                          title={<TruncatableText text={wo.title} />}
                          status={<span className="kol-stage-chip">{workOrderStatusLabel(wo.status)}</span>}
                          detail={<span className="leads-work-order-detail">{wo.template_title} · 主受理 {wo.primary_assignee?.person_ref || "尚未分派"} · {formatTime(wo.updated_at)}</span>}
                        />
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

const LEAD_TIMELINE_EVENT_NAMES: Record<string, string> = {
  "lead.created": "线索已建档",
  "lead.reply_received": "达人回复",
  "lead.followup_due": "跟进到期",
  "lead.sample_requested": "索要样品",
  "lead.intent_confirmed": "意向确认",
  "lead.high_potential_detected": "高潜线索",
  "lead.stage_changed": "阶段变更",
  "lead.archived": "已归档",
  "lead.converted": "已转化",
};

function timelineSummary(ev: KolLeadTimelineEvent): string | null {
  if (ev.summary) return ev.summary;
  if (ev.event_type === "lead.stage_changed") {
    const from = String(ev.payload.from_stage || "");
    const to = String(ev.payload.to_stage || "");
    return `阶段：${LEAD_STAGE_LABELS[from] || from} → ${LEAD_STAGE_LABELS[to] || to}`;
  }
  if (ev.event_type === "lead.archived") {
    const reason = String(ev.payload.archived_reason || "").trim();
    return reason ? `归档原因：${reason}` : "已归档";
  }
  return null;
}

function LeadTimeline({ leadId, refreshKey }: { leadId: string; refreshKey: number }) {
  const [events, setEvents] = useState<KolLeadTimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    api.kolLeadEvents(leadId).then(
      (r) => { if (!cancelled) { setEvents(r.events); setLoading(false); } },
      (e) => { if (!cancelled) { setError(apiErrorMessage(e)); setLoading(false); } },
    );
    return () => { cancelled = true; };
  }, [leadId, refreshKey]);
  if (loading) return <p className="muted">事件加载中…</p>;
  if (error) return <p className="kol-error" role="alert">{error}</p>;
  if (events.length === 0) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无事件，上面的动作会产生事件并显示在这里" />;
  return (
    <Timeline
      items={events.map((ev, idx) => ({
        color: ev.verified ? "green" : undefined,
        children: (
          <RecordRow key={`${ev.event_type}-${ev.occurred_at}-${idx}`} className="leads-timeline-record"
            title={<TruncatableText text={LEAD_TIMELINE_EVENT_NAMES[ev.event_type] || ev.event_type} />}
            meta={<span className="leads-timeline-meta"><TruncatableText text={ev.event_type} className="kol-tl-code" /><span className="kol-tl-time">{formatTime(ev.occurred_at)}</span></span>}
            status={ev.verified ? <Tag color="green">已核验</Tag> : undefined}
            detail={timelineSummary(ev) ? <div className="kol-tl-summary">{timelineSummary(ev)}</div> : undefined}
          />
        ),
      }))}
    />
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

  const submit = async () => {
    if (!summary.trim()) { setError("请填写事实摘要"); return; }
    setBusy(true); setError("");
    try {
      await api.kolLeadRecordEvent(leadId, { event_type: eventType, summary: summary.trim(), idempotency_key: randomUuid() });
      setSummary(""); onDone();
    } catch (err) { setError(apiErrorMessage(err)); } finally { setBusy(false); }
  };

  return (
    <HorizontalForm className="leads-event-form" labelWidth="short" onFinish={() => void submit()} aria-label="记录跟进事件">
      <Form.Item label="事件类型">
        <Select aria-label="事件类型" value={eventType} onChange={setEventType} options={LEAD_EVENT_OPTIONS} disabled={busy} />
      </Form.Item>
      <Form.Item label="事实摘要" className="ui-field-wide">
        <Input aria-label="事实摘要" placeholder="仅写已核验事实，如：达人已回复报价邮件" value={summary}
          onChange={(e) => setSummary(e.target.value)} disabled={busy} />
      </Form.Item>
      <div className="ui-form-actions">
        <ActionGroup>
          <Button htmlType="submit" loading={busy}>记录事件</Button>
          {error ? <span className="kol-error" role="alert">{error}</span> : null}
        </ActionGroup>
      </div>
    </HorizontalForm>
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

  const submit = async () => {
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
      <div className="kol-drawer-body leads-convert-form-body">
        <HorizontalForm id="kol-lead-convert-form" className="leads-convert-form" labelWidth="long" onFinish={() => void submit()}>
          {error ? <p className="kol-error" role="alert">{error}</p> : null}
          <p className="kol-hint">线索：{lead.display_name}（{lead.platform}）。确认后将创建合作项目与项目任务，线索标记为已转化，其未完成跟进工单将被取消。</p>
          <Form.Item label="项目标题 *"><input aria-required="true" value={form.title} onChange={set("title")} placeholder="如 2026Q4 短视频带货合作" /></Form.Item>
          <Form.Item label="品牌"><input value={form.brand} onChange={set("brand")} /></Form.Item>
          <Form.Item label="合作类型"><select value={form.coop_type} onChange={set("coop_type")}>
            <option value="short_video">短视频</option><option value="live">直播</option>
            <option value="graphic">图文</option><option value="custom">定制</option>
          </select></Form.Item>
          <Form.Item label="预算金额"><input type="number" min={0} value={form.budget_amount} onChange={set("budget_amount")} /></Form.Item>
          <Form.Item label="结算条款" className="ui-field-stacked"><textarea value={form.settlement_terms} onChange={set("settlement_terms")} /></Form.Item>
        </HorizontalForm>
      </div>
      <div className="kol-drawer-foot">
        <button type="button" className="btn ghost" onClick={onClose}>取消</button>
        <button type="submit" form="kol-lead-convert-form" className="btn primary" disabled={busy}>
          {busy ? "提交中…" : "确认转化"}
        </button>
      </div>
    </div>
  );
}
