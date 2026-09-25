import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { SkillConnectorBindings } from "../components/SkillConnectorBindings";

type SkillRow = {
  id: string;
  label: string;
  title: string;
  description: string;
  category?: string;
  profile?: string;
  source?: string;
  required_inputs?: string[];
  input_schema?: Array<Record<string, unknown>> | null;
  result_type?: string | null;
  result_schema?: Record<string, unknown> | null;
  next_actions?: Array<Record<string, unknown>>;
  memory_policy?: Record<string, unknown> | null;
  supports?: Record<string, boolean> | null;
  updated_at?: string | null;
  grants?: Grant[];
  lifecycle?: {
    stage: string;
    stage_label: string;
    owner: string | null;
    business_stage: string | null;
    tags: string[];
    current_version: number | null;
    test_summary: { total: number; pass_rate: number | null; failing: number; last_run_at: string | null };
  };
};

type DirectoryEntry = { id: string; name: string; org_id?: string };
type Grant = { scope: string; scope_id: string };

const STAGES = [
  { id: "draft", label: "新建草稿", hint: "填写基础信息" },
  { id: "editing", label: "编辑配置", hint: "完善技能能力" },
  { id: "testing", label: "测试验证", hint: "验证展示效果" },
  { id: "published", label: "发布上线", hint: "当前阶段" },
  { id: "disabled", label: "已停用", hint: "保留历史" },
];

const STEP_INDEX: Record<string, number> = { draft: 0, editing: 1, testing: 2, published: 3, disabled: 4 };

const NEXT_ACTIONS: Record<string, { stage: string; label: string; needReason?: boolean }[]> = {
  draft: [{ stage: "editing", label: "进入编辑配置" }],
  editing: [
    { stage: "testing", label: "进入测试验证" },
    { stage: "draft", label: "退回草稿" },
  ],
  testing: [
    { stage: "published", label: "发布上线" },
    { stage: "editing", label: "退回编辑" },
  ],
  published: [
    { stage: "disabled", label: "停用技能", needReason: true },
    { stage: "testing", label: "重新测试" },
  ],
  disabled: [{ stage: "testing", label: "重新启用" }],
};

const card = {
  background: "#fff",
  border: "1px solid #ececf1",
  borderRadius: 12,
  padding: 16,
} as const;

const btn = {
  border: "1px solid #e3e3ec",
  background: "#fff",
  borderRadius: 8,
  padding: "6px 12px",
  fontSize: 13,
  cursor: "pointer",
} as const;

const btnPrimary = { ...btn, background: "var(--primary)", borderColor: "var(--primary)", color: "var(--primary-fg)" } as const;

const input = {
  border: "1px solid #e3e3ec",
  borderRadius: 8,
  padding: "6px 10px",
  fontSize: 13,
  width: "100%",
  boxSizing: "border-box",
} as const;

function StageDot({ stage }: { stage: string }) {
  const color = stage === "published" ? "var(--success)" : stage === "disabled" ? "var(--text-muted)" : stage === "testing" ? "var(--warning)" : "var(--accent)";
  return <span style={{ width: 8, height: 8, borderRadius: 8, background: color, display: "inline-block" }} />;
}

