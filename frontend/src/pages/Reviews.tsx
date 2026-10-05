import { useEffect, useState, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import type { ReviewTemplate, ReviewDraft } from "../../../shared/review";
import {
  reviewApi,
  type InstanceView,
  type ReviewContext,
} from "../reviews/api";
import { ReviewForm } from "../reviews/ReviewForm";
import { ReviewActions } from "../reviews/ReviewActions";
import { ReviewInbox } from "../reviews/ReviewInbox";
import { useReviewCommand } from "../reviews/useReviewCommand";
import "../reviews/reviews.css";
import { ReviewDetail, reviewStatusText as statusText } from "../reviews/ReviewDetail";
import { UpgradeDraft } from "../reviews/ReviewChanges";
import { ReviewOrganization } from "../reviews/ReviewOrganization";
export default function Reviews() {
  const { id } = useParams(),
    [context, setContext] = useState<ReviewContext>(),
    [templates, setTemplates] = useState<ReviewTemplate[]>([]),
    [instances, setInstances] = useState<InstanceView[]>([]),
    [selected, setSelected] = useState<InstanceView>(),
    [creating, setCreating] = useState(false),
    [wide, setWide] = useState(false),
    [detailLoading, setDetailLoading] = useState(false),
    [templateId, setTemplateId] = useState(""),
    [title, setTitle] = useState(""),
    [values, setValues] = useState<Record<string, unknown>>({}),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [filter, setFilter] = useState("todo"),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [cursor, setCursor] = useState<string>(),
    [nextCursor, setNextCursor] = useState<string | null>(null),
    [listLoading, setListLoading] = useState(false),
    [upgradeId, setUpgradeId] = useState<string>(),
    [drafts, setDrafts] = useState<ReviewDraft[]>([]),
    [draft, setDraft] = useState<ReviewDraft>(),
    [saving, setSaving] = useState(false),
    [draftNotice, setDraftNotice] = useState("");
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (
        creating &&
        (title || Object.keys(values).length) &&
        !(
          draft?.title === title &&
          draft.templateId === templateId &&
          JSON.stringify(draft.values) === JSON.stringify(values)
        )
      ) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [creating, title, values, draft, templateId]);
  const template = templates.find((t) => t.id === templateId);
  const listRequest = useRef(0);
  async function loadList() {
    const request = ++listRequest.current;
    setListLoading(true);
    try {
      const p = new URLSearchParams({ filter, q: search });
      if (cursor) p.set("cursor", cursor);
      const data = await reviewApi<{
        items: InstanceView[];
        nextCursor: string | null;
      }>(`/approvals/v2/instance-page?${p}`);
      if (request === listRequest.current) {
        setInstances(data.items);
        setNextCursor(data.nextCursor);
      }
    } finally {
      if (request === listRequest.current) setListLoading(false);
    }
  }
  useEffect(() => {
    loadList().catch((e) => setError(e.message));
  }, [filter, search, cursor]);
  async function load() {
    const selectionRequest = detailRequest.current;
    const [ctx, ts, savedDrafts] = await Promise.all([
      reviewApi<ReviewContext>("/approvals/v2/context"),
      reviewApi<ReviewTemplate[]>("/approvals/v2/templates"),
      reviewApi<ReviewDraft[]>("/approvals/v2/drafts"),
    ]);
    setContext(ctx);
    setTemplates(ts.filter(t=>t.definition.subjectType !== "knowledge_publication"));
    await loadList();
    setDrafts(savedDrafts);
    if (selected) {
      const detail = await reviewApi<InstanceView>(`/approvals/v2/instances/${selected.id}`);
      if (selectionRequest === detailRequest.current) setSelected(detail);
      return detail;
    }
  }
  const command = useReviewCommand(async (receipt, action) => {
    setCreating(false);
    setDraft(undefined);
    setDraftNotice("");
    setValues({});
    setTitle("");
    setReason("");
    const refreshed = await load();
    const detail = action === "submit" ? await reviewApi<InstanceView>(`/approvals/v2/instances/${receipt.resourceId}`) : refreshed;
    if (action === "submit" && detail) setSelected(detail);
    if (detail) {
      const pending = detail.tasks.filter(t => t.status === "pending");
      return `${statusText[detail.status]}${pending.length ? ` · 当前处理人：${pending.map(t => context?.people.find(p => p.id === t.userId)?.name || t.userId).join("、")}` : ""}`;
    }
  });
  const saveLock = useRef(false);
  const [autosavePaused, setAutosavePaused] = useState(false);
  async function savePersonalDraft(automatic = false) {
    if (!template || saving || command.busy || saveLock.current) return;
    saveLock.current = true;
    setSaving(true);
    try {
      const saved = await reviewApi<ReviewDraft>("/approvals/v2/drafts", {
        id: draft?.id,
        version: draft?.version,
        templateId: template.id,
        templateVersion: template.version,
        title,
        values,
      });
      setDraft(saved);
      setDrafts((previous) => [
        saved,
        ...previous.filter((d) => d.id !== saved.id),
      ]);
      setAutosavePaused(false);
      setDraftNotice(
        `${automatic ? "草稿已自动保存" : "草稿已保存"} v${saved.version}`,
      );
    } catch (e) {
      setAutosavePaused(true);
      setDraftNotice("自动保存已暂停，请保留当前填写并点击保存草稿重试。");
      setError((e as Error).message);
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }
  useEffect(() => {
    if (
      !creating ||
      !template ||
      saving ||
      command.busy ||
      autosavePaused ||
      (!title && !Object.keys(values).length)
    )
      return;
    if (
      draft?.templateId === template.id &&
      draft.templateVersion === template.version &&
      draft.title === title &&
      JSON.stringify(draft.values) === JSON.stringify(values)
    )
      return;
    const timer = window.setTimeout(() => {
      void savePersonalDraft(true);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [
    creating,
    templateId,
    template?.version,
    title,
    values,
    draft,
    saving,
    command.busy,
    autosavePaused,
  ]);
  useEffect(() => {
    load()
      .then(async () => {
        if (id)
          setSelected(
            await reviewApi<InstanceView>(`/approvals/v2/instances/${id}`),
          );
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);
  const detailRequest = useRef(0);
  useEffect(() => {
    if (!selected?.knowledgePublication || selected.knowledgePublication.status !== "waiting") return;
    const selectedId = selected.id, request = detailRequest.current;
    const timer = window.setInterval(() => {
      void reviewApi<InstanceView>(`/approvals/v2/instances/${selectedId}`).then(detail => {
        if (request === detailRequest.current) setSelected(detail);
      }).catch(e => { if (request === detailRequest.current) setError(e.message); });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [selected?.id, selected?.knowledgePublication?.status]);
  async function show(i: InstanceView) {
    const request = ++detailRequest.current;
    setDetailLoading(true);
    setError("");
    setReason("");
    try {
      const detail = await reviewApi<InstanceView>(`/approvals/v2/instances/${i.id}`);
      if (request === detailRequest.current) setSelected(detail);
    } catch (e) {
      if (request === detailRequest.current) setError((e as Error).message);
    } finally {
      if (request === detailRequest.current) setDetailLoading(false);
    }
  }
  return (
    <main className={`review-page review-workbench${wide && selected ? " is-wide" : ""}`}>
      <header className="review-toolbar">
        <h1>审批中心</h1>
        <ReviewOrganization />
        {context && <ReviewInbox refreshKey={command.receipt} onOpen={async id => { setCreating(false); await show({ id } as InstanceView); }} />}
        <Link to="/approvals/legacy">旧审批单据</Link>
        {!creating && (
          <button
            className={!selected && !command.busy ? "primary" : ""}
            disabled={
              !context || !templates.length || context.intake?.allowed === false
            }
            onClick={() => {
              setCreating(true);
              if (!templateId) setTemplateId(templates[0]?.id || "");
            }}
            title={!templates.length ? "暂无可发起的流程" : context?.intake?.allowed === false ? context.intake.reason : undefined}
          >
            发起审批
          </button>
        )}
      </header>
      {context?.intake?.allowed === false && (
        <p role="status">{context.intake.reason}</p>
      )}
      {(error || command.error) && (
        <p className="review-error" role="alert">
          {error || command.error}
          <button
            onClick={() => {
              setError("");
              load().catch((e) => setError(e.message));
            }}
          >
            重新加载
          </button>
        </p>
      )}
      {command.receipt && <p role="status">{command.receipt}</p>}
      {upgradeId && (
        <UpgradeDraft
          id={upgradeId}
          onClose={() => setUpgradeId(undefined)}
          onSaved={async (saved) => {
            await load();
            setDraft(saved);
            setTemplateId(saved.templateId);
            setTitle(saved.title);
            setValues(saved.values);
            setCreating(true);
            setUpgradeId(undefined);
            setDraftNotice("已复制兼容材料，请核对后提交；原草稿保留。");
          }}
        />
      )}
      {loading ? (
        <p role="status">正在加载当前组织的评审…</p>
      ) : creating ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (template)
              command.run({
                action: "submit",
                templateId: template.id,
                templateVersion: template.version,
                title,
                values,
                ...(draft
                  ? { draft: { id: draft.id, version: draft.version } }
                  : {}),
              });
          }}
        >
          <h2>发起审批</h2>
          <fieldset className="review-form review-create-fields" disabled={command.busy || saving}>
            <label>
              审批类型
              <select
                value={templateId}
                onChange={(e) => {
                  setTemplateId(e.target.value);
                  setValues({});
                  setDraft(undefined);
                  setDraftNotice("");
                }}
              >
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.definition.name} · 流程版本 v{t.version}
                  </option>
                ))}
              </select>
            </label>
            <p>{template?.definition.description}</p>
            <label>
              申请标题
              <input
                required
                data-review-field="title"
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            {template && (
              <ReviewForm
                fields={template.definition.fields}
                values={values}
                onChange={setValues}
                onUploadBusy={setSaving}
              />
            )}
            <p role="status">{draftNotice}</p>
          </fieldset>
            <div className="review-toolbar review-submit-bar">
              <button
                type="button"
                disabled={!template || saving || command.busy}
                onClick={() => void savePersonalDraft()}
              >
                保存草稿
              </button>
              <button type="button" disabled={saving || command.busy} onClick={() => setCreating(false)}>
                返回（保留本次填写）
              </button>
              <button
                disabled={saving || command.busy || context?.intake?.allowed === false}
                className={command.busy ? "" : "primary"}
                type="submit"
              >
                {command.busy ? "正在提交…" : "提交审批"}
              </button>
            </div>
        </form>
      ) : (
        <div className="review-workspace">
        <section className="review-list-pane" aria-label="审批列表区域">
          <section aria-label="个人草稿">
            {drafts.length > 0 && (
              <>
                <details><summary>个人草稿 · {drafts.length}</summary>
                <ul className="review-list">
                  {drafts.map((saved) => (
                    <li key={saved.id}>
                      <button
                        onClick={() => {
                          const current = templates.find(
                            (t) => t.id === saved.templateId,
                          );
                          if (
                            !current ||
                            current.version !== saved.templateVersion
                          ) {
                            setUpgradeId(saved.id);
                            return;
                          }
                          setDraft(saved);
                          setTemplateId(saved.templateId);
                          setTitle(saved.title);
                          setValues(saved.values);
                          setCreating(true);
                          setDraftNotice(`已恢复草稿 v${saved.version}`);
                        }}
                      >
                        {saved.title || "未命名草稿"}
                      </button>
                      <details>
                        <summary>查看已保存原材料</summary>
                        <pre>{JSON.stringify(saved.values, null, 2)}</pre>
                      </details>
                      <span>
                        v{saved.version} ·{" "}
                        {new Date(saved.updatedAt).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul></details>
              </>
            )}
          </section>
          <nav aria-label="审批列表" className="review-toolbar review-list-tools">
            {[
              ["todo", "待我处理"],
              ["mine", "我发起的"],
              ["all", "我参与的"],
            ].map(([key, label]) => (
              <button
                key={key}
                aria-current={filter === key ? "page" : undefined}
                onClick={() => {
                  setFilter(key);
                  setCursor(undefined);
                }}
              >
                {label}
              </button>
            ))}
            <form className="review-search" onSubmit={e => { e.preventDefault(); setCursor(undefined); setSearch(query); }}>
              <input aria-label="搜索标题或流程名称" placeholder="搜索标题或流程名称" value={query} maxLength={120} onChange={e => setQuery(e.target.value)} />
            </form>
            <button title="刷新" aria-label="刷新" disabled={listLoading || detailLoading || command.busy} onClick={() => load().catch(e => setError(e.message))}>↻</button>
          </nav>
          {detailLoading && <p role="status">正在加载申请详情…</p>}
          {listLoading ? (
            <p role="status">正在检索审批…</p>
          ) : (
            !instances.length && (
              <p>
                当前页暂无匹配申请。{nextCursor ? "可继续检索下一页。" : ""}
              </p>
            )
          )}
          <div className="review-table-scroll">
            <table className="review-table"><thead><tr><th>申请标题</th><th>流程</th><th>状态</th><th>发起时间</th></tr></thead>
            <tbody>{instances.map(i => <tr key={i.id} aria-selected={selected?.id === i.id} onClick={() => void show(i)}>
              <td><button title={i.title} className="review-row-title" onClick={e => { e.stopPropagation(); void show(i); }}>{i.title}</button></td>
              <td>{i.definition.name}</td><td><span data-review-status={i.status}>{statusText[i.status]}</span></td>
              <td><time dateTime={i.createdAt} title={new Date(i.createdAt).toLocaleString()}>{new Date(i.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}</time></td>
            </tr>)}</tbody></table>
          </div>
          <div className="review-toolbar">
            <button
              disabled={!cursor || listLoading}
              onClick={() => setCursor(undefined)}
            >
              回到首页
            </button>
            <button
              disabled={!nextCursor || listLoading}
              onClick={() => setCursor(nextCursor!)}
            >
              下一页
            </button>
          </div>
          <span className="review-muted">本页 {instances.length} 条 · 按发起时间排序</span>
        </section>
        {selected && <ReviewDetail instance={selected} context={context} wide={wide} toggleWide={() => setWide(!wide)} close={() => { ++detailRequest.current; setDetailLoading(false); setSelected(undefined); setWide(false); }} actions={selected.allowedActions.length > 0 ? <ReviewActions key={`${selected.id}:${selected.round || 1}`} instance={selected} people={context?.people || []} reason={reason} setReason={setReason} busy={command.busy} run={command.run} /> : null} />}
        </div>
      )}
      {command.dialog}
    </main>
  );
}
