import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { api, type ExecutionJob, type ExecutionOutboxHealth, type ExecutionWorker, type SchedulingRule, type SchedulingRuleEffectivenessRawReport, type SchedulingRuleEvaluation } from "../api";

function time(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(date);
}

function age(value?: string | null): string {
  if (!value) return "—";
  const ms = Date.now() - Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  if (ms < 1_000) return "刚刚";
  if (ms < 60_000) return `${Math.floor(ms / 1_000)} 秒前`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} 分钟前`;
  return `${Math.floor(ms / 3_600_000)} 小时前`;
}

const statusLabel: Record<string, string> = {
  queued: "待投递", retrying: "重试等待", running: "执行中", succeeded: "成功", failed: "失败", uncertain: "待人工确认", cancelled: "已取消",
  pending: "待发布", publishing: "发布中", published: "已发布", stopped: "已停止",
};

function label(status?: string | null): string {
  return statusLabel[String(status || "")] || String(status || "—");
}

function metric(value: number | undefined): string {
  return String(Number(value || 0));
}

export default function AdminScheduling() {
  const [status, setStatus] = useState("");
  const [jobs, setJobs] = useState<ExecutionJob[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [outbox, setOutbox] = useState<ExecutionOutboxHealth>({});
  const [workers, setWorkers] = useState<ExecutionWorker[]>([]);
  const [rules, setRules] = useState<SchedulingRule[]>([]);
  const [evaluations, setEvaluations] = useState<SchedulingRuleEvaluation[]>([]);
  const [ruleEffectiveness, setRuleEffectiveness] = useState<SchedulingRuleEffectivenessRawReport | null>(null);
  const [backlog, setBacklog] = useState<{ count: number; oldest_created_at: string | null }>({ count: 0, oldest_created_at: null });
  const [mode, setMode] = useState("");
  const [asOf, setAsOf] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [ruleBusy, setRuleBusy] = useState<string | null>(null);
  const [ruleNotice, setRuleNotice] = useState("");
  const [ruleSimulationIds, setRuleSimulationIds] = useState<Record<string, string>>({});
  const [ruleForm, setRuleForm] = useState({
    rule_type: "ticket_assignment",
    title: "",
    company_id: "company:amperetime",
    event_type: "deadline.quote",
    status: "pending",
    priority: "",
    reason: "",
  });
  const [eventForm, setEventForm] = useState({
    event_type: "deadline.quote",
    company_id: "company:amperetime",
    source_event_id: "",
    ticket_id: "",
    summary: "",
    evidence_ref: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [data, evaluationData, effectivenessData] = await Promise.all([
        api.adminExecutionJobs({ status: status || undefined, limit: 100 }),
        api.adminSchedulingRuleEvaluations(30),
        api.adminSchedulingRuleEffectiveness(100),
      ]);
      setJobs(data.items || []);
      setCounts(data.counts || {});
      setOutbox(data.outbox || {});
      setWorkers(data.workers || []);
      setRules(data.rules || []);
      setEvaluations(evaluationData.items || []);
      setRuleEffectiveness(effectivenessData);
      setBacklog(data.backlog || { count: 0, oldest_created_at: null });
      setMode(data.execution_mode || "");
      setAsOf(data.as_of || null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取调度运行状态");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => { void load(); }, 10_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const retry = async (job: ExecutionJob) => {
    setRetrying(job.id);
    setError("");
    try {
      await api.adminRetryExecutionJob(job.id);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "重新投递失败");
    } finally {
      setRetrying(null);
    }
  };

  const operationKey = (prefix: string) => `${prefix}-${typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
  const proposedAction = ruleForm.rule_type === "ticket_escalation"
    ? "escalation_suggestion"
    : ruleForm.rule_type === "ticket_candidate" ? "candidate_ticket" : "assignment_suggestion";

  const createRuleDraft = async (event: FormEvent) => {
    event.preventDefault();
    setRuleBusy("create");
    setError("");
    setRuleNotice("");
    try {
      const conditions: Record<string, unknown> = {};
      if (ruleForm.status) conditions.ticket_statuses = [ruleForm.status];
      if (ruleForm.priority) conditions.priorities = [ruleForm.priority];
      const result = await api.createSchedulingRuleDraft({
        rule_type: ruleForm.rule_type,
        title: ruleForm.title,
        scope: { company_id: ruleForm.company_id },
        definition: {
          execution_mode: "manual_confirmation",
          requires_human_confirmation: true,
          proposed_action: proposedAction,
          trigger_event_types: [ruleForm.event_type],
          ...(Object.keys(conditions).length ? { conditions } : {}),
        },
        reason: ruleForm.reason,
      }, operationKey("rule-draft"));
      setRuleNotice(`已创建 ${result.rule.id} v${result.rule.version} 草稿；请先模拟，且不会自动改变任何工单。`);
      setRuleForm((current) => ({ ...current, title: "", reason: "" }));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法创建规则草稿");
    } finally {
      setRuleBusy(null);
    }
  };

  const simulateRule = async (rule: SchedulingRule) => {
    const key = `${rule.id}:${rule.version}`;
    setRuleBusy(`simulate:${key}`);
    setError("");
    setRuleNotice("");
    try {
      const result = await api.simulateSchedulingRule(rule.id, rule.version, {
        sample_limit: 25,
        reason: ruleForm.reason || "管理端人工审阅规则模拟",
      }, operationKey("rule-simulate"));
      setRuleSimulationIds((current) => ({ ...current, [key]: result.simulation_id }));
      setRuleNotice(`模拟完成：命中 ${result.matched_count} 条正式工单；结果仅供人工确认，不产生写入。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "规则模拟失败");
    } finally {
      setRuleBusy(null);
    }
  };

  const publishRule = async (rule: SchedulingRule) => {
    const key = `${rule.id}:${rule.version}`;
    const simulationId = ruleSimulationIds[key];
    if (!simulationId) {
      setError("请先在当前浏览器会话完成该版本模拟，再执行发布。");
      return;
    }
    setRuleBusy(`publish:${key}`);
    setError("");
    try {
      await api.publishSchedulingRule(rule.id, rule.version, {
        expected_version: rule.version,
        simulation_id: simulationId,
        reason: ruleForm.reason || "已审阅当前版本模拟，发布为人工确认建议",
      }, operationKey("rule-publish"));
      setRuleNotice("规则已发布为人工确认建议；自动派单、升级、建单及状态变更仍保持关闭。");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "规则发布失败");
    } finally {
      setRuleBusy(null);
    }
  };

  const disableRule = async (rule: SchedulingRule) => {
    const key = `${rule.id}:${rule.version}`;
    setRuleBusy(`disable:${key}`);
    setError("");
    try {
      await api.disableSchedulingRule(rule.id, rule.version, {
        expected_version: rule.version,
        reason: ruleForm.reason || "管理员停用规则版本",
      }, operationKey("rule-disable"));
      setRuleNotice("规则版本已停用；历史模拟与审计仍保留。" );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "规则停用失败");
    } finally {
      setRuleBusy(null);
    }
  };

  const restoreRule = async (rule: SchedulingRule) => {
    const key = `${rule.id}:${rule.version}`;
    if (!window.confirm(`确认将规则 v${rule.version} 恢复为新的草稿吗？恢复后必须重新模拟，才可再次发布。`)) return;
    setRuleBusy(`restore:${key}`);
    setError("");
    try {
      const result = await api.restoreSchedulingRuleDraft(rule.id, rule.version, {
        reason: ruleForm.reason || `从规则 v${rule.version} 恢复为新的人工确认草稿`,
      }, operationKey("rule-restore"));
      setRuleNotice(`已从 v${result.restored_from_version} 建立新草稿 v${result.rule.version}；请重新模拟后发布。`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法恢复规则草稿");
    } finally {
      setRuleBusy(null);
    }
  };

  const recordEventEvaluation = async (event: FormEvent) => {
    event.preventDefault();
    setRuleBusy("event-evaluate");
    setError("");
    setRuleNotice("");
    try {
      const result = await api.recordSchedulingEventEvaluation({
        source_system: "manual_verified",
        source_event_id: eventForm.source_event_id,
        source_version: "manual.v1",
        event_type: eventForm.event_type,
        company_id: eventForm.company_id,
        ...(eventForm.ticket_id.trim() ? { ticket_id: eventForm.ticket_id.trim() } : {}),
        occurred_at: new Date().toISOString(),
        summary: eventForm.summary,
        evidence_ref: eventForm.evidence_ref,
        evidence: { reference: eventForm.evidence_ref, manually_verified: true },
        payload: { intake: "admin_scheduling_manual_verification" },
      }, operationKey("rule-event"));
      const matched = result.evaluations.filter((item) => item.outcome === "matched").length;
      setRuleNotice(`已记录已核验事件；${matched} 条建议待人工确认，未自动建单、分派、升级或改变状态。`);
      setEventForm((current) => ({ ...current, source_event_id: "", ticket_id: "", summary: "", evidence_ref: "" }));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法记录已核验事件");
    } finally {
      setRuleBusy(null);
    }
  };

  const attention = useMemo(
    () => Number(counts.failed || 0) + Number(counts.uncertain || 0) + Number(outbox.stale_publishing_count || 0) + workers.filter((worker) => worker.stale).length,
    [counts, outbox, workers],
  );
  const filters = ["", "queued", "retrying", "running", "failed", "uncertain", "succeeded"];

  return (
    <section className="admin-grid" data-admin-scheduling>
      <header className="panel" style={{ gridColumn: "1 / -1" }}>
        <div className="split-head">
          <div>
            <h2>调度运行</h2>
            <p className="muted">PostgreSQL 是权威状态库；Outbox 只投递执行作业标识，BullMQ Worker 回写最终回执。</p>
          </div>
          <div className="row-actions">
            <span className={attention ? "status-warn" : "status-ok"}>{attention ? `${attention} 项需要关注` : "运行正常"}</span>
            <button type="button" className="btn ghost" onClick={() => void load()} disabled={loading}>刷新</button>
          </div>
        </div>
        <p className="muted">模式：{mode || "—"} · 数据时间：{time(asOf)}</p>
      </header>

      <article className="panel">
        <h3>作业状态</h3>
        <div className="admin-row"><span>待执行</span><strong>{metric(counts.queued) + Number(counts.retrying || 0)}</strong></div>
        <div className="admin-row"><span>执行中</span><strong>{metric(counts.running)}</strong></div>
        <div className="admin-row"><span>失败 / 待确认</span><strong>{metric(counts.failed) + Number(counts.uncertain || 0)}</strong></div>
        <div className="admin-row"><span>已成功</span><strong>{metric(counts.succeeded)}</strong></div>
      </article>

      <article className="panel">
        <h3>Outbox 积压</h3>
        <div className="admin-row"><span>待发布</span><strong>{metric(Number(outbox.pending || 0)) + Number(outbox.retrying || 0)}</strong></div>
        <div className="admin-row"><span>发布中</span><strong>{metric(Number(outbox.publishing || 0))}</strong></div>
        <div className="admin-row"><span>租约超时</span><strong className={Number(outbox.stale_publishing_count || 0) ? "status-warn" : "status-ok"}>{metric(outbox.stale_publishing_count as number | undefined)}</strong></div>
        <div className="admin-row"><span>最早等待</span><strong>{age(backlog.oldest_created_at)}</strong></div>
        <p className="muted">积压 {backlog.count} 项。发布器故障不会丢失作业；超时的发布租约可被新的发布器安全抢回。</p>
      </article>

      <article className="panel" style={{ gridColumn: "1 / -1" }}>
        <h3>Worker 心跳</h3>
        {workers.length === 0 && <p className="muted">尚未收到 Worker 心跳。请检查 Outbox publisher 与 execution worker systemd 服务。</p>}
        {workers.map((worker) => (
          <div className="admin-row" key={worker.worker_id} data-worker-stale={worker.stale || undefined}>
            <div><strong>{worker.worker_id}</strong><p className="muted">{worker.worker_kind} · 并发 {String(worker.details?.concurrency || "—")} · 队列 {String(worker.details?.queue || "—")}</p></div>
            <div><strong className={worker.stale ? "status-warn" : "status-ok"}>{worker.stale ? "心跳超时" : label(worker.status)}</strong><p className="muted">{age(worker.heartbeat_at)}</p></div>
          </div>
        ))}
      </article>

      <article className="panel" style={{ gridColumn: "1 / -1" }}>
        <h3>派单与 SLA 规则</h3>
        <p className="muted">规则只产生待人工确认的建议。即使发布，也不会自动派单、升级、建单或改变工单状态。</p>
        <form className="settings-form" onSubmit={createRuleDraft} data-scheduling-rule-governance>
          <label>规则类型
            <select value={ruleForm.rule_type} onChange={(event) => setRuleForm((current) => ({ ...current, rule_type: event.target.value }))}>
              <option value="ticket_assignment">人工分派建议</option>
              <option value="ticket_escalation">人工升级建议</option>
              <option value="ticket_candidate">人工候选建单建议</option>
            </select>
          </label>
          <label>规则名称
            <input required value={ruleForm.title} placeholder="例如：重要待办人工分派建议" onChange={(event) => setRuleForm((current) => ({ ...current, title: event.target.value }))} />
          </label>
          <label>公司范围
            <input required value={ruleForm.company_id} onChange={(event) => setRuleForm((current) => ({ ...current, company_id: event.target.value }))} />
          </label>
          <label>触发事件
            <select value={ruleForm.event_type} onChange={(event) => setRuleForm((current) => ({ ...current, event_type: event.target.value }))}>
              <option value="mail.reply_verified">已验证邮件回复</option><option value="mail.commitment_verified">已验证邮件承诺</option>
              <option value="deadline.quote">报价期限</option><option value="deadline.contract">合同期限</option><option value="deadline.sample">样品期限</option><option value="deadline.content">内容期限</option>
              <option value="risk.detected">风险事件</option><option value="approval_or_material.missing">审批或资料缺失</option>
            </select>
          </label>
          <label>工单状态条件
            <select value={ruleForm.status} onChange={(event) => setRuleForm((current) => ({ ...current, status: event.target.value }))}>
              <option value="">不限</option><option value="pending">待受理</option><option value="accepted">已受理</option><option value="in_progress">进行中</option><option value="waiting">等待中</option>
            </select>
          </label>
          <label>优先级条件
            <select value={ruleForm.priority} onChange={(event) => setRuleForm((current) => ({ ...current, priority: event.target.value }))}>
              <option value="">不限</option><option value="low">低</option><option value="normal">普通</option><option value="important">重要</option><option value="urgent">紧急</option>
            </select>
          </label>
          <label>审计原因
            <input required value={ruleForm.reason} placeholder="说明草稿或治理目的" onChange={(event) => setRuleForm((current) => ({ ...current, reason: event.target.value }))} />
          </label>
          <div className="row-actions"><button type="submit" className="btn primary" disabled={ruleBusy === "create"}>{ruleBusy === "create" ? "创建中…" : "创建人工确认草稿"}</button></div>
        </form>
        {ruleNotice && <p className="status-ok" role="status">{ruleNotice}</p>}
        {!rules.length && <p className="muted">暂无已登记规则；自动派单与 SLA 升级保持关闭。</p>}
        {rules.map((rule) => (
          <div className="admin-row" key={`${rule.id}:${rule.version}`} data-scheduling-rule={rule.id}>
            <div><strong>{rule.title}</strong><p className="muted">{rule.rule_type} · v{rule.version} · {rule.created_by} · 触发 {Array.isArray(rule.definition.trigger_event_types) ? rule.definition.trigger_event_types.join("、") : "未绑定事件"}</p></div>
            <div>
              <strong className={rule.status === "published" ? "status-ok" : "status-warn"}>{label(rule.status)}</strong><p className="muted">{rule.published_at ? `发布于 ${time(rule.published_at)} · 仅人工确认建议` : "未发布，不参与自动决策"}</p>
              {rule.status === "draft" && <div className="row-actions">
                <button type="button" className="btn ghost" onClick={() => void simulateRule(rule)} disabled={ruleBusy === `simulate:${rule.id}:${rule.version}`}>{ruleBusy === `simulate:${rule.id}:${rule.version}` ? "模拟中…" : "模拟"}</button>
                <button type="button" className="btn primary" onClick={() => void publishRule(rule)} disabled={!ruleSimulationIds[`${rule.id}:${rule.version}`] || ruleBusy === `publish:${rule.id}:${rule.version}`}>{ruleBusy === `publish:${rule.id}:${rule.version}` ? "发布中…" : "发布人工确认建议"}</button>
                <button type="button" className="btn ghost" onClick={() => void disableRule(rule)} disabled={ruleBusy === `disable:${rule.id}:${rule.version}`}>停用</button>
              </div>}
              {rule.status === "published" && <div className="row-actions"><button type="button" className="btn ghost" onClick={() => void disableRule(rule)} disabled={ruleBusy === `disable:${rule.id}:${rule.version}`}>停用</button></div>}
              {rule.status !== "draft" && <div className="row-actions"><button type="button" className="btn ghost" onClick={() => void restoreRule(rule)} disabled={ruleBusy === `restore:${rule.id}:${rule.version}`}>{ruleBusy === `restore:${rule.id}:${rule.version}` ? "恢复中…" : "恢复为新草稿"}</button></div>}
            </div>
          </div>
        ))}
      </article>

      <article className="panel" style={{ gridColumn: "1 / -1" }}>
        <h3>首批业务事件与人工确认建议</h3>
        <p className="muted">只接收已核验的邮件回复/承诺、报价/合同/样品/内容期限、风险、审批或资料缺失事件；仅评估已发布且绑定同类触发事件的规则。命中结果始终待人工确认。</p>
        <form className="settings-form" onSubmit={recordEventEvaluation} data-scheduling-event-evaluation>
          <label>事件类型
            <select value={eventForm.event_type} onChange={(event) => setEventForm((current) => ({ ...current, event_type: event.target.value }))}>
              <option value="mail.reply_verified">已验证邮件回复</option><option value="mail.commitment_verified">已验证邮件承诺</option>
              <option value="deadline.quote">报价期限</option><option value="deadline.contract">合同期限</option><option value="deadline.sample">样品期限</option><option value="deadline.content">内容期限</option>
              <option value="risk.detected">风险事件</option><option value="approval_or_material.missing">审批或资料缺失</option>
            </select>
          </label>
          <label>公司范围<input required value={eventForm.company_id} onChange={(event) => setEventForm((current) => ({ ...current, company_id: event.target.value }))} /></label>
          <label>来源事件 ID<input required value={eventForm.source_event_id} placeholder="来源系统中的稳定事件 ID" onChange={(event) => setEventForm((current) => ({ ...current, source_event_id: event.target.value }))} /></label>
          <label>关联正式工单（可选）<input value={eventForm.ticket_id} placeholder="tsk_…" onChange={(event) => setEventForm((current) => ({ ...current, ticket_id: event.target.value }))} /></label>
          <label>安全摘要<input required value={eventForm.summary} placeholder="说明已核验的业务事实" onChange={(event) => setEventForm((current) => ({ ...current, summary: event.target.value }))} /></label>
          <label>证据引用<input required value={eventForm.evidence_ref} placeholder="邮件 ID、审批单或受控证据 URL" onChange={(event) => setEventForm((current) => ({ ...current, evidence_ref: event.target.value }))} /></label>
          <div className="row-actions"><button type="submit" className="btn primary" disabled={ruleBusy === "event-evaluate"}>{ruleBusy === "event-evaluate" ? "评估中…" : "记录并评估（不执行）"}</button></div>
        </form>
        {!evaluations.length && <p className="muted">暂无已评估事件。规则未声明触发事件时不会参与评估。</p>}
        {evaluations.map((evaluation) => (
          <div className="admin-row" key={evaluation.id} data-rule-evaluation={evaluation.id}>
            <div><strong>{evaluation.rule_title}</strong><p className="muted">{evaluation.event.event_type} · {evaluation.event.summary} · {time(evaluation.evaluated_at)}</p></div>
            <div><strong className={evaluation.outcome === "matched" ? "status-warn" : "status-ok"}>{evaluation.outcome === "matched" ? "待人工确认" : label(evaluation.outcome)}</strong><p className="muted">工单 {evaluation.ticket_id || "—"} · {String(evaluation.details.proposed_action || "—")}</p></div>
          </div>
        ))}
        {ruleEffectiveness ? <section className="task-detail-facts" data-rule-effectiveness>
          <h3>规则成效原始计数</h3>
          <p className="muted">评估 {ruleEffectiveness.totals.evaluations} 次 · 事件 {ruleEffectiveness.totals.distinct_events} 条 · 待人工确认 {ruleEffectiveness.totals.matched} 条。{ruleEffectiveness.note}</p>
          {ruleEffectiveness.rules.map((rule) => <div className="admin-row" key={`${rule.rule_id}:${rule.rule_version}`}>
            <div><strong>{rule.title}</strong><p className="muted">v{rule.rule_version} · {label(rule.rule_status)} · 关联事件 {rule.distinct_events} · 关联工单 {rule.linked_tickets}</p></div>
            <div><strong>{rule.evaluations} 次评估</strong><p className="muted">命中 {rule.by_outcome.matched} · 跳过 {rule.by_outcome.skipped} · 缺字段 {rule.by_outcome.missing_fields}</p><p className="muted">人工确认：{rule.manual_confirmation.coverage_status === "not_recorded" ? "尚未记录确认决定" : rule.manual_confirmation.coverage_status}</p></div>
          </div>)}
        </section> : null}
      </article>

      <article className="panel" style={{ gridColumn: "1 / -1" }}>
        <div className="split-head"><h3>最近执行作业</h3><div className="chip-row">{filters.map((value) => <button key={value || "all"} type="button" className={"hub-chip" + (status === value ? " on" : "")} onClick={() => setStatus(value)}>{value ? label(value) : "全部"}</button>)}</div></div>
        {error && <p className="error" role="alert">{error}</p>}
        {loading && !jobs.length && <p className="muted">读取中…</p>}
        {!loading && !jobs.length && !error && <p className="muted">当前筛选没有执行作业。</p>}
        {jobs.map((job) => (
          <div className="admin-row" key={job.id} data-execution-job={job.id} data-execution-status={job.status}>
            <div><strong>{job.job_type}</strong><p className="muted">{job.id} · 工单 {String(job.ticket_id || "—")} · 运行 {String(job.run_id || "—")}</p></div>
            <div>
              <strong>{label(job.status)}</strong><p className="muted">尝试 {job.attempts}/{job.max_attempts} · {age(job.created_at)}</p>
              {job.error_summary && <p className="error">{job.error_summary}</p>}
              {job.status === "failed" && job.risk_level === "low" ? (
                <button type="button" className="btn ghost" onClick={() => void retry(job)} disabled={retrying === job.id}>
                  {retrying === job.id ? "重新投递中…" : "重新投递"}
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </article>
    </section>
  );
}