export default function SkillLifecycle() {
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [directory, setDirectory] = useState<DirectoryEntry[]>([]);
  const [grants, setGrants] = useState<Record<string, Grant[]>>({});
  const [selected, setSelected] = useState<string>("");
  const [keyword, setKeyword] = useState("");
  const [tab, setTab] = useState<"all" | "mine">("all");
  const [error, setError] = useState("");
  const [metricsDays, setMetricsDays] = useState(7);

  const load = useCallback(async () => {
    try {
      const data = (await api.adminSkills()) as { skills?: SkillRow[]; directory?: DirectoryEntry[] };
      setSkills(data.skills || []);
      setDirectory(data.directory || []);
      const grantsMap: Record<string, Grant[]> = {};
      for (const s of data.skills || []) if (s.grants) grantsMap[s.id] = s.grants;
      setGrants(grantsMap);
      if (!selected && data.skills?.length) setSelected(data.skills[0].id);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  }, [selected]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = useMemo(() => skills.find((s) => s.id === selected) || null, [skills, selected]);
  const filtered = useMemo(
    () =>
      skills.filter((s) => {
        if (tab === "mine" && s.lifecycle?.owner && s.lifecycle.owner !== "我") return false;
        const kw = keyword.trim().toLowerCase();
        if (!kw) return true;
        return (
          s.label.toLowerCase().includes(kw)
          || s.id.toLowerCase().includes(kw)
          || (s.description || "").toLowerCase().includes(kw)
        );
      }),
    [skills, keyword, tab],
  );

  async function moveStage(stage: string, needReason?: boolean) {
    if (!current) return;
    let reason: string | undefined;
    if (needReason) {
      const text = window.prompt("请填写操作原因（必填）");
      if (!text || !text.trim()) return;
      reason = text;
      if (!reason || !reason.trim()) return;
    }
    try {
      await api.skillLifecycleStage(current.id, stage, reason);
      await load();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "240px minmax(0,1fr) 260px", gap: 16, padding: 16, alignItems: "start" }}>
      {error && (
        <div style={{ gridColumn: "1 / -1", background: "#fef2f2", color: "#b91c1c", borderRadius: 8, padding: "8px 12px", fontSize: 13 }}>
          {error}
          <button style={{ ...btn, marginLeft: 8 }} onClick={() => setError("")}>关闭</button>
        </div>
      )}

      {/* 左栏：技能列表 */}
      <div style={{ ...card, position: "sticky", top: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 10 }}>技能列表</div>
        <input style={input} placeholder="搜索技能名称或 Key" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
        <div style={{ display: "flex", gap: 12, margin: "10px 0", fontSize: 13 }}>
          {(["all", "mine"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{ ...btn, border: "none", padding: "2px 0", color: tab === t ? "var(--accent-text)" : "var(--text-muted)", fontWeight: tab === t ? 600 : 400 }}
            >
              {t === "all" ? "全部" : "我负责的"}
            </button>
          ))}
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          {filtered.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelected(s.id)}
              style={{
                ...btn,
                textAlign: "left",
                background: s.id === selected ? "color-mix(in srgb, var(--accent) 8%, var(--bg))" : "var(--bg)",
                borderColor: s.id === selected ? "var(--accent)" : "transparent",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <strong style={{ fontSize: 13 }}>{s.label}</strong>
                <span style={{ fontSize: 12, color: "#8a8fa3" }}>
                  {s.lifecycle?.current_version ? `v${s.lifecycle.current_version}` : ""}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "#8a8fa3", display: "flex", gap: 6, alignItems: "center", marginTop: 2 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{s.id}</span>
                {s.lifecycle && <span style={{ marginLeft: "auto", display: "flex", gap: 4, alignItems: "center" }}>
                  <StageDot stage={s.lifecycle.stage} />{s.lifecycle.stage_label}
                </span>}
              </div>
            </button>
          ))}
          {!filtered.length && <div style={{ fontSize: 13, color: "#8a8fa3" }}>没有匹配的技能</div>}
        </div>
      </div>

      {/* 中栏：详情 */}
      <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
        {!current && <div style={card}>请选择左侧技能</div>}
        {current && <DetailPanel key={current.id} skill={current} directory={directory} grants={grants} onGrants={(m) => setGrants((prev) => ({ ...prev, ...m }))} onStage={moveStage} onChanged={load} metricsDays={metricsDays} onMetricsDays={setMetricsDays} />}
      </div>

      {/* 右栏：详细功能说明 */}
      <div style={{ ...card, position: "sticky", top: 16, fontSize: 12, color: "#5a6072" }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: "#1c2333", marginBottom: 8 }}>详细功能说明</div>
        <ol style={{ paddingLeft: 18, display: "grid", gap: 8, lineHeight: 1.6 }}>
          <li><strong>新建技能</strong>：在技能市场新建后进入草稿阶段，可分阶段完善。</li>
          <li><strong>编辑配置</strong>：修改说明、Profile、工具依赖、输入输出与边界规则。</li>
          <li><strong>测试验证</strong>：登记测试用例并记录通过情况，未通过项定位问题后优化。</li>
          <li><strong>发布上线</strong>：发布即生成版本快照，支持一键回滚到任意历史版本。</li>
          <li><strong>权限分配</strong>：按组织、团队、个人授权，控制技能可见范围与展示。</li>
          <li><strong>运行监控</strong>：聚合真实任务运行数据，呈现调用次数、成功率与告警。</li>
        </ol>
      </div>
    </div>
  );
}

