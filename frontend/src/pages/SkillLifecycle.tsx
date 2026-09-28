import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { SkillTemplate } from "../api";
import { SkillConnectorBindings } from "../components/SkillConnectorBindings";
import "./skill-governance.css";

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
  grants?: GrantSet;
  lifecycle?: {
    stage: string;
    stage_label: string;
    origin?: "official" | "third_party";
    owner: string | null;
    business_stage: string | null;
    tags: string[];
    current_version: number | null;
    test_summary: { total: number; pass_rate: number | null; failing: number; last_run_at: string | null };
  };
};

type Directory = {
  orgs: { id: string; name: string }[];
  teams: { id: string; org_id: string; name: string }[];
  users: { id: string; handle: string; name: string; role: string }[];
};
type GrantSet = { org: string[]; team: string[]; user: string[] };
type GrantScope = keyof GrantSet;

const EMPTY_DIRECTORY: Directory = { orgs: [], teams: [], users: [] };
const EMPTY_GRANTS: GrantSet = { org: [], team: [], user: [] };

const STAGES = [
  { id: "draft", label: "新建草稿", hint: "填写基础信息" },
  { id: "editing", label: "编辑配置", hint: "完善技能能力" },
  { id: "testing", label: "测试验证", hint: "验证展示效果" },
  { id: "published", label: "发布上线", hint: "当前阶段" },
  { id: "disabled", label: "已停用", hint: "保留历史" },
];

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

function StageDot({ stage }: { stage: string }) {
  return <span className="skill-stage-dot" data-stage={stage} aria-hidden="true" />;
}

function skillContract(skill: SkillRow): Record<string, unknown> {
  return {
    required_inputs: skill.required_inputs || skill.input_schema?.filter((field) => field.required === true).map((field) => field.key) || [],
    input_schema: skill.input_schema || [],
    result_type: skill.result_type || "",
    ...(skill.result_schema ? { result_schema: skill.result_schema } : {}),
    next_actions: skill.next_actions || [],
    ...(skill.memory_policy ? { memory_policy: skill.memory_policy } : {}),
    supports: skill.supports || { cancel: false, retry: false, resume: false },
  };
}

