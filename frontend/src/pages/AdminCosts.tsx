import { Fragment, useCallback, useEffect, useState } from "react";
import {
  api,
  type AdminCostBudgetRow,
  type AdminCostEventRow,
  type AdminCostsSummary,
} from "../api";

/** notes 代码 → 诚实中文口径（与后端 COST_NOTES 同名）；未登记的代码原样显示，不编造说明。 */
const COST_NOTE_TEXT: Record<string, string> = {
  usage_estimated_source: "用量为 Codex 线程级估计值，非精确账单。",
  auxiliary_codex_calls_unmetered: "辅助调用（邮件摘要 / 翻译 / 简报 / 意图识别等）暂未计量。",
  cost_cents_unavailable: "未配置价格来源，本页不显示金额。",
};

/** 固定三条缺口，顺序即展示顺序。 */
const COST_NOTE_CODES = ["usage_estimated_source", "auxiliary_codex_calls_unmetered", "cost_cents_unavailable"];

type BudgetStateKey = AdminCostBudgetRow["state"];

/** 状态词同时给出文字与色调：不靠颜色单独表达（docs/DESIGN.md §颜色）。 */
const BUDGET_STATE: Record<BudgetStateKey, { label: string; tone: string }> = {
  unconfigured: { label: "未配置", tone: "unattached" },
  disabled: { label: "已停用", tone: "disabled" },
  ok: { label: "正常", tone: "configured" },
  warn: { label: "预警", tone: "warning" },
  stopped: { label: "已硬停", tone: "error" },
};

