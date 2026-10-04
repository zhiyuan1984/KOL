import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { DetailPanel, type SkillRow } from "./SkillLifecycle";
import { useAdminConfirm } from "../components/ConfirmDialog";
import { AdminFormDialog } from "../components/AdminFormDialog";
import { skillLifecyclePublishConfirm, skillStageConfirm } from "../adminConfirm";
import type { SkillCoverage } from "../runtimeConnectorUi";
import "../admin/governance-layout.css";
import "./skill-governance.css";
import "./skill-governance-v2.css";

const stageName = (skill: SkillRow) => skill.lifecycle?.stage_label || skill.lifecycle?.stage || "草稿";
const STAGE_NAME: Record<string, string> = { draft: "草稿", editing: "编辑", testing: "测试", published: "已发布", disabled: "停用" };
export default function SkillLifecycleV2() {
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [origin, setOrigin] = useState<"all" | "official" | "third_party">("all");
  const [stage, setStage] = useState("all");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState("");
  const createKeyRef = useRef<HTMLInputElement | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [id, setId] = useState("");
  const [title, setTitle] = useState("");
  const [documentQuery, setDocumentQuery] = useState(false);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [metricsDays, setMetricsDays] = useState(7);
  const [coverage, setCoverage] = useState<SkillCoverage | null>(null);
  const { ask, dialog } = useAdminConfirm();
  const load = useCallback(async () => {
    // 实现度读数是运行时覆盖的独立读模型：读不到不能让整个技能页失效，详情里降级为「未读取」。
    const [skillsResult, coverageResult] = await Promise.allSettled([api.adminSkills(), api.runtimeSkillCoverage()]);
    if (skillsResult.status === "fulfilled") {
      const response = skillsResult.value as { skills?: SkillRow[] };
      const rows = response.skills || [];
      setSkills(rows);
      setSelectedId((current) => rows.some((row) => row.id === current) ? current : rows[0]?.id || "");
      setError("");
    } else {
      setError(skillsResult.reason instanceof Error ? skillsResult.reason.message : "技能读取失败");
    }
    setCoverage(coverageResult.status === "fulfilled" ? coverageResult.value : null);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const coverageById = useMemo(() => new Map((coverage?.skills || []).map((row) => [row.skill_id, row])), [coverage]);
  const selected = skills.find((skill) => skill.id === selectedId) || null;
  const visible = useMemo(() => skills.filter((skill) => {
    const official = skill.lifecycle?.origin === "official" || (skill.lifecycle?.origin !== "third_party" && skill.source === "bundled");
    if (origin === "official" && !official) return false;
    if (origin === "third_party" && official) return false;
    if (stage !== "all" && skill.lifecycle?.stage !== stage) return false;
    return `${skill.label} ${skill.id} ${skill.description}`.toLowerCase().includes(query.toLowerCase().trim());
  }), [skills, origin, stage, query]);
  const createSkill = async () => {
    if (!id.trim() || !title.trim() || !body.trim()) { setCreateError("请填写技能 Key、名称与说明。"); return; }
    setBusy(true); setCreateError("");
    try {
      await api.createAdminSkill({ id: id.trim(), title: title.trim(), description: title.trim(), body: body.trim(), mcp: documentQuery ? ["knowledge.ask_documents"] : [], grant_org: false, in_market: false });
      setSelectedId(id.trim()); setCreateOpen(false); setId(""); setTitle(""); setBody("");
      setNotice("技能草稿已创建。装配到 Agent 后，按技能阶段完成测试与发布。");
      await load();
    } catch (cause) { setCreateError(cause instanceof Error ? cause.message : "创建技能失败"); }
    finally { setBusy(false); }
  };
  const openCreate = () => { setDocumentQuery(false); setId(""); setTitle(""); setBody(""); setCreateError(""); setCreateOpen(true); };
  const moveStage = (next: string, needReason?: boolean) => {
    if (!selected) return;
    ask(
      next === "published"
        ? skillLifecyclePublishConfirm(selected.label, selected.id)
        : skillStageConfirm({ title: selected.label, id: selected.id, from: stageName(selected), to: STAGE_NAME[next] || next, needReason }),
      async (reason) => {
        await api.skillLifecycleStage(selected.id, next, reason || undefined);
        setNotice(`技能阶段已更新为 ${STAGE_NAME[next] || next}。`);
        await load();
      },
    );
  };
  return <section className="governance-workspace skill-governance-v2" data-admin-page="skills">
    <aside className="governance-rail">
      <div className="governance-scroll">
        <input className="governance-search" aria-label="搜索技能" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、Key 或说明" />
        <p className="governance-count">{visible.length} / {skills.length} 项技能</p>
        <div className="governance-filter-group"><strong>来源</strong><div className="governance-filter-options">{([["all", "全部"], ["official", "官方"], ["third_party", "第三方"]] as const).map(([key, label]) => <button type="button" key={key} aria-pressed={origin === key} onClick={() => setOrigin(key)}>{label}</button>)}</div></div>
        <div className="governance-filter-group"><strong>阶段</strong><div className="governance-filter-options">{([["all", "全部"], ["draft", "草稿"], ["editing", "编辑"], ["testing", "测试"], ["published", "已发布"], ["disabled", "停用"]] as const).map(([key, label]) => <button type="button" key={key} aria-pressed={stage === key} onClick={() => setStage(key)}>{label}</button>)}</div></div>
        <h2 className="governance-subheading">技能列表</h2>
        <div className="governance-list">{visible.map((skill) => <button type="button" key={skill.id} className={`governance-list-row skill-v2-row${selectedId === skill.id ? " is-selected" : ""}`} onClick={() => setSelectedId(skill.id)}><strong>{skill.label}</strong><span className="muted">{skill.category || "未分类"}</span><span>{stageName(skill)}</span></button>)}{!visible.length && <p className="governance-empty">没有符合条件的技能。</p>}</div>
      </div>
      <div className="governance-rail-footer"><button type="button" className="btn work" onClick={openCreate}>新增技能</button></div>
    </aside>
    <div className="governance-main"><header className="governance-main-head"><h2>{selected?.label || "技能详情"}</h2><button type="button" className="governance-minor" onClick={() => setImportOpen(true)}>上传 SKILL.md</button></header>
      <div className="governance-scroll">
        {error && <p className="error" role="alert">{error}</p>}
        {notice && <p className="governance-notice" role="status">{notice}</p>}
        {selected ? <div className="skill-v2-detail"><DetailPanel key={selected.id} skill={selected} coverageRow={coverageById.get(selected.id) || null} onStage={(next, reason) => moveStage(next, reason)} onChanged={load} metricsDays={metricsDays} onMetricsDays={setMetricsDays} onClose={() => setSelectedId("")} /></div>
          : <p className="governance-empty">选择一项技能查看详情。</p>}
      </div>
    </div>
    {importOpen && <div className="skill-governance-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setImportOpen(false); }}><section className="skill-upload-dialog" role="dialog" aria-modal="true" aria-label="上传技能"><h2>上传 SKILL.md</h2><p>导入为技能草稿；后续在 Agent 页装配。</p><input type="file" accept=".md,text/markdown" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; setBusy(true); try { const result = await api.importAdminSkill(file); setImportOpen(false); setSelectedId(String(result.id)); setNotice("技能已导入为草稿。"); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "导入失败"); } finally { setBusy(false); } }} /><button type="button" className="governance-minor" disabled={busy} onClick={() => setImportOpen(false)}>关闭</button></section></div>}
    {dialog}
    <AdminFormDialog
      open={createOpen}
      title="新增技能"
      subtitle="新技能先作为草稿保存，不授予任何人直接权限；装配到 Agent 后按阶段测试与发布。"
      error={createError}
      busy={busy}
      initialFocusRef={createKeyRef}
      onClose={() => { setCreateOpen(false); setCreateError(""); }}
      footer={<><button type="button" className="btn" disabled={busy} onClick={() => { setCreateOpen(false); setCreateError(""); }}>取消</button><button type="button" className="btn work" disabled={busy} onClick={() => void createSkill()}>{busy ? "创建中…" : "创建技能"}</button></>}
    >
      <label>技能 Key（snake_case）<input ref={createKeyRef} type="text" value={id} onChange={(event) => setId(event.target.value)} /></label>
      <label>名称<input type="text" value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label><input type="checkbox" checked={documentQuery} onChange={(event) => setDocumentQuery(event.target.checked)} />非结构化文档问答（L1 只读；知识库在 Agent 页绑定）</label>
      <label>说明（Markdown）<textarea value={body} onChange={(event) => setBody(event.target.value)} /></label>
    </AdminFormDialog>
  </section>;
}