export default function SkillLifecycle() {
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [directory, setDirectory] = useState<Directory>(EMPTY_DIRECTORY);
  const [grants, setGrants] = useState<Record<string, GrantSet>>({});
  const [selected, setSelected] = useState<string>("");
  const [keyword, setKeyword] = useState("");
  const [error, setError] = useState("");
  const [metricsDays, setMetricsDays] = useState(7);
  const [sourceFilter, setSourceFilter] = useState<"all" | "official" | "third_party">("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [uploadOpen, setUploadOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const detailDialogRef = useRef<HTMLElement | null>(null);

  const load = useCallback(async () => {
    try {
      const data = (await api.adminSkills()) as { skills?: SkillRow[]; directory?: Directory };
      setSkills(data.skills || []);
      setDirectory(data.directory || EMPTY_DIRECTORY);
      const grantsMap: Record<string, GrantSet> = {};
      for (const s of data.skills || []) if (s.grants) grantsMap[s.id] = s.grants;
      setGrants(grantsMap);
      setSelected((current) => data.skills?.some((skill) => skill.id === current) ? current : "");
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selected) return;
    const dialog = detailDialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (dialog?.querySelector<HTMLElement>('button[aria-label="关闭技能详情"]') || dialog)?.focus();
    const containFocus = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSelected("");
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])',
      )].filter((node) => node.getAttribute("aria-hidden") !== "true" && node.getClientRects().length > 0);
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", containFocus);
    return () => {
      window.removeEventListener("keydown", containFocus);
      requestAnimationFrame(() => {
        if (previousFocus?.isConnected) previousFocus.focus();
        else searchRef.current?.focus();
      });
    };
  }, [selected]);

  const current = useMemo(() => skills.find((s) => s.id === selected) || null, [skills, selected]);
  const filtered = useMemo(
    () =>
      skills.filter((s) => {
        const isOfficial = s.lifecycle?.origin
          ? s.lifecycle.origin === "official"
          : s.source === "bundled" || !(s.lifecycle?.tags || []).includes("第三方");
        if (sourceFilter === "official" && !isOfficial) return false;
        if (sourceFilter === "third_party" && isOfficial) return false;
        if (stageFilter !== "all" && s.lifecycle?.stage !== stageFilter) return false;
        const kw = keyword.trim().toLowerCase();
        if (!kw) return true;
        return (
          s.label.toLowerCase().includes(kw)
          || s.id.toLowerCase().includes(kw)
          || (s.description || "").toLowerCase().includes(kw)
        );
      }),
    [skills, keyword, sourceFilter, stageFilter],
  );

  async function moveStage(stage: string, needReason?: boolean) {
    if (!current) return;
    if (stage === "published" && !window.confirm("确认发布？发布会应用待发布草稿、生成版本快照，并让员工使用新版本。")) return;
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
    <div className="skill-governance-page">
      <header className="skill-governance-header">
        <div>
          <h1>技能管理</h1>
          <p>治理技能内容、工具与知识依赖、授权、测试和发布版本。</p>
        </div>
        <button type="button" className="skill-governance-primary" onClick={() => setUploadOpen(true)}>上传技能</button>
      </header>
      <label className="skill-governance-search">
        <span aria-hidden>⌕</span>
        <input ref={searchRef} aria-label="搜索技能" placeholder="搜索技能名称、Key 或说明" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
      </label>
      <div className="skill-governance-filter-row" aria-label="筛选技能">
        <div className="skill-governance-segments" aria-label="来源">
          {([['all', '全部'], ['official', '官方'], ['third_party', '第三方']] as const).map(([value, label]) => (
            <button type="button" key={value} aria-pressed={sourceFilter === value} className={sourceFilter === value ? "is-active" : ""} onClick={() => setSourceFilter(value)}>{label}</button>
          ))}
        </div>
        <select aria-label="发布状态" value={stageFilter} onChange={(event) => setStageFilter(event.target.value)}>
          <option value="all">全部状态</option>
          {STAGES.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}
        </select>
        <span className="skill-governance-result-count">{filtered.length} 项技能</span>
      </div>
      {error && (
        <div className="skill-governance-error" role="alert">
          {error}
          <button className="skill-governance-secondary" onClick={() => setError("")}>关闭</button>
        </div>
      )}
      <div className="skill-governance-list" aria-label="技能列表">
        {filtered.map((s) => {
          const official = s.lifecycle?.origin
            ? s.lifecycle.origin === "official"
            : s.source === "bundled" || !(s.lifecycle?.tags || []).includes("第三方");
          return (
            <button type="button" className="skill-governance-row" key={s.id} onClick={() => setSelected(s.id)}>
              <span className="skill-governance-row-main">
                <strong>{s.label}</strong>
                <span className="skill-governance-row-meta"><code>{s.id}</code><span className={`skill-origin-tag${official ? " is-official" : " is-third-party"}`}>{official ? "官方" : "第三方"}</span></span>
              </span>
              <span className="skill-governance-row-description">{s.description || "暂无说明"}</span>
              <span className="skill-governance-row-status"><StageDot stage={s.lifecycle?.stage || "draft"} />{s.lifecycle?.stage_label || "未配置阶段"}</span>
              <span className="skill-governance-row-version">{s.lifecycle?.current_version ? `v${s.lifecycle.current_version}` : "未发布"}</span>
              <span className="skill-governance-row-open" aria-hidden>›</span>
            </button>
          );
        })}
        {!filtered.length && <div className="skill-governance-empty">{keyword ? "没有匹配的技能" : "当前筛选下暂无技能"}</div>}
      </div>
      {current && (
        <div className="skill-governance-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(""); }}>
          <section ref={detailDialogRef} tabIndex={-1} className="skill-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="skill-detail-title">
            <DetailPanel key={current.id} skill={current} directory={directory} grants={grants} onGrants={(m) => setGrants((prev) => ({ ...prev, ...m }))} onStage={moveStage} onChanged={load} metricsDays={metricsDays} onMetricsDays={setMetricsDays} onClose={() => setSelected("")} />
          </section>
        </div>
      )}
      {uploadOpen && <SkillUploadDialog onClose={() => setUploadOpen(false)} onImported={async (id) => { await load(); setSelected(id); setUploadOpen(false); }} />}
    </div>
  );
}