function DetailPanel(props: {
  skill: SkillRow;
  directory: DirectoryEntry[];
  grants: Record<string, Grant[]>;
  onGrants: (m: Record<string, Grant[]>) => void;
  onStage: (stage: string, needReason?: boolean) => void;
  onChanged: () => Promise<void>;
  metricsDays: number;
  onMetricsDays: (d: number) => void;
}) {
  const { skill, directory, onStage, onChanged } = props;
  const lc = skill.lifecycle;
  const [versions, setVersions] = useState<Array<Record<string, unknown>>>([]);
  const [tests, setTests] = useState<Array<Record<string, unknown>>>([]);
  const [metrics, setMetrics] = useState<{ calls: number; success_rate: number | null; avg_duration_ms: number | null; alerts: number; trend: { day: string; n: number }[] } | null>(null);
  const [newTest, setNewTest] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [contractText, setContractText] = useState(() => JSON.stringify({
    required_inputs: skill.required_inputs || skill.input_schema?.filter((field) => field.required === true).map((field) => field.key) || [],
    input_schema: skill.input_schema || [],
    result_type: skill.result_type || "",
    ...(skill.result_schema ? { result_schema: skill.result_schema } : {}),
    next_actions: skill.next_actions || [],
    ...(skill.memory_policy ? { memory_policy: skill.memory_policy } : {}),
    supports: skill.supports || { cancel: false, retry: false, resume: false },
  }, null, 2));
  const [contractError, setContractError] = useState("");
  const [contractBusy, setContractBusy] = useState(false);
  const step = lc ? STEP_INDEX[lc.stage] ?? 0 : 0;
  const maxTrend = Math.max(1, ...(metrics?.trend.map((t) => t.n) || [1]));

  const reloadAll = useCallback(async () => {
    const [v, t, m] = await Promise.all([
      api.skillVersions(skill.id).catch(() => ({ versions: [] })),
      api.skillTests(skill.id).catch(() => ({ tests: [] })),
      api.skillMetrics(skill.id, props.metricsDays).catch(() => null),
    ]);
    setVersions(v.versions || []);
    setTests(t.tests || []);
    setMetrics(m);
  }, [skill.id, props.metricsDays]);

  useEffect(() => {
    void reloadAll();
  }, [reloadAll]);

  async function publishVersion() {
    const description = window.prompt("版本说明");
    if (description === null) return;
    await api.publishSkillVersion(skill.id, description || undefined);
    await Promise.all([reloadAll(), onChanged()]);
  }

  async function saveContract() {
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(contractText) as Record<string, unknown>;
      if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("根节点必须是 JSON 对象");
    } catch (error) {
      setContractError(error instanceof Error ? error.message : "JSON 格式错误");
      return;
    }
    setContractBusy(true);
    setContractError("");
    try {
      await api.patchAdminSkill(skill.id, {
        required_inputs: Array.isArray(value.required_inputs) ? value.required_inputs.map(String) : (skill.required_inputs || []),
        input_schema: Array.isArray(value.input_schema) ? value.input_schema : [],
        result_type: String(value.result_type || ""),
        ...(value.result_schema && typeof value.result_schema === "object" ? { result_schema: value.result_schema as Record<string, unknown> } : {}),
        next_actions: Array.isArray(value.next_actions) ? value.next_actions : [],
        ...(value.memory_policy && typeof value.memory_policy === "object" ? { memory_policy: value.memory_policy as Record<string, unknown> } : {}),
        supports: value.supports && typeof value.supports === "object" ? value.supports as Record<string, boolean> : { cancel: false, retry: false, resume: false },
      });
      await onChanged();
      setContractError("已保存并立即更新当前技能包；版本快照需另行发布。");
    } catch (error) {
      setContractError(String(error instanceof Error ? error.message : error));
    } finally {
      setContractBusy(false);
    }
  }

  async function rollback(version: number) {
    if (!window.confirm(`确认回滚到 v${version}？当前包将被历史快照覆盖。`)) return;
    await api.rollbackSkillVersion(skill.id, version);
    await Promise.all([reloadAll(), onChanged()]);
  }

  async function addTest() {
    if (!newTest.trim()) return;
    await api.createSkillTest(skill.id, { name: newTest.trim() });
    setNewTest("");
    await reloadAll();
  }

  async function recordResult(testId: string, passed: boolean) {
    let fail_reason: string | undefined;
    if (!passed) {
      fail_reason = window.prompt("失败原因") || "未通过";
    }
    await api.runSkillTests(skill.id, [{ test_id: testId, passed, fail_reason }]);
    await Promise.all([reloadAll(), onChanged()]);
  }

  const grantsForSkill = props.grants[skill.id];

  async function toggleGrant(scope: string, scopeId: string, granted: boolean) {
    const existing = new Set(
      (grantsForSkill || []).filter((g) => g.scope === scope).map((g) => g.scope_id),
    );
    if (granted) existing.add(scopeId);
    else existing.delete(scopeId);
    const body = {
      org: scope === "org" ? [...existing] : (grantsForSkill || []).filter((g) => g.scope === "org").map((g) => g.scope_id),
      team: scope === "team" ? [...existing] : (grantsForSkill || []).filter((g) => g.scope === "team").map((g) => g.scope_id),
      user: scope === "user" ? [...existing] : (grantsForSkill || []).filter((g) => g.scope === "user").map((g) => g.scope_id),
    };
    await api.saveSkillGrants(skill.id, body);
    props.onGrants({ [skill.id]: [
      ...body.org.map((id) => ({ scope: "org", scope_id: id })),
      ...body.team.map((id) => ({ scope: "team", scope_id: id })),
      ...body.user.map((id) => ({ scope: "user", scope_id: id })),
    ] });
  }

  return (
    <>
      {/* 头部 */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{skill.label}</h2>
          {lc && (
            <span style={{ fontSize: 12, color: "#5a6072", display: "inline-flex", gap: 6, alignItems: "center" }}>
              <StageDot stage={lc.stage} /> {lc.stage_label}
            </span>
          )}
          {lc?.current_version ? <span style={btn}>v{lc.current_version}</span> : null}
          <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button style={btn} onClick={publishVersion}>发布新版本</button>
            {(NEXT_ACTIONS[lc?.stage || "draft"] || []).map((a) => (
              <button key={a.stage} style={btnPrimary} onClick={() => onStage(a.stage, a.needReason)}>{a.label}</button>
            ))}
          </span>
        </div>
        <div style={{ fontSize: 12, color: "#8a8fa3", marginTop: 6 }}>Key: {skill.id}</div>
        <div style={{ fontSize: 13, color: "#5a6072", marginTop: 6 }}>{skill.description}</div>
      </div>

      {/* 阶段条 */}
      <div style={{ ...card, display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
        {STAGES.map((s, i) => (
          <span key={s.id} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span
              style={{
                display: "inline-flex", flexDirection: "column", padding: "6px 10px", borderRadius: 10,
                background: i === step ? "#fdeef1" : "transparent",
                outline: i === step ? "2px solid var(--focus-ring)" : "none",
              }}
            >
              <strong style={{ fontSize: 13, color: i <= step ? "#1c2333" : "#a3a8ba" }}>{i + 1}. {s.label}</strong>
              <span style={{ fontSize: 11, color: "#a3a8ba" }}>{s.hint}</span>
            </span>
            {i < STAGES.length - 1 && <span style={{ color: "#d6d9e4" }}>→</span>}
          </span>
        ))}
      </div>

      {/* 核心信息 */}
      <div style={card}>
        <div style={{ fontWeight: 600, marginBottom: 10 }}>核心信息</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, fontSize: 13 }}>
          <Field label="技能名称" value={skill.label} />
          <Field label="Key" value={skill.id} />
          <Field label="当前版本" value={lc?.current_version ? `v${lc.current_version}` : "—"} />
          <Field label="技能类型" value={skill.profile || "—"} />
          <Field label="业务阶段" value={lc?.business_stage || "—"} />
          <Field label="负责人" value={lc?.owner || "未设置"} />
        </div>
        <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {(lc?.tags || []).map((t) => (
            <span key={t} style={{ ...btn, cursor: "default", fontSize: 12 }}># {t}</span>
          ))}
          <input
            style={{ ...input, width: 120 }}
            placeholder="添加标签"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === "Enter" && tagInput.trim()) {
                await api.skillLifecycleMetaSave(skill.id, { tags: [...(lc?.tags || []), tagInput.trim()] });
                setTagInput("");
                await onChanged();
              }
            }}
          />
          <button
            style={btn}
            onClick={async () => {
              const owner = window.prompt("设置负责人", lc?.owner || "");
              if (owner === null) return;
              await api.skillLifecycleMetaSave(skill.id, { owner: owner || undefined });
              await onChanged();
            }}
          >
            设置负责人
          </button>
        </div>
      </div>

      {/* 参数与运行契约 */}
      <section style={card} aria-labelledby="skill-contract-heading">
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
          <strong id="skill-contract-heading">参数与运行契约</strong>
          <span style={{ fontSize: 12, color: "#6b7280" }}>输入字段、结果类型、登记动作、记忆策略与异步能力</span>
        </div>
        <textarea
          aria-label="技能参数与运行契约 JSON"
          value={contractText}
          onChange={(event) => setContractText(event.target.value)}
          rows={12}
          spellCheck={false}
          style={{ ...input, fontSize: "var(--ds-font-sm)", resize: "vertical", fontFamily: "ui-monospace, Consolas, monospace", lineHeight: 1.45 }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
          <button type="button" style={btnPrimary} disabled={contractBusy} onClick={() => void saveContract()}>
            {contractBusy ? "保存中…" : "保存契约"}
          </button>
          <span role="status" style={{ fontSize: "var(--ds-font-helper)", color: contractError.startsWith("已保存") ? "var(--success)" : "var(--text-muted)", overflowWrap: "anywhere" }}>
            {contractError || "保存会立即更新当前技能包；发布新版本会另存快照。选项来源由服务端登记白名单校验。"}
          </span>
        </div>
      </section>

      <div style={card}>
        <SkillConnectorBindings skillId={skill.id} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
        {/* 测试验证 */}
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <strong>测试验证</strong>
            <span style={{ fontSize: 12, color: "#8a8fa3" }}>
              用例 {lc?.test_summary.total ?? 0} · 通过率 {lc?.test_summary.pass_rate ?? "—"}% · 未通过 {lc?.test_summary.failing ?? 0}
            </span>
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <input style={input} placeholder="新增用例名称" value={newTest} onChange={(e) => setNewTest(e.target.value)} />
            <button style={btn} onClick={addTest}>添加</button>
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            {tests.map((t) => (
              <div key={String(t.id)} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{String(t.name)}</span>
                <button style={btn} onClick={() => recordResult(String(t.id), true)}>通过</button>
                <button style={btn} onClick={() => recordResult(String(t.id), false)}>未通过</button>
                <button style={btn} onClick={async () => { await api.deleteSkillTest(skill.id, String(t.id)); await reloadAll(); }}>删除</button>
              </div>
            ))}
            {!tests.length && <div style={{ fontSize: 12, color: "#8a8fa3" }}>暂无用例</div>}
          </div>
        </div>

        {/* 运行监控 */}
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <strong>运行监控</strong>
            <select style={{ ...btn, marginLeft: "auto" }} value={props.metricsDays} onChange={(e) => props.onMetricsDays(Number(e.target.value))}>
              <option value={7}>近 7 天</option>
              <option value={30}>近 30 天</option>
              <option value={90}>近 90 天</option>
            </select>
          </div>
          {metrics ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, textAlign: "center" }}>
                <Stat label="调用次数" value={String(metrics.calls)} />
                <Stat label="成功率" value={metrics.success_rate === null ? "—" : `${metrics.success_rate}%`} />
                <Stat label="平均耗时" value={metrics.avg_duration_ms === null ? "—" : `${metrics.avg_duration_ms}ms`} />
                <Stat label="告警次数" value={String(metrics.alerts)} />
              </div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 80, marginTop: 12 }}>
                {metrics.trend.map((t) => (
                  <div
                    key={t.day}
                    title={`${t.day}: ${t.n}`}
                    style={{ flex: 1, background: "#f7a6b3", borderRadius: 3, height: `${(t.n / maxTrend) * 100}%`, minHeight: 3 }}
                  />
                ))}
                {!metrics.trend.length && <div style={{ fontSize: 12, color: "#8a8fa3" }}>该周期内暂无调用记录</div>}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: "#8a8fa3" }}>加载中…</div>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
        {/* 权限分配 */}
        <div style={card}>
          <div style={{ fontWeight: 600, marginBottom: 10 }}>权限分配（按组织）</div>
          {!grantsForSkill && <div style={{ fontSize: 12, color: "#8a8fa3" }}>加载授权中…</div>}
          <div style={{ display: "grid", gap: 6 }}>
            {(grantsForSkill || []).length >= 0 && directory.map((org) => {
              const granted = (grantsForSkill || []).some((g) => g.scope === "org" && g.scope_id === org.id);
              return (
                <label key={org.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                  <input type="checkbox" checked={granted} onChange={(e) => toggleGrant("org", org.id, e.target.checked)} />
                  {org.name}
                </label>
              );
            })}
          </div>
          <div style={{ fontSize: 11, color: "#a3a8ba", marginTop: 8 }}>团队与个人授权可在管理控制台中进一步细化。</div>
        </div>

        {/* 版本管理 */}
        <div style={card}>
          <div style={{ fontWeight: 600, marginBottom: 10 }}>版本管理</div>
          <div style={{ display: "grid", gap: 6 }}>
            {versions.map((v) => (
              <div key={String(v.id)} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                <strong>v{String(v.version)}</strong>
                <span style={{ color: "#19b37b", fontSize: 12 }}>{String(v.status)}</span>
                <span style={{ flex: 1, color: "#8a8fa3", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {String(v.description || "—")}
                </span>
                <button style={btn} onClick={() => rollback(Number(v.version))}>回滚</button>
              </div>
            ))}
            {!versions.length && <div style={{ fontSize: 12, color: "#8a8fa3" }}>尚未发布版本</div>}
          </div>
        </div>
      </div>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "#a3a8ba" }}>{label}</div>
      <div>{value}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 600 }}>{value}</div>
      <div style={{ fontSize: 11, color: "#a3a8ba" }}>{label}</div>
    </div>
  );
}