export default function AdminCosts() {
  const [summary, setSummary] = useState<AdminCostsSummary | null>(null);
  const [events, setEvents] = useState<AdminCostEventRow[]>([]);
  const [employees, setEmployees] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [saveError, setSaveError] = useState("");
  const [editing, setEditing] = useState("");
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all([
      api.adminCostsSummary(),
      api.adminCostsEvents(50),
      // 姓名只是展示增益：读不到就回落原始 id，不阻塞本页（失败静默）。
      api.adminUsers().catch(() => [] as Record<string, unknown>[]),
    ])
      .then(([nextSummary, page, people]) => {
        if (cancelled) return;
        setSummary(nextSummary);
        setEvents(Array.isArray(page?.events) ? page.events : []);
        setEmployees(employeeNames(people));
        setLoadError("");
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "无法加载成本与预算数据");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const saveBudget = async (row: AdminCostBudgetRow, form: HTMLFormElement) => {
    const draft = readBudgetDraft(form);
    setNotice("");
    setSaveError("");
    if (typeof draft === "string") {
      setSaveError(draft);
      return;
    }
    try {
      await api.adminSaveBudget({
        scope: row.scope,
        scope_ref: row.scope_ref,
        limit_tokens: draft.limit_tokens,
        warn_percent: draft.warn_percent,
        hard_stop_percent: draft.hard_stop_percent,
        enabled: draft.enabled,
        expected_version: row.version ?? 0,
      });
      setEditing("");
      setNotice(`${scopeLabel(row, employees)}预算已保存。`);
      reload();
    } catch (e: unknown) {
      if (isBudgetConflict(e)) {
        setSaveError("预算已被其他操作更新，请刷新后重试。");
        reload();
        return;
      }
      setSaveError(e instanceof Error ? e.message : "预算保存失败");
    }
  };

  const totals = summary?.totals;
  const budgets = summary?.budgets || [];
  const users = summary?.users || [];
  const notes = summary?.notes || [];
  const emptyMonth = Boolean(summary) && (totals?.total_tokens ?? 0) === 0 && !(summary?.agents || []).length;

  return (
    <section className="admin-govern" data-admin-page="costs">
      {notice && <p className="admin-receipt status-ok" data-admin-receipt role="status">{notice}</p>}
      {loadError && <p className="error" role="alert">{loadError}</p>}
      {saveError && <p className="error" role="alert" data-cost-save-error>{saveError}</p>}

      <div className="panel">
        <div className="admin-section-head">
          <div>
            <h2>成本与预算</h2>
            <p className="muted" data-cost-window>
              {summary ? `${summary.month} · ${summary.timezone}` : "本月窗口读取中"} · 用量为估计值，不显示金额（未配置价格来源）。
            </p>
          </div>
          <button type="button" className="btn ghost sm" data-cost-refresh onClick={reload} disabled={loading}>刷新</button>
        </div>
        <p className="muted">
          逐 Agent 与员工的本月用量、预算状态见下表；命中硬停时由程序阻止新的运行，提额或等待下月恢复。
        </p>
      </div>

      <div className="panel" data-cost-overview>
        <div className="admin-section-head">
          <div>
            <h2>用量概览</h2>
            <p className="muted">公司本月 tokens（线程级估计值）。</p>
          </div>
        </div>
        {emptyMonth ? (
          <p className="muted" data-cost-usage-empty>本月暂无用量记录。</p>
        ) : (
          <dl className="admin-kv" data-cost-totals>
            <div><dt>输入 tokens</dt><dd>{numberText(totals?.input_tokens)}</dd></div>
            <div><dt>输出 tokens</dt><dd>{numberText(totals?.output_tokens)}</dd></div>
            <div><dt>合计 tokens</dt><dd><strong>{numberText(totals?.total_tokens)}</strong></dd></div>
            <div><dt>事件数</dt><dd>{numberText(totals?.events)}</dd></div>
          </dl>
        )}
        <h3>按个人</h3>
        {users.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table" data-cost-user-table>
              <thead>
                <tr>
                  <th>员工</th>
                  <th>输入 tokens</th>
                  <th>输出 tokens</th>
                  <th>合计 tokens</th>
                  <th>事件数</th>
                </tr>
              </thead>
              <tbody>
                {users.map((row) => (
                  <tr key={row.user_id} data-cost-user-row={row.user_id}>
                    <td>{personCell(row.user_id, employees)}</td>
                    <td>{numberText(row.input_tokens)}</td>
                    <td>{numberText(row.output_tokens)}</td>
                    <td>{numberText(row.total_tokens)}</td>
                    <td>{numberText(row.events)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : summary ? (
          <p className="muted" data-cost-user-empty>本月暂无个人用量记录。</p>
        ) : loadError ? (
          <p className="muted">用量未读取。</p>
        ) : (
          <p className="muted">正在读取本月用量…</p>
        )}
        <h3>缺口清单</h3>
        {notes.length ? (
          <ul className="cost-notes" data-cost-notes>
            {notes.map((code) => (
              <li key={code}>{COST_NOTE_TEXT[code] || `未登记的缺口标记：${code}`}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">尚未读取到缺口清单。</p>
        )}
      </div>

      <div className="panel" data-cost-budgets>
        <div className="admin-section-head">
          <div>
            <h2>预算</h2>
            <p className="muted">
              上限留空 = 不设限（不判定）；保存按当前版本写入，期间他人改过会提示刷新后重试。
              员工行只阻断该员工触发的新运行；判定顺序：公司 → Agent → 员工。
            </p>
          </div>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table" data-cost-budget-table>
            <thead>
              <tr>
                <th>范围</th>
                <th>状态</th>
                <th>本月用量</th>
                <th>预算设置</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {budgets.map((row) => {
                const key = budgetKey(row);
                const state = BUDGET_STATE[row.state] || { label: String(row.state || "未知"), tone: "unattached" };
                const open = editing === key;
                return (
                  <Fragment key={key}>
                    <tr data-cost-budget-row={key}>
                      <td>{scopeCell(row, employees)}</td>
                      <td>
                        <span className={`admin-status is-${state.tone}`} data-cost-budget-state={row.state}>{state.label}</span>
                      </td>
                      <td>
                        <div className="cost-cell">
                          <div className="cost-meter" data-state={row.state} aria-hidden="true">
                            <span style={{ width: `${meterWidth(row.percent)}%` }} />
                          </div>
                          <span className="cost-value" data-cost-budget-usage>
                            {usageText(row)} · {row.percent == null ? "—" : `${row.percent}%`}
                          </span>
                        </div>
                      </td>
                      <td className="muted">
                        {row.version == null
                          ? "未配置"
                          : `上限 ${numberText(row.limit_tokens)} tokens · 警示 ${row.warn_percent}% · 硬停 ${row.hard_stop_percent}% · ${row.enabled === 1 ? "已启用判定" : "已停用判定"}`}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn ghost sm"
                          data-cost-budget-edit={key}
                          aria-expanded={open}
                          onClick={() => setEditing(open ? "" : key)}
                        >
                          {open ? "收起" : "编辑预算"}
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr className="cost-budget-editor" data-cost-budget-editor={key}>
                        <td colSpan={5}>
                          <form
                            key={`${key}:${row.version ?? 0}`}
                            noValidate
                            onSubmit={(e) => {
                              e.preventDefault();
                              void saveBudget(row, e.currentTarget);
                            }}
                          >
                            <div className="cost-budget-form">
                              <label className="field">
                                上限 tokens（留空 = 不设限）
                                <input name="limit_tokens" type="number" min="1" defaultValue={row.limit_tokens ?? ""} />
                              </label>
                              <label className="field">
                                警示百分比
                                <input name="warn_percent" type="number" min="0" max="100" defaultValue={row.warn_percent ?? 80} />
                              </label>
                              <label className="field">
                                硬停百分比
                                <input name="hard_stop_percent" type="number" min="0" max="100" defaultValue={row.hard_stop_percent ?? 100} />
                              </label>
                              <label className="check">
                                <input name="enabled" type="checkbox" defaultChecked={row.enabled !== 0} />
                                启用预算判定
                              </label>
                              <button type="submit" className="btn ghost sm" data-cost-budget-save>保存预算</button>
                            </div>
                            <p className="muted">未配置的行按输入的上限与勾选状态写入；当前版本 {row.version ?? 0}。</p>
                          </form>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {!budgets.length && !loading && <p className="muted">未读取到预算行。</p>}
      </div>

      <div className="panel" data-cost-events>
        <div className="admin-section-head">
          <div>
            <h2>最近事件</h2>
            <p className="muted">按时间倒序，最多 50 条；金额列相位未建，故不显示。</p>
          </div>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table" data-cost-event-table>
            <thead>
              <tr>
                <th>时间</th>
                <th>Agent</th>
                <th>技能</th>
                <th>线程</th>
                <th>输入 tokens</th>
                <th>输出 tokens</th>
                <th>合计 tokens</th>
                <th>来源</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} data-cost-event={event.id}>
                  <td>{timeLabel(event.occurred_at)}</td>
                  <td>{event.agent_id || "—"}</td>
                  <td>{event.skill_id || "—"}</td>
                  <td className="muted">{event.thread_id || "—"}</td>
                  <td>{numberText(event.input_tokens)}</td>
                  <td>{numberText(event.output_tokens)}</td>
                  <td>{numberText(event.total_tokens)}</td>
                  <td className="muted">{event.source || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!events.length && <p className="muted" data-cost-events-empty>暂无事件。</p>}
      </div>

      <div className="panel" data-cost-disclosure>
        <h2>诚实说明</h2>
        <ul className="cost-notes">
          {COST_NOTE_CODES.map((code) => (
            <li key={code}>{COST_NOTE_TEXT[code]}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function budgetKey(row: AdminCostBudgetRow): string {
  return `${row.scope}:${row.scope_ref}`;
}

/** 员工 id → 姓名映射；只收有名字的行（取不到名字的 id 由 personLabel 回落显示原始 id）。 */
function employeeNames(rows: Record<string, unknown>[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = String(row?.id || "").trim();
    const name = String(row?.name || row?.username || "").trim();
    if (id && name) map[id] = name;
  }
  return map;
}

/** 姓名优先，取不到就显示原始 id；取到姓名时另给 muted 的 id 便于核对。 */
function personLabel(employees: Record<string, string>, userId: string): { name: string; id: string | null } {
  const name = employees[userId] || "";
  return name ? { name, id: userId } : { name: userId, id: null };
}

function personCell(userId: string, employees: Record<string, string>) {
  const person = personLabel(employees, userId);
  return (
    <>
      <strong>{person.name}</strong>
      {person.id && <p className="muted">{person.id}</p>}
    </>
  );
}

/** 范围列：公司给 scope_ref，Agent 给 id，员工给姓名（取到姓名时 muted 补 id）。 */
function scopeCell(row: AdminCostBudgetRow, employees: Record<string, string>) {
  if (row.scope === "company") {
    return (
      <>
        <strong>公司</strong>
        <p className="muted">{row.scope_ref}</p>
      </>
    );
  }
  if (row.scope === "user") return personCell(row.scope_ref, employees);
  return <strong>{row.scope_ref}</strong>;
}

function scopeLabel(row: AdminCostBudgetRow, employees: Record<string, string>): string {
  if (row.scope === "company") return "公司";
  if (row.scope === "user") return personLabel(employees, row.scope_ref).name;
  return row.scope_ref;
}

function numberText(value: number | null | undefined): string {
  if (value == null) return "—";
  const num = Number(value);
  return Number.isFinite(num) ? num.toLocaleString("zh-CN") : "—";
}

function usageText(row: AdminCostBudgetRow): string {
  if (row.limit_tokens == null) return `${numberText(row.used_tokens)} tokens（不设限）`;
  return `${numberText(row.used_tokens)} / ${numberText(row.limit_tokens)} tokens`;
}

/** 进度条宽度：超过 100% 也只画满（真实溢出由百分比数字表达）。 */
function meterWidth(percent: number | null): number {
  if (percent == null || !Number.isFinite(percent)) return 0;
  return Math.min(100, Math.max(0, Math.round(percent)));
}

function timeLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value || "—" : date.toLocaleString("zh-CN", { hour12: false });
}

/** 409 版本冲突：可能带 status，也可能只剩 detail.code（老后端）。 */
function isBudgetConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { status, payload } = error as { status?: unknown; payload?: unknown };
  if (Number(status) === 409) return true;
  const detail = payload && typeof payload === "object" ? (payload as { detail?: unknown }).detail : null;
  return Boolean(
    detail
    && typeof detail === "object"
    && (detail as { code?: unknown }).code === "cost_budget_version_conflict",
  );
}

type BudgetDraft = {
  limit_tokens: number | null;
  warn_percent: number;
  hard_stop_percent: number;
  enabled: boolean;
};

/** 表单 → 请求体；返回字符串表示本地校验没过（不发出请求）。 */
function readBudgetDraft(form: HTMLFormElement): BudgetDraft | string {
  const data = new FormData(form);
  const rawLimit = String(data.get("limit_tokens") ?? "").trim();
  const limitTokens = rawLimit === "" ? null : Number(rawLimit);
  if (limitTokens !== null && (!Number.isInteger(limitTokens) || limitTokens <= 0)) {
    return "上限 tokens 请填正整数，留空表示不设限。";
  }
  const fields: Array<[string, number]> = [
    ["警示百分比", percentField(data, "warn_percent", 80)],
    ["硬停百分比", percentField(data, "hard_stop_percent", 100)],
  ];
  for (const [label, value] of fields) {
    if (!Number.isInteger(value) || value < 0 || value > 100) return `${label}请填 0–100 的整数。`;
  }
  const warnPercent = fields[0][1];
  const hardStopPercent = fields[1][1];
  if (hardStopPercent < warnPercent) return "硬停百分比必须不小于警示百分比。";
  return {
    limit_tokens: limitTokens,
    warn_percent: warnPercent,
    hard_stop_percent: hardStopPercent,
    enabled: data.get("enabled") === "on",
  };
}

function percentField(data: FormData, name: string, fallback: number): number {
  const raw = String(data.get(name) ?? "").trim();
  return raw === "" ? fallback : Number(raw);
}
