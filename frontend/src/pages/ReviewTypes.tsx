import { useEffect, useReducer, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { emptyReviewDefinition, knowledgeReviewDefinition, type ReviewDefinition, type ReviewTemplate, type ReviewIssue, type ReviewSimulation, type ReviewChoices } from "../../../shared/review";
import { ReviewAuthorOrganization } from "../reviews/ReviewAuthorOrganization";
import { ReviewLeaveDialog } from "../reviews/ReviewLeaveDialog";
import { ReviewFieldsEditor } from "../reviews/ReviewFieldsEditor";
import { FlowDesigner } from "../reviews/FlowDesigner";
import { ReviewPublishPanel, issueStep } from "../reviews/ReviewPublishPanel";
import { reviewApi, type ReviewContext } from "../reviews/api";
import { useReviewCommand } from "../reviews/useReviewCommand";
import { randomUuid } from "../uuid";
import { useFocusLock } from "../hooks/useFocusLock";
import { ReviewTemplateBrowser } from "../reviews/ReviewTemplateBrowser";
import "../reviews/reviews.css";
type History = {
  past: ReviewDefinition[];
  present: ReviewDefinition;
  future: ReviewDefinition[];
};
const steps = [["basic", "基本信息"], ["form", "表单设计"], ["flow", "评审步骤"], ["publish", "检查与发布"]];
export function definitionHistory(
  s: History,
  a: { type: "edit" | "reset" | "undo" | "redo"; value?: ReviewDefinition },
): History {
  if (a.type === "reset") return { past: [], present: a.value!, future: [] };
  if (a.type === "edit")
    return {
      past: [...s.past.slice(-49), s.present],
      present: a.value!,
      future: [],
    };
  if (a.type === "undo" && s.past.length)
    return {
      past: s.past.slice(0, -1),
      present: s.past.at(-1)!,
      future: [s.present, ...s.future],
    };
  if (a.type === "redo" && s.future.length)
    return {
      past: [...s.past, s.present],
      present: s.future[0],
      future: s.future.slice(1),
    };
  return s;
}
export default function ReviewTypes() {
  const navigate = useNavigate();
  const [context, setContext] = useState<ReviewContext>(), [list, setList] = useState<ReviewTemplate[]>([]), [active, setActive] = useState<ReviewTemplate>();
  const [editing, setEditing] = useState(false), [tab, setTab] = useState("basic"), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [trialChoices, setTrialChoices] = useState<ReviewChoices>({});
  const [operation, setOperation] = useState(""), [saveFailed, setSaveFailed] = useState(false), [checkState, setCheckState] = useState("idle"), [trialState, setTrialState] = useState("idle");
  const [issues, setIssues] = useState<ReviewIssue[]>([]), [checkedDefinition, setCheckedDefinition] = useState(""), [validatedVersion, setValidatedVersion] = useState<number>();
  const [values, setValues] = useState<Record<string, unknown>>({}), [requester, setRequester] = useState(""), [result, setResult] = useState<ReviewSimulation>();
  const [target, setTarget] = useState<ReviewIssue>(), [leaving, setLeaving] = useState(false), [companyTarget, setCompanyTarget] = useState("");
  const [history, dispatch] = useReducer(definitionHistory, { past: [], present: emptyReviewDefinition(), future: [] });
  const d = history.present, signature = JSON.stringify(d);
  const dirty = editing && (!active || JSON.stringify(active.definition) !== signature);
  const activeRef = useRef(active), revision = useRef(0), running = useRef(false), mounted = useRef(true);
  const pendingCreation = useRef<{ key: string; definition: ReviewDefinition } | undefined>(undefined);
  const leaveAction = useRef<() => void>(() => {}), allowLeave = useRef(false);
  const companyDialog = useRef<HTMLDivElement>(null);
  useFocusLock({ open: Boolean(companyTarget), rootRef: companyDialog, onEscape: () => setCompanyTarget("") });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; revision.current++; }; }, []);
  async function load() {
    const [ctx, rows] = await Promise.all([reviewApi<ReviewContext>("/approvals/v2/context"), reviewApi<ReviewTemplate[]>("/admin/approval-types/v2/templates")]);
    if (mounted.current) { setContext(ctx); setList(rows); }
    return rows;
  }
  const command = useReviewCommand(async () => {
    const rows = await load();
    if (activeRef.current) { const saved = rows.find(t => t.id === activeRef.current?.id); activeRef.current = saved; setActive(saved); }
  });
  const locked = Boolean(operation) || command.busy;
  useEffect(() => { load().catch(e => setError(e.message)).finally(() => setLoading(false)); }, []);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => { if (dirty && !allowLeave.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", before); return () => window.removeEventListener("beforeunload", before);
  }, [dirty]);
  function invalidate() {
    revision.current++;
    setCheckState(state => state === "idle" ? "idle" : "stale");
    setTrialState(state => state === "idle" ? "idle" : "stale");
    setCheckedDefinition(""); setValidatedVersion(undefined); setIssues([]); setResult(undefined); setSaveFailed(false);
  }
  function edit(next: ReviewDefinition) { invalidate(); dispatch({ type: "edit", value: next }); }
  function historyAction(type: "undo" | "redo") { invalidate(); dispatch({ type }); }
  function open(t?: ReviewTemplate, starter?: ReviewDefinition) {
    setCreating(false); setTrialChoices({});
    revision.current++; allowLeave.current = false; pendingCreation.current = undefined; activeRef.current = t; setActive(t);
    const definition = t?.definition || starter || (new URLSearchParams(window.location.search).get("subject") === "knowledge_publication" ? knowledgeReviewDefinition() : { ...emptyReviewDefinition(), name: "" });
    dispatch({ type: "reset", value: { ...definition, ...(!t && context?.organization?.defaultUnitId ? { organizationUnitId: context.organization.defaultUnitId } : {}) } });
    setEditing(true); setTab("basic"); setIssues([]); setCheckState("idle"); setCheckedDefinition(""); setValidatedVersion(undefined); setResult(undefined); setTrialState("idle"); setValues({}); setRequester(context?.actor || ""); setTarget(undefined); setError(""); setSaveFailed(false);
  }
  const pendingCopy = useRef<{ signature: string; key: string } | undefined>(undefined);
  async function copy(t: ReviewTemplate, source: "draft" | "published") {
    await perform(async () => {
      setOperation("copying");
      const signature = `${t.id}:${t.version}:${source}`;
      if (pendingCopy.current?.signature !== signature) pendingCopy.current = { signature, key: randomUuid() };
      try {
        const saved = await reviewApi<ReviewTemplate>(`/admin/approval-types/v2/templates/${t.id}/copy`, { expectedVersion: t.version, source, creationKey: pendingCopy.current.key });
        pendingCopy.current = undefined; adopt(saved); open(saved);
      } catch (e) { setError((e as Error).message); }
    });
  }
  function adopt(saved: ReviewTemplate) {
    activeRef.current = saved; setActive(saved); setList(rows => [saved, ...rows.filter(t => t.id !== saved.id)]);
  }
  async function saveSnapshot(): Promise<ReviewTemplate | undefined> {
    if (!activeRef.current && context?.organization?.units.length && !d.organizationUnitId) { setError("请选择流程归属组织后保存。"); setSaveFailed(true); return; }
    const snapshot = d;
    let current = activeRef.current;
    if (current && JSON.stringify(current.definition) === JSON.stringify(snapshot)) return current;
    setOperation("saving"); setError(""); setSaveFailed(false);
    try {
      if (!current) {
        const pending = pendingCreation.current ||= { key: randomUuid(), definition: snapshot };
        current = await reviewApi<ReviewTemplate>("/admin/approval-types/v2/templates", { definition: pending.definition, creationKey: pending.key });
        pendingCreation.current = undefined; adopt(current);
      }
      if (JSON.stringify(current.definition) !== JSON.stringify(snapshot)) {
        try {
          current = await reviewApi<ReviewTemplate>(`/admin/approval-types/v2/templates/${current.id}`, { definition: snapshot, expectedVersion: current.version }, "PUT");
        } catch (e) {
          const rows = await reviewApi<ReviewTemplate[]>("/admin/approval-types/v2/templates");
          const recovered = rows.find(t => t.id === current!.id);
          if (!recovered || JSON.stringify(recovered.definition) !== JSON.stringify(snapshot)) throw e;
          current = recovered;
        }
        adopt(current);
      }
      setValidatedVersion(undefined);
      return current;
    } catch (e) { setError((e as Error).message); setSaveFailed(true); return; }
  }
  async function check(snapshot: ReviewDefinition) {
    const token = revision.current;
    setOperation("checking"); setCheckState("checking"); setCheckedDefinition(""); setValidatedVersion(undefined); setIssues([]);
    try {
      const checked = await reviewApi<{ issues: ReviewIssue[] }>("/admin/approval-types/v2/validate", { definition: snapshot });
      if (!mounted.current || token !== revision.current) return;
      setIssues(checked.issues); setCheckedDefinition(JSON.stringify(snapshot)); setCheckState(checked.issues.length ? "issues" : "passed");
      return checked.issues;
    } catch (e) { if (mounted.current && token === revision.current) { setError((e as Error).message); setCheckState("failed"); } }
  }
  async function perform(work: () => Promise<void>) {
    if (running.current || locked) return;
    running.current = true; setError("");
    try { await work(); } finally { running.current = false; if (mounted.current) setOperation(""); }
  }
  function go(next: string) {
    const index = steps.findIndex(([id]) => id === next);
    if (index < stepIndex) { setTab(next); setTarget(undefined); return; }
    if (next === tab && next !== "publish") return;
    void perform(async () => {
      const token = revision.current;
      const saved = await saveSnapshot(); if (!saved || token !== revision.current) return;
      const found = await check(saved.definition);
      if (token !== revision.current) return;
      if (!found) { if (next === "publish") setTab(next); return; }
      const blockers = found.filter(x => issueStep(x) === "basic" || (index >= 2 && issueStep(x) === "form"));
      if (blockers.length) { setError(blockers.map(x => x.message).join("；")); locate(blockers[0]); return; }
      setTarget(undefined); setTab(next);
      if (next === "publish") setValidatedVersion(found.length ? undefined : saved.version);
    });
  }
  function locate(issue: ReviewIssue) {
    setTarget(issue); setTab(issueStep(issue));
    requestAnimationFrame(() => {
      const container = document.getElementById("review-editor-content");
      const property = issue.target?.property || issue.path;
      if (issueStep(issue) === "basic") {
        if (property === "organizationUnitId") {
          const organization = document.querySelector<HTMLDetailsElement>(".review-departments");
          if (organization) { organization.open = true; organization.querySelector<HTMLSelectElement>("select")?.focus(); }
        } else (container?.querySelector(property === "description" ? "textarea" : "input") as HTMLElement | null)?.focus();
      }
    });
  }
  function requestLeave(action: () => void) {
    if (running.current || locked) return;
    if (!dirty) { action(); return; } leaveAction.current = action; setLeaving(true);
  }
  function leave() { allowLeave.current = true; setLeaving(false); leaveAction.current(); }
  function back() {
    requestLeave(() => { const returnTo = new URLSearchParams(window.location.search).get("returnTo");
      if (returnTo?.startsWith("/admin/knowledge?")) navigate(returnTo);
      else if (creating) setCreating(false); else if (editing) { revision.current++; setEditing(false); } else if (window.history.state?.idx > 0) navigate(-1); else navigate("/admin");
      allowLeave.current = false;
    });
  }
  useEffect(() => {
    if (!dirty && !locked) return;
    const onLink = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element).closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target || anchor.download) return;
      const url = new URL(anchor.href); if (url.origin !== window.location.origin || url.href === window.location.href) return;
      event.preventDefault(); event.stopPropagation(); requestLeave(() => navigate(url.pathname + url.search + url.hash));
    };
    document.addEventListener("click", onLink, true); return () => document.removeEventListener("click", onLink, true);
  }, [dirty, locked]);
  const stepIndex = steps.findIndex(([id]) => id === tab);
  const checked = checkedDefinition === signature;
  const publishReason = operation === "saving" ? "正在保存草稿" : saveFailed ? "保存失败，请重试" : operation === "checking" ? "正在检查配置" : operation === "trial" ? "正在试运行" : dirty ? "有未保存修改" : !checked || validatedVersion !== active?.version ? checkState === "stale" ? "配置已修改，需重新检查" : issues.length ? `还有 ${issues.length} 项配置问题` : "尚未完成当前版本检查" : active?.publishedVersion === active?.version ? "当前版本已发布" : "";
  const status = (step: string) => checked ? issues.some(x => issueStep(x) === step) ? "有问题" : "已完成" : "待完善";
  return <main className={`review-page review-author-page${editing ? " is-editing" : ""}`} aria-busy={locked || undefined}>
    <ReviewAuthorOrganization context={context} unitId={editing ? d.organizationUnitId : context?.organization?.defaultUnitId} onUnitChange={id => editing && edit({ ...d, organizationUnitId: id })} onCompanyChange={id => id !== context?.tenant && setCompanyTarget(id)} onBack={back} disabled={locked} editing={editing} saved={Boolean(active)} />
    <header className="review-toolbar review-author-toolbar"><h1>{editing ? active ? "编辑评审流程" : "新建评审流程" : "评审流程"}</h1>
      {editing ? <><span className="review-muted">{d.name || "未命名流程"} · 草稿</span><div className="review-author-tools"><button disabled={locked || !history.past.length} onClick={() => historyAction("undo")}>撤销</button><button disabled={locked || !history.future.length} onClick={() => historyAction("redo")}>重做</button><button disabled={locked || !dirty} onClick={() => void perform(async () => { await saveSnapshot(); })}>{saveFailed ? "重试保存" : active ? "保存" : "保存草稿"}</button></div></> : !creating && <button className={command.busy ? "" : "primary"} disabled={loading || locked || !context?.admin} onClick={() => setCreating(true)}>新建流程</button>}
    </header>
    {!leaving && (error || command.error) && <p role="alert" className="review-error">{error || command.error}</p>}
    {command.receipt && <p role="status">{command.receipt}</p>}
    {loading ? <p role="status">正在加载当前组织的流程…</p> : !editing ? <ReviewTemplateBrowser list={list} context={context} busy={locked} creating={creating} onCancel={() => setCreating(false)} onCreate={definition => open(undefined, definition)} onEdit={open} onCopy={(t, source) => void copy(t, source)} onToggle={t => command.run({ action: t.enabled === false ? "enable" : "disable", templateId: t.id, expectedVersion: t.version, expectedLifecycleVersion: t.lifecycleVersion || 0 })} /> : <>
      <nav className="review-steps" aria-label="流程配置步骤">{steps.map(([id, label], index) => <button key={id} aria-label={label} disabled={locked} aria-current={tab === id ? "step" : undefined} aria-controls="review-editor-content" onClick={() => go(id)}><span className="review-step-heading"><span className="review-step-number" aria-hidden="true">{index + 1}</span>{label}</span><small>{id === "publish" ? checkState === "stale" ? "需重新检查" : validatedVersion === active?.version && validatedVersion !== undefined ? "已完成" : "待完善" : status(id)}{id === "form" ? ` · ${d.fields.length} 个字段` : id === "flow" ? ` · ${d.nodes.filter(n => !["start", "end"].includes(n.type)).length} 个步骤` : ""}</small></button>)}</nav>
      {checkState === "stale" && tab !== "publish" && <p role="status" className="review-muted">配置已修改，需重新检查</p>}
      <fieldset disabled={locked} className="review-editor" id="review-editor-content" aria-label={steps[stepIndex][1]}>
        {tab === "basic" && <div className="review-form review-basic-form"><p className="review-muted">为流程命名，并说明员工在什么情况下发起。发起说明可选。</p>{d.subjectType === "knowledge_publication" && <p>人工审核通过后发布被冻结的资料版本；原件变化须重新申请。</p>}<label>流程名称<input placeholder="例如：内容方案评审" maxLength={120} value={d.name} onChange={e => edit({ ...d, name: e.target.value })} /></label><label>发起说明<textarea rows={3} maxLength={2000} value={d.description} onChange={e => edit({ ...d, description: e.target.value })} /></label></div>}
        {tab === "form" && <ReviewFieldsEditor definition={d} onChange={edit} target={target} />}
        {tab === "flow" && <FlowDesigner definition={d} onChange={edit} people={context?.people || []} issues={checked ? issues : []} target={target} onIssue={locate} />}
        {tab === "publish" && <ReviewPublishPanel definition={d} context={context} issues={issues} checkState={checkState} onCheck={() => go("publish")} onIssue={locate} values={values} onValues={v => { setValues(v); setResult(undefined); setTrialState(trialState === "idle" ? "idle" : "stale"); }} choices={trialChoices} onChoices={v => { setTrialChoices(v); setResult(undefined); setTrialState("stale"); }} requester={requester} onRequester={id => { setRequester(id); setTrialChoices({}); setResult(undefined); setTrialState(trialState === "idle" ? "idle" : "stale"); }} result={result} trialState={trialState} template={!dirty ? active : undefined} onTrial={() => void perform(async () => {
          const token = revision.current; setOperation("trial"); setTrialState("running");
          try { const trial = await reviewApi<ReviewSimulation>("/admin/approval-types/v2/simulate", { definition: d, values, requester, selectedApprovers: trialChoices }); if (token === revision.current && mounted.current) { setResult(trial); setTrialState("done"); } }
          catch (e) { setError((e as Error).message); setTrialState("failed"); }
        })} />}
      </fieldset>
      <footer className="review-save-bar"><span role="status" className="review-save-status">{operation === "saving" ? "正在保存…" : saveFailed ? "保存失败，内容已保留" : dirty ? "有未保存修改" : `已保存 v${active?.version}`}</span>{stepIndex > 0 && <button disabled={locked} onClick={() => go(steps[stepIndex - 1][0])}>上一步</button>}{stepIndex < 3 ? <button className={command.busy ? "" : "primary"} disabled={locked} onClick={() => go(steps[stepIndex + 1][0])}>{stepIndex === 2 ? "保存并检查" : `下一步：${steps[stepIndex + 1][1]}`}</button> : <><small className="review-publish-reason" role="status">{publishReason}</small><button className={command.busy ? "" : "primary"} disabled={locked || !!publishReason || !active} onClick={() => active && command.run({ action: "publish", templateId: active.id, expectedVersion: active.version })}>发布流程 v{active?.version || 1}</button></>}</footer>
    </>}
    <ReviewLeaveDialog open={leaving} busy={locked} error={error} onStay={() => setLeaving(false)} onDiscard={leave} onSave={async () => { await perform(async () => { if (await saveSnapshot()) leave(); }); }} />
    {!!companyTarget && <div className="review-company-switch" ref={companyDialog} role="dialog" aria-modal="true" aria-label="切换公司"><p>切换公司将离开当前编辑上下文，草稿仍属于原公司，不会迁移。</p><button onClick={() => setCompanyTarget("")}>留在当前公司</button><button onClick={() => { const id = companyTarget; setCompanyTarget(""); requestLeave(() => { const url = new URL(window.location.href); url.searchParams.set("reviewCompany", id); window.location.assign(url.toString()); }); }}>继续切换</button></div>}
    {command.dialog}
  </main>;
}
