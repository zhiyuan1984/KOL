import { ReviewAuthorOrganization } from "../reviews/ReviewAuthorOrganization";
import { ReviewLeaveDialog } from "../reviews/ReviewLeaveDialog";
import { ReviewFieldsEditor } from "../reviews/ReviewFieldsEditor";
import { PublishChanges } from "../reviews/ReviewChanges";
import { useEffect, useReducer, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  emptyReviewDefinition,
  knowledgeReviewDefinition,
  type ReviewDefinition,
  type ReviewTemplate,
  type ReviewIssue,
} from "../../../shared/review";
import { reviewApi, type ReviewContext } from "../reviews/api";
import { FlowDesigner } from "../reviews/FlowDesigner";
import { ReviewForm } from "../reviews/ReviewForm";
import { useReviewCommand } from "../reviews/useReviewCommand";
import "../reviews/reviews.css";
type History = {
  past: ReviewDefinition[];
  present: ReviewDefinition;
  future: ReviewDefinition[];
};
const steps = [["basic", "填写基本信息"], ["form", "填写表单字段"], ["flow", "添加节点"], ["publish", "校验与发布"]];
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
  const leaveAction = useRef<() => void>(() => {}), allowLeave = useRef(false);
  const [leaving, setLeaving] = useState(false), [validatedVersion, setValidatedVersion] = useState<number>();
  const [context, setContext] = useState<ReviewContext>(),
    [list, setList] = useState<ReviewTemplate[]>([]),
    [active, setActive] = useState<ReviewTemplate>(),
    [editing, setEditing] = useState(false),
    [tab, setTab] = useState("basic"),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [issues, setIssues] = useState<ReviewIssue[]>([]),
    [validation, setValidation] = useState(""),
    [values, setValues] = useState<Record<string, unknown>>({}),
    [simulation, setSimulation] = useState(""),
    [requester, setRequester] = useState("");
  const [history, dispatch] = useReducer(definitionHistory, {
      past: [],
      present: emptyReviewDefinition(),
      future: [],
    }),
    d = history.present;
  const dirty =
    editing &&
    (!active || JSON.stringify(active.definition) !== JSON.stringify(d));
  async function load() {
    const [ctx, rows] = await Promise.all([
      reviewApi<ReviewContext>("/approvals/v2/context"),
      reviewApi<ReviewTemplate[]>("/admin/approval-types/v2/templates"),
    ]);
    setContext(ctx);
    setList(rows);
    return rows;
  }
  const command = useReviewCommand(async () => {
    const rows = await load();
    if (active) setActive(rows.find((t) => t.id === active.id));
  });
  useEffect(() => {
    load()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (dirty && !allowLeave.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [dirty]);
  useEffect(() => { setValidatedVersion(undefined); setValidation(""); setIssues([]); setSimulation(""); }, [d]);
  function requestLeave(action: () => void) {
    if (busy || command.busy) return;
    if (!dirty) { action(); return; }
    leaveAction.current = action;
    setLeaving(true);
  }
  function leave() {
    allowLeave.current = true;
    setLeaving(false);
    leaveAction.current();
  }
  function back() {
    requestLeave(() => {
      const returnTo = new URLSearchParams(window.location.search).get("returnTo");
      if (returnTo?.startsWith("/admin/knowledge?")) navigate(returnTo);
      else if (editing) setEditing(false);
      else if (window.history.state?.idx > 0) navigate(-1);
      else navigate("/admin");
      allowLeave.current = false;
    });
  }
  useEffect(() => {
    if (!dirty) return;
    const onLink = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element).closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target || anchor.download) return;
      const url = new URL(anchor.href);
      if (url.origin !== window.location.origin || url.href === window.location.href) return;
      event.preventDefault(); event.stopPropagation();
      requestLeave(() => navigate(url.pathname + url.search + url.hash));
    };
    document.addEventListener("click", onLink, true);
    return () => document.removeEventListener("click", onLink, true);
  }, [dirty, busy, command.busy]);
  function edit(next: ReviewDefinition) {
    dispatch({ type: "edit", value: next });
    setValidation("");
    setIssues([]);
    setSimulation("");
  }
  function open(t?: ReviewTemplate) {
    allowLeave.current = false;
    setActive(t);
    dispatch({
      type: "reset",
      value: t?.definition || { ...(new URLSearchParams(window.location.search).get("subject")==="knowledge_publication" ? knowledgeReviewDefinition() : emptyReviewDefinition()), ...(context?.organization?.defaultUnitId ? { organizationUnitId: context.organization.defaultUnitId } : {}) },
    });
    setEditing(true);
    setTab("basic");
    setIssues([]);
    setValidation("");
    setSimulation("");
    setValues({});
  }
  async function save() {
    if (!active && context?.organization?.units.length && !d.organizationUnitId) {
      setError("请选择流程归属部门或当前公司范围后保存。");
      return false;
    }
    setBusy(true);
    setError("");
    try {
      const saved = await reviewApi<ReviewTemplate>(
        active
          ? `/admin/approval-types/v2/templates/${active.id}`
          : "/admin/approval-types/v2/templates",
        { definition: d, expectedVersion: active?.version },
        active ? "PUT" : "POST",
      );
      setActive(saved);
      await load();
      setValidatedVersion(undefined);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function validate() {
    if (!active || dirty) return;
    setBusy(true);
    setError("");
    try {
      const result = await reviewApi<{ issues: ReviewIssue[] }>(
        "/admin/approval-types/v2/validate",
        { definition: d },
      );
      setIssues(result.issues);
      setValidation(result.issues.length ? "校验未通过" : "结构校验通过");
      setValidatedVersion(result.issues.length ? undefined : active.version);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const locked = busy || command.busy;
  const stepIndex = steps.findIndex(([id]) => id === tab);
  return (
    <main className={`review-page review-author-page${editing ? " is-editing" : ""}`} aria-busy={locked || undefined}>
      <ReviewAuthorOrganization context={context} unitId={editing ? d.organizationUnitId : context?.organization?.defaultUnitId}
        onUnitChange={id => { if (editing) edit({ ...d, organizationUnitId: id }); }}
        onCompanyChange={id => { if (id && id !== context?.tenant) requestLeave(() => { const url = new URL(window.location.href); url.searchParams.set("reviewCompany", id); window.location.assign(url.toString()); }); }}
        onBack={back} disabled={locked} editing={editing} />
      <header className="review-toolbar">
        <h1>{editing ? active ? "编辑审批流程" : "新建审批流程" : "评审流程管理"}</h1>
        {!editing && <button className="primary" disabled={loading || !context?.admin} onClick={() => open()}>新建流程</button>}
      </header>
      {!leaving && (error || command.error) && (
        <p role="alert" className="review-error">
          {error || command.error}{" "}
          <button
            disabled={locked}
            onClick={() => {
              setLoading(true);
              load()
                .catch((e) => setError(e.message))
                .finally(() => setLoading(false));
            }}
          >
            重新加载
          </button>
        </p>
      )}
      {command.receipt && <p role="status">{command.receipt}</p>}
      {loading ? (
        <p role="status">正在加载当前组织的流程…</p>
      ) : !editing ? (
        <>
          <p>创建可复用的表单和评审流程，发布后员工即可发起。</p>
          {!list.length && <p>当前组织还没有评审流程。</p>}
          <ul className="review-list">
            {list.map((t) => (
              <li key={t.id}>
                <button onClick={() => open(t)}>{t.definition.name}</button>
                <span>
                  草稿 v{t.version} ·{" "}
                  {t.publishedVersion
                    ? `${t.enabled === false ? "已停用 · " : ""}已发布 v${t.publishedVersion}`
                    : "未发布"}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <nav className="review-steps" aria-label="流程配置步骤">
            {steps.map(([id, label], index) => <button key={id} aria-label={label} disabled={locked}
              aria-current={tab === id ? "step" : undefined} aria-controls="review-editor-content" onClick={() => setTab(id)}>
              <span className="review-step-heading"><span className="review-step-number" aria-hidden="true">{index + 1}</span>{label}</span>
              <small>{id === "basic" ? d.name.trim() ? "已填写" : "待填写" : id === "form" ? `${d.fields.length} 个字段` : id === "flow" ? `${d.nodes.filter(n => !["start", "end"].includes(n.type)).length} 个节点` : dirty ? "待保存后校验" : validatedVersion === active?.version && validatedVersion !== undefined ? "校验通过" : validation || "待校验"}</small>
            </button>)}
          </nav>
          <fieldset disabled={locked} className="review-editor" id="review-editor-content" aria-label={steps[stepIndex][1]}>
            {tab === "basic" && (
              <div className="review-form">
                {d.subjectType === "knowledge_publication" && <p>知识发布流程：人工审核通过后自动发布被冻结的资料版本。原件变化须重新申请。</p>}
                <label>
                  流程名称
                  <input
                    maxLength={120}
                    value={d.name}
                    onChange={(e) => edit({ ...d, name: e.target.value })}
                  />
                </label>
                <label>
                  发起说明
                  <textarea
                    maxLength={2000}
                    value={d.description}
                    onChange={(e) =>
                      edit({ ...d, description: e.target.value })
                    }
                  />
                </label>
                <p>
                  可用于内容评审、合作方案、资源申请等。金额只是可选字段，流程不会内置费用规则。
                </p>
              </div>
            )}
            {tab === "form" && <ReviewFieldsEditor definition={d} onChange={edit} />}
            {tab === "flow" && (
              <FlowDesigner
                definition={d}
                onChange={edit}
                people={context?.people || []}
              />
            )}
            {tab === "publish" && (
              <>
                <h2>校验与试运行</h2>
                <p>
                  试运行只检查分支与评审人，不创建申请。员工填写的真实材料会在发起时再次校验。
                </p>
                <button disabled={dirty || !active} onClick={validate}>校验流程</button>
                {issues.length > 0 && (
                  <ul role="alert">
                    {issues.map((x, i) => (
                      <li key={i}>
                        {x.message} <button onClick={() => {
                          setTab(x.path.startsWith("fields") ? "form" : x.path.startsWith("nodes") ? "flow" : "basic");
                        }}>前往修正</button>
                      </li>
                    ))}
                  </ul>
                )}
                <label>
                  模拟发起人
                  <select
                    value={requester || context?.actor || ""}
                    onChange={(e) => {
                      setRequester(e.target.value);
                      setSimulation("");
                    }}
                  >
                    {context?.people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <ReviewForm
                  fields={d.fields}
                  values={values}
                  onChange={(v) => {
                    setValues(v);
                    setSimulation("");
                  }}
                />
                <button
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const result = await reviewApi<{
                        status: string;
                        blockedReason?: string;
                        issues: ReviewIssue[];
                        tasks: { userId: string; nodeId: string }[];
                      }>("/admin/approval-types/v2/simulate", {
                        definition: d,
                        values,
                        requester: requester || context?.actor,
                      });
                      setSimulation(
                        result.issues.length
                          ? result.issues.map((i) => i.message).join("；")
                          : result.blockedReason ||
                              `可走通。评审节点：${result.tasks.map((t) => `${d.nodes.find((n) => n.id === t.nodeId)?.name} / ${context?.people.find((p) => p.id === t.userId)?.name || t.userId}`).join(" → ")}`,
                      );
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  用样例试运行
                </button>
                <p role="status">{simulation}</p>
                {active && !dirty && (
                  <PublishChanges id={active.id} version={active.version} />
                )}
                <p>
                  当前可用：基础表单、条件分支、四种评审方式。可配置转交、加签、补充材料重审和超时策略。支持抄送、征询与办理。支持权限校验的附件上传与下载，外部执行尚未开放。
                </p>
                {active?.publishedVersion && (
                  <button
                    disabled={dirty || command.busy}
                    onClick={() =>
                      command.run({
                        action: active.enabled === false ? "enable" : "disable",
                        templateId: active.id,
                        expectedVersion: active.version,
                        expectedLifecycleVersion: active.lifecycleVersion || 0,
                      })
                    }
                  >
                    {active.enabled === false ? "启用流程" : "停用流程"}
                  </button>
                )}
                {dirty && <p>请先保存当前草稿，再发布或调整启停状态。</p>}
              </>
            )}
          </fieldset>
          <footer className="review-save-bar">
            <span role="status" className="review-save-status">{busy ? "正在处理…" : dirty ? active ? "有未保存修改" : "尚未保存" : `已保存 v${active?.version}`}</span>
            <button className="review-quiet" disabled={locked || !history.past.length} onClick={() => dispatch({ type: "undo" })}>撤销</button>
            <button className="review-quiet" disabled={locked || !history.future.length} onClick={() => dispatch({ type: "redo" })}>重做</button>
            <button className="review-quiet" disabled={locked || !dirty || (!active && Boolean(context?.organization?.units.length) && !d.organizationUnitId)} onClick={save}>{active ? "保存" : "保存草稿"}</button>
            {stepIndex > 0 && <button className="review-quiet" disabled={locked} onClick={() => setTab(steps[stepIndex - 1][0])}>上一步</button>}
            {stepIndex < steps.length - 1 ? <button className={command.busy ? "" : "primary"} disabled={locked} onClick={() => setTab(steps[stepIndex + 1][0])}>继续：{steps[stepIndex + 1][1]}</button> :
              <button className={command.busy ? "" : "primary"}
                disabled={locked || dirty || !active || validatedVersion !== active.version || active.publishedVersion === active.version}
                onClick={() => active && command.run({ action: "publish", templateId: active.id, expectedVersion: active.version })}>发布流程 v{active?.version || 1}</button>}
          </footer>

        </>
      )}
      <ReviewLeaveDialog open={leaving} busy={busy} error={error} onStay={() => setLeaving(false)} onDiscard={leave} onSave={async () => { if (await save()) leave(); }} />
      {command.dialog}
    </main>
  );
}