function SkillUploadDialog({ onClose, onImported }: { onClose: () => void; onImported: (id: string) => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const dialogRef = useRef<HTMLElement | null>(null);
  const busyRef = useRef(busy);
  const closeRef = useRef(onClose);
  busyRef.current = busy;
  closeRef.current = onClose;
  const chooseFile = (candidate?: File) => {
    setError("");
    if (!candidate) { setFile(null); return; }
    if (!/\.md$/i.test(candidate.name)) { setFile(null); setError("仅支持 .md 文件。"); return; }
    if (candidate.size > 128 * 1024) { setFile(null); setError("Markdown 文件不能超过 128 KB。"); return; }
    setFile(candidate);
  };
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (dialog?.querySelector<HTMLElement>("button:not(:disabled)") || dialog)?.focus();
    const manageKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])',
      )].filter((node) => node.getAttribute("aria-hidden") !== "true" && node.getClientRects().length > 0);
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", manageKeys);
    return () => {
      window.removeEventListener("keydown", manageKeys);
      requestAnimationFrame(() => { if (previousFocus?.isConnected) previousFocus.focus(); });
    };
  }, []);
  const importFile = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.importAdminSkill(file);
      await onImported(String(result.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "导入技能失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="skill-governance-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section ref={dialogRef} tabIndex={-1} className="skill-upload-dialog" role="dialog" aria-modal="true" aria-labelledby="skill-upload-title">
        <header>
          <div><h2 id="skill-upload-title">上传技能</h2><p>导入本地 SKILL.md，校验后保存为第三方技能草稿。</p></div>
          <button type="button" className="skill-governance-icon" aria-label="关闭" disabled={busy} onClick={onClose}>×</button>
        </header>
        <label className={`skill-upload-drop${file ? " has-file" : ""}${dragging ? " is-dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files?.[0]); }}>
          <input type="file" accept=".md,text/markdown" onChange={(event) => chooseFile(event.target.files?.[0])} />
          <span className="skill-upload-mark" aria-hidden>⇧</span>
          <strong>{file ? file.name : "选择或拖入 Markdown 文件"}</strong>
          <span>{file ? `${Math.ceil(file.size / 1024)} KB · 将进行结构、工具和密钥检查` : "仅支持 .md，最大 128 KB"}</span>
        </label>
        <div className="skill-upload-notes">
          <strong>导入结果</strong>
          <span>技能进入草稿，不会立即向员工开放；工具、知识、授权和测试需要另行核对。</span>
        </div>
        {error && <p className="skill-upload-error" role="alert">{error}</p>}
        <footer>
          <button type="button" className="skill-governance-secondary" disabled={busy} onClick={onClose}>取消</button>
          <button type="button" className="skill-governance-primary" disabled={!file || busy} onClick={() => void importFile()}>{busy ? "导入中…" : "导入为草稿"}</button>
        </footer>
      </section>
    </div>
  );
}

function DetailPanel(props: {
  skill: SkillRow;
  directory: Directory;
  grants: Record<string, GrantSet>;
  onGrants: (m: Record<string, GrantSet>) => void;
  onStage: (stage: string, needReason?: boolean) => void;
  onChanged: () => Promise<void>;
  metricsDays: number;
  onMetricsDays: (d: number) => void;
  onClose: () => void;
}) {
  const { skill, directory, onStage, onChanged } = props;
  const lc = skill.lifecycle;
  const [versions, setVersions] = useState<Array<Record<string, unknown>>>([]);
  const [tests, setTests] = useState<Array<Record<string, unknown>>>([]);
  const [metrics, setMetrics] = useState<{ calls: number; success_rate: number | null; avg_duration_ms: number | null; alerts: number; trend: { day: string; n: number }[] } | null>(null);
  const [newTest, setNewTest] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [titleText, setTitleText] = useState(skill.title || skill.label);
  const [summaryText, setSummaryText] = useState(skill.description || "");
  const [bodyText, setBodyText] = useState("");
  const [contentLoading, setContentLoading] = useState(true);
  const [contentBusy, setContentBusy] = useState(false);
  const [contentNotice, setContentNotice] = useState("");
  const [contractText, setContractText] = useState(() => JSON.stringify(skillContract(skill), null, 2));
  const [contractError, setContractError] = useState("");
  const [contractBusy, setContractBusy] = useState(false);
  const maxTrend = Math.max(1, ...(metrics?.trend.map((t) => t.n) || [1]));

  useEffect(() => {
    let active = true;
    setContentLoading(true);
    void Promise.all([api.adminSkillSop(skill.id), api.adminSkillDraft(skill.id)]).then(([source, draft]) => {
      if (!active) return;
      setTitleText(String(draft.patch.title ?? skill.title ?? skill.label));
      setSummaryText(String(draft.patch.description ?? draft.patch._sop_summary ?? source.summary ?? skill.description ?? ""));
      setBodyText(String(draft.patch.body ?? draft.patch._sop_body ?? source.body ?? ""));
      const contractKeys = new Set(["required_inputs", "input_schema", "result_type", "result_schema", "next_actions", "memory_policy", "supports"]);
      const contractPatch = Object.fromEntries(Object.entries(draft.patch).filter(([key]) => contractKeys.has(key)));
      setContractText(JSON.stringify({ ...skillContract(skill), ...contractPatch }, null, 2));
      setContentNotice(draft.updated_at ? "有未发布草稿；员工仍使用当前已发布版本。" : "");
    }).catch((cause) => {
      if (active) setContentNotice(cause instanceof Error ? cause.message : "无法读取技能内容");
    }).finally(() => { if (active) setContentLoading(false); });
    return () => { active = false; };
  }, [skill.id, skill.title, skill.label, skill.description]);

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
    if (!window.confirm("发布会应用待发布草稿并生成版本快照。员工将使用新版本，是否继续？")) return;
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
      await api.saveAdminSkillDraft(skill.id, {
        required_inputs: Array.isArray(value.required_inputs) ? value.required_inputs.map(String) : (skill.required_inputs || []),
        input_schema: Array.isArray(value.input_schema) ? value.input_schema : [],
        result_type: String(value.result_type || ""),
        ...(value.result_schema && typeof value.result_schema === "object" ? { result_schema: value.result_schema as Record<string, unknown> } : {}),
        next_actions: Array.isArray(value.next_actions) ? value.next_actions : [],
        ...(value.memory_policy && typeof value.memory_policy === "object" ? { memory_policy: value.memory_policy as Record<string, unknown> } : {}),
        supports: value.supports && typeof value.supports === "object" ? value.supports as Record<string, boolean> : { cancel: false, retry: false, resume: false },
      });
      await onChanged();
      setContractError("运行契约已保存为未发布草稿；员工继续使用当前版本。");
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

  const [activeTab, setActiveTab] = useState<"overview" | "dependencies" | "access" | "release">("overview");
  const [grantBusy, setGrantBusy] = useState(false);
  const [grantNotice, setGrantNotice] = useState("");

  async function toggleGrant(scope: GrantScope, scopeId: string, granted: boolean) {
    const current = grantsForSkill || EMPTY_GRANTS;
    const values = new Set(current[scope]);
    if (granted) values.add(scopeId);
    else values.delete(scopeId);
    const next = { ...current, [scope]: [...values] };
    setGrantBusy(true);
    setGrantNotice("");
    try {
      const response = await api.saveSkillGrants(skill.id, next);
      const saved = (response.grants || next) as GrantSet;
      props.onGrants({ [skill.id]: saved });
      setGrantNotice("技能授权已保存；运行时将按当前组织、团队和个人范围校验。");
    } catch (error) {
      setGrantNotice(error instanceof Error ? error.message : "授权保存失败");
    } finally {
      setGrantBusy(false);
    }
  }

  async function saveSkillContent() {
    setContentBusy(true);
    setContentNotice("");
    try {
      if (skill.source === "bundled") {
        await api.saveAdminSkillDraft(skill.id, { _sop_summary: summaryText, _sop_body: bodyText });
        setContentNotice("说明已保存为未发布草稿；内置技能的名称与元数据保持只读。");
      } else {
        await api.saveAdminSkillDraft(skill.id, { title: titleText, description: summaryText, body: bodyText });
        setContentNotice(lc?.origin === "third_party" ? "草稿已保存；来源已从第三方转为官方，发布前员工仍使用现行版本。" : "技能内容已保存为未发布草稿。");
      }
      await onChanged();
    } catch (cause) {
      setContentNotice(cause instanceof Error ? cause.message : "保存技能内容失败");
    } finally {
      setContentBusy(false);
    }
  }

  const official = lc?.origin ? lc.origin === "official" : skill.source === "bundled" || !(lc?.tags || []).includes("第三方");
  const stageActions = NEXT_ACTIONS[lc?.stage || "draft"] || [];

  return (
    <>
      <header className="skill-detail-header">
        <div className="skill-detail-heading">
          <div className="skill-detail-kicker"><span className={`skill-origin-tag${official ? " is-official" : " is-third-party"}`}>{official ? "官方技能" : "第三方技能"}</span><span className="skill-stage-label"><StageDot stage={lc?.stage || "draft"} />{lc?.stage_label || "未配置阶段"}</span></div>
          <h2 id="skill-detail-title">{skill.label}</h2>
          <p><code>{skill.id}</code>{lc?.current_version ? ` · v${lc.current_version}` : " · 尚无已发布版本"}</p>
        </div>
        <div className="skill-detail-actions">
          <details className="skill-action-menu">
            <summary className="skill-governance-secondary">更多操作</summary>
            <div className="skill-action-menu-items">
              <button type="button" onClick={() => void publishVersion()}>发布草稿并生成版本</button>
              {stageActions.map((action) => <button type="button" key={action.stage} onClick={() => onStage(action.stage, action.needReason)}>{action.label}</button>)}
            </div>
          </details>
          <button type="button" className="skill-governance-icon" aria-label="关闭技能详情" onClick={props.onClose}>×</button>
        </div>
      </header>
      <div className="skill-detail-description">{skill.description || "暂无技能说明。"}</div>
      <nav className="skill-detail-tabs" aria-label="技能详情分类">
        {([
          ["overview", "概览与配置"],
          ["dependencies", "工具与知识"],
          ["access", "授权范围"],
          ["release", "测试与版本"],
        ] as const).map(([id, label]) => <button type="button" key={id} aria-current={activeTab === id ? "page" : undefined} onClick={() => setActiveTab(id)}>{label}</button>)}
      </nav>

      <div className="skill-detail-content">
        {activeTab === "overview" && <div className="skill-detail-stack">
          <section className="skill-detail-card" aria-labelledby="skill-markdown-heading">
            <div className="skill-section-head"><div><h3 id="skill-markdown-heading">技能内容</h3><p>{skill.source === "bundled" ? "内置技能名称不可改；保存后先形成未发布草稿。" : "保存后先形成未发布草稿；编辑第三方内容会将来源转为官方。"}</p></div></div>
            {contentLoading ? <p className="muted">正在读取技能内容…</p> : <>
              <label className="skill-content-field">技能名称<input value={titleText} disabled={skill.source === "bundled"} onChange={(event) => setTitleText(event.target.value)} /></label>
              <label className="skill-content-field">简介<input value={summaryText} onChange={(event) => setSummaryText(event.target.value)} maxLength={200} /></label>
              <label className="skill-content-field">技能说明（Markdown）<textarea value={bodyText} onChange={(event) => setBodyText(event.target.value)} rows={14} spellCheck={false} /></label>
              <div className="skill-contract-actions"><button type="button" className="skill-governance-primary" disabled={contentBusy || !bodyText.trim() || !summaryText.trim()} onClick={() => void saveSkillContent()}>{contentBusy ? "保存中…" : "保存草稿"}</button><span role="status">{contentNotice || `来源：${official ? "官方" : "第三方"} · 未发布草稿不会改变员工当前使用的版本。`}</span></div>
            </>}
          </section>
          <section className="skill-detail-card">
            <h3>核心信息</h3>
            <div className="skill-detail-fields">
              <Field label="技能名称" value={skill.label} />
              <Field label="Key" value={skill.id} />
              <Field label="当前版本" value={lc?.current_version ? `v${lc.current_version}` : "—"} />
              <Field label="技能类型" value={skill.profile || "—"} />
              <Field label="业务阶段" value={lc?.business_stage || "—"} />
              <Field label="负责人" value={lc?.owner || "未设置"} />
            </div>
            <div className="skill-detail-metadata">
              {(lc?.tags || []).filter((tag) => tag !== "第三方").map((tag) => <span className="skill-meta-tag" key={tag}>#{tag}</span>)}
              <input className="skill-inline-input" placeholder="添加标签并按 Enter" value={tagInput} onChange={(event) => setTagInput(event.target.value)} onKeyDown={async (event) => {
                if (event.key === "Enter" && tagInput.trim()) {
                  event.preventDefault();
                  await api.skillLifecycleMetaSave(skill.id, { tags: [...(lc?.tags || []).filter((tag) => tag !== "第三方"), tagInput.trim()] });
                  setTagInput("");
                  await onChanged();
                }
              }} />
              <button type="button" className="skill-governance-secondary" onClick={async () => {
                const owner = window.prompt("设置负责人", lc?.owner || "");
                if (owner === null) return;
                await api.skillLifecycleMetaSave(skill.id, { owner: owner || undefined });
                await onChanged();
              }}>设置负责人</button>
            </div>
          </section>
          <section className="skill-detail-card" aria-labelledby="skill-contract-heading">
            <div className="skill-section-head"><div><h3 id="skill-contract-heading">运行契约</h3><p>{skill.source === "bundled" ? "内置技能的运行契约随平台代码维护，此处只读。" : "输入字段、结果类型、动作、记忆策略和异步能力；修改先存为草稿。"}</p></div></div>
            <textarea aria-label="技能参数与运行契约 JSON" value={contractText} onChange={(event) => setContractText(event.target.value)} rows={10} spellCheck={false} readOnly={skill.source === "bundled"} />
            {skill.source !== "bundled" && <div className="skill-contract-actions"><button type="button" className="skill-governance-primary" disabled={contractBusy} onClick={() => void saveContract()}>{contractBusy ? "保存中…" : "保存契约草稿"}</button><span role="status">{contractError || "未发布草稿不会改变员工当前使用的版本。"}</span></div>}
          </section>
        </div>}

        {activeTab === "dependencies" && <div className="skill-detail-stack">
          <section className="skill-detail-card" aria-labelledby="skill-tools-heading">
            <div className="skill-section-head"><div><h3 id="skill-tools-heading">MCP / API 工具</h3><p>技能内依赖。工具风险与执行边界由平台治理，不向人员单独授权。</p></div></div>
            <SkillConnectorBindings skillId={skill.id} />
          </section>
          <SkillTemplatePreview skillId={skill.id} />
          <SkillKnowledgeBindings skillId={skill.id} />
          <PublishedAgentUsage skillId={skill.id} />
        </div>}

        {activeTab === "access" && <section className="skill-detail-card">
          <div className="skill-section-head"><div><h3>直接技能授权</h3><p>授权以技能为对象；Agent / 团队授权继承尚未接入，此处只配置组织、团队、个人的直接技能范围。</p></div></div>
          {!grantsForSkill && <p className="muted">正在读取授权…</p>}
          <div className="skill-access-grid">
            <GrantGroup title="组织" rows={directory.orgs} selected={(grantsForSkill || EMPTY_GRANTS).org} scope="org" disabled={grantBusy} onToggle={toggleGrant} />
            <GrantGroup title="团队" rows={directory.teams} selected={(grantsForSkill || EMPTY_GRANTS).team} scope="team" disabled={grantBusy} onToggle={toggleGrant} />
            <GrantGroup title="个人" rows={directory.users.map((user) => ({ id: user.handle, name: user.name }))} selected={(grantsForSkill || EMPTY_GRANTS).user} scope="user" disabled={grantBusy} onToggle={toggleGrant} />
          </div>
          <p className="skill-grant-note" role="status">{grantNotice || "保存后立即按组织、团队、个人范围校验；勾选表示直接授予此技能。"}</p>
          <p className="skill-grant-note">该目录当前没有 Agent / 团队访问授权来源接口；因此此页只呈现已保存的直接技能授权与下方可见的 Agent 技能依赖，不将依赖关系冒充继承授权。</p>
        </section>}

        {activeTab === "release" && <div className="skill-detail-stack">
          <p className="skill-governance-notice" role="note">当前发布接口由产品经理直接确认；审批单与审批状态接口尚未接入，此页不会展示“审批通过”。</p>
          <div className="skill-release-grid">
            <section className="skill-detail-card">
              <div className="skill-section-head"><div><h3>测试验证</h3><p>用例 {lc?.test_summary.total ?? 0} · 通过率 {lc?.test_summary.pass_rate ?? "—"}% · 未通过 {lc?.test_summary.failing ?? 0}</p></div></div>
              <div className="skill-test-create"><input className="skill-inline-input" placeholder="新增用例名称" value={newTest} onChange={(event) => setNewTest(event.target.value)} /><button type="button" className="skill-governance-secondary" onClick={() => void addTest()}>添加用例</button></div>
              <div className="skill-test-list">{tests.map((test) => <div className="skill-test-row" key={String(test.id)}><span>{String(test.name)}</span><button type="button" onClick={() => void recordResult(String(test.id), true)}>通过</button><button type="button" onClick={() => void recordResult(String(test.id), false)}>未通过</button><button type="button" onClick={async () => { await api.deleteSkillTest(skill.id, String(test.id)); await reloadAll(); }}>删除</button></div>)}{!tests.length && <p className="muted">暂无测试用例</p>}</div>
            </section>
            <section className="skill-detail-card">
              <div className="skill-section-head"><div><h3>运行监控</h3><p>来自实际运行记录</p></div><select aria-label="运行监控时间范围" value={props.metricsDays} onChange={(event) => props.onMetricsDays(Number(event.target.value))}><option value={7}>近 7 天</option><option value={30}>近 30 天</option><option value={90}>近 90 天</option></select></div>
              {metrics ? <><div className="skill-metrics-grid"><Stat label="调用次数" value={String(metrics.calls)} /><Stat label="成功率" value={metrics.success_rate === null ? "—" : `${metrics.success_rate}%`} /><Stat label="平均耗时" value={metrics.avg_duration_ms === null ? "—" : `${metrics.avg_duration_ms}ms`} /><Stat label="告警次数" value={String(metrics.alerts)} /></div><div className="skill-metrics-chart" aria-label="每日调用趋势">{metrics.trend.map((trend) => <span key={trend.day} title={`${trend.day}: ${trend.n}`} style={{ height: `${(trend.n / maxTrend) * 100}%` }} />)}{!metrics.trend.length && <p className="muted">该周期内暂无调用记录</p>}</div></> : <p className="muted">正在读取运行数据…</p>}
            </section>
          </div>
          <section className="skill-detail-card">
            <div className="skill-section-head"><div><h3>版本记录</h3><p>发布会应用待发布草稿；员工使用此版本，历史版本可回滚。</p></div><button type="button" className="skill-governance-secondary" onClick={() => void publishVersion()}>发布草稿并生成版本</button></div>
            <div className="skill-version-list">{versions.map((version) => <div className="skill-version-row" key={String(version.id)}><strong>v{String(version.version)}</strong><span>{String(version.status)}</span><span>{String(version.description || "—")}</span><button type="button" className="skill-governance-secondary" onClick={() => void rollback(Number(version.version))}>回滚</button></div>)}{!versions.length && <p className="muted">尚无版本记录</p>}</div>
          </section>
        </div>}
      </div>
    </>
  );
}

function GrantGroup({ title, rows, selected, scope, disabled, onToggle }: {
  title: string;
  rows: { id: string; name: string }[];
  selected: string[];
  scope: GrantScope;
  disabled: boolean;
  onToggle: (scope: GrantScope, scopeId: string, granted: boolean) => void;
}) {
  return <fieldset className="skill-grant-group"><legend>{title}</legend>{rows.map((row) => <label key={row.id}><input type="checkbox" checked={selected.includes(row.id)} disabled={disabled} onChange={(event) => onToggle(scope, row.id, event.target.checked)} /><span>{row.name}</span></label>)}{!rows.length && <span className="muted">暂无{title}</span>}</fieldset>;
}

function SkillKnowledgeBindings({ skillId }: { skillId: string }) {
  const [bindings, setBindings] = useState<Record<string, unknown>[]>([]);
  const [assets, setAssets] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [allBindings, allAssets] = await Promise.all([api.adminKnowledgeBindings(), api.adminKnowledgeAssets()]);
      setBindings(allBindings.filter((binding) => String(binding.skill_id || "") === skillId));
      setAssets(allAssets as unknown as Record<string, unknown>[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取技能知识绑定");
    } finally {
      setLoading(false);
    }
  }, [skillId]);

  useEffect(() => { void load(); }, [load]);

  const previewBindings = async () => {
    setPreviewBusy(true);
    setError("");
    try {
      setPreview(await api.adminKnowledgeResolvePreview({ skill_id: skillId }) as unknown as Record<string, unknown>);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "知识解析试算失败");
    } finally {
      setPreviewBusy(false);
    }
  };
  const assetsById = useMemo(() => new Map(assets.map((asset) => [String(asset.id || ""), asset])), [assets]);
  const resolved = Array.isArray(preview?.resolved) ? preview.resolved as Record<string, unknown>[] : [];
  const skipped = Array.isArray(preview?.skipped) ? preview.skipped as Record<string, unknown>[] : [];

  return <section className="skill-detail-card" aria-labelledby="skill-knowledge-heading">
    <div className="skill-section-head"><div><h3 id="skill-knowledge-heading">知识库绑定</h3><p>查看该技能关联的知识筛选条件，并可试算当前解析结果。</p></div><div className="skill-section-actions"><button type="button" className="skill-governance-secondary" onClick={() => void load()} disabled={loading}>刷新</button><Link className="skill-governance-secondary" to="/admin/knowledge/bindings">管理绑定</Link></div></div>
    {loading && <p className="muted">正在读取绑定…</p>}
    {error && <p className="skill-governance-error" role="alert">{error}</p>}
    {!loading && !error && !bindings.length && <p className="muted">该技能没有配置知识绑定。</p>}
    <div className="skill-knowledge-list">{bindings.map((binding) => {
      const selector = (binding.selector && typeof binding.selector === "object" ? binding.selector : {}) as Record<string, unknown>;
      const ids = Array.isArray(selector.ids) ? selector.ids.map(String) : [];
      const labels = ids.map((id) => String(assetsById.get(id)?.title || assetsById.get(id)?.name || id));
      const conditions = [
        ids.length ? `指定条目：${labels.join("、")}` : "按条件匹配知识",
        ...(Array.isArray(selector.kinds) ? [`类型：${selector.kinds.join("、")}`] : []),
        ...(Array.isArray(selector.tags) ? [`标签：${selector.tags.join("、")}`] : []),
        ...(Array.isArray(selector.stage_codes) ? [`阶段：${selector.stage_codes.join("、")}`] : []),
        ...(selector.brand ? [`品牌：${String(selector.brand)}`] : []),
        ...(selector.lang ? [`语言：${String(selector.lang)}`] : []),
      ];
      return <article className="skill-knowledge-row" key={String(binding.id)}><span className={`skill-binding-state${Number(binding.enabled) ? " is-enabled" : ""}`}>{Number(binding.enabled) ? "已启用" : "已停用"}</span><div><strong>{conditions[0]}</strong><p>{conditions.slice(1).join(" · ") || String(binding.note || "无附加筛选条件")}</p>{binding.note && conditions.length > 1 && <small>{String(binding.note)}</small>}</div></article>;
    })}</div>
    <div className="skill-knowledge-preview"><button type="button" className="skill-governance-secondary" onClick={() => void previewBindings()} disabled={previewBusy || loading}>{previewBusy ? "试算中…" : "试算当前解析"}</button><span>试算只展示当前查询结果，不会写入或发布。</span></div>
    {preview && <div className="skill-preview-result" role="status"><strong>本次试算：命中 {resolved.length} 项 · 跳过 {skipped.length} 项</strong>{resolved.map((row, index) => <span key={String(row.id || row.knowledge_id || index)}>{String(row.title || row.name || row.knowledge_id || row.id || "知识条目")}{row.version ? ` · v${String(row.version)}` : ""}</span>)}{!resolved.length && <span>当前条件下没有命中知识。</span>}</div>}
  </section>;
}

function SkillTemplatePreview({ skillId }: { skillId: string }) {
  const [template, setTemplate] = useState<SkillTemplate | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void api.adminSkillTemplate(skillId).then((value) => {
      if (active) { setTemplate(value); setError(""); }
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : "无法读取技能模板");
    });
    return () => { active = false; };
  }, [skillId]);
  return <section className="skill-detail-card" aria-labelledby="skill-template-heading">
    <div className="skill-section-head"><div><h3 id="skill-template-heading">员工使用模板</h3><p>只读投影：由已发布技能契约生成；不是知识条目，也不会改变技能运行契约。</p></div></div>
    {error && <p className="skill-governance-error" role="alert">{error}</p>}
    {!template && !error && <p className="muted">正在读取已发布模板…</p>}
    {template && <>
      <div className="skill-template-heading"><strong>{template.title}</strong><span>版本 {template.version.slice(0, 12)}</span></div>
      <p className="skill-template-description">{template.description}</p>
      <div className="skill-template-grid">
        <div><span>输入字段</span><strong>{template.inputs.length || "无"}</strong></div>
        <div><span>输出</span><strong>{template.output.title} · {template.output.type}</strong></div>
      </div>
      {!!template.inputs.length && <ul className="skill-template-fields">{template.inputs.map((field) => <li key={field.key}><strong>{field.label}</strong><code>{field.key}</code><span>{field.kind}{field.required ? " · 必填" : " · 可选"}</span></li>)}</ul>}
      {!!template.constraints.length && <div className="skill-template-constraints"><strong>执行边界</strong>{template.constraints.map((constraint, index) => <span key={`${index}:${constraint}`}>{constraint}</span>)}</div>}
      <p className="skill-template-note">待发布草稿不会改变此模板；发布后由同一技能契约重新生成。</p>
    </>}
  </section>;
}

function PublishedAgentUsage({ skillId }: { skillId: string }) {
  const [agents, setAgents] = useState<Array<{ id: string; display_name: string; skill_ids: string[] }>>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    void api.experts().then((response) => {
      const rows = Array.isArray(response) ? response : response.experts || [];
      setAgents(rows.filter((agent) => (agent.skill_ids || []).includes(skillId)) as Array<{ id: string; display_name: string; skill_ids: string[] }>);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "无法读取已发布数字员工"));
  }, [skillId]);
  return <section className="skill-detail-card">
    <div className="skill-section-head"><div><h3>被数字员工引用</h3><p>只读显示已发布专家清单中声明的技能依赖。</p></div></div>
    {error && <p className="skill-governance-error" role="alert">{error}</p>}
    {!error && !agents.length && <p className="muted">暂无已发布数字员工引用该技能。</p>}
    {agents.map((agent) => <div className="skill-agent-reference" key={agent.id}><strong>{agent.display_name}</strong><code>{agent.id}</code><span>包含此技能</span></div>)}
  </section>;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div>{label}</div>
      <div>{value}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div>{value}</div>
      <div>{label}</div>
    </div>
  );
}
