import { useEffect, useState, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import type { ReviewTemplate, ReviewDraft, ReviewChoices as Choices, ReviewPreview, ReviewCommand, ReviewSource } from "../../../shared/review";
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
import { ReviewDetail, reviewStatusLabel } from "../reviews/ReviewDetail";
import { UpgradeDraft } from "../reviews/ReviewChanges";
import { ReviewOrganization } from "../reviews/ReviewOrganization";
import { ReviewChoices } from "../reviews/ReviewChoices";
import { ReviewSubmissionPreview } from "../reviews/ReviewSubmissionPreview";
import { ReviewLeaveDialog } from "../reviews/ReviewLeaveDialog";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { randomUuid } from "../uuid";
import { storePending } from "../components/ChatBlocks";
export default function Reviews() {
  const navigate = useNavigate();
  const [choices, setChoices] = useState<Choices>({}), [preview, setPreview] = useState<ReviewPreview>(), [previewBusy, setPreviewBusy] = useState(false);
  const [previewSignature, setPreviewSignature] = useState(""), [leaving, setLeaving] = useState(false);
  const leaveAction = useRef<() => void>(() => {});
  const [assistantText, setAssistantText] = useState(""), [assistantOpen, setAssistantOpen] = useState(false), [assistantBusy, setAssistantBusy] = useState(false);
  const restoredDraft = useRef("");
  const restoredSource = useRef("");
  const [source, setSource] = useState<ReviewSource>();
  const pendingCreation = useRef<{key: string; signature: string} | undefined>(undefined);
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
          JSON.stringify(draft.values) === JSON.stringify(values) &&
          JSON.stringify(draft.selectedApprovers || {}) === JSON.stringify(choices)
        )
      ) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [creating, title, values, choices, draft, templateId]);
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
    const ordinary = ts.filter(t=>t.definition.subjectType !== "knowledge_publication");
    setTemplates(ordinary);
    setTemplateId(current => current || ordinary[0]?.id || "");
    await loadList();
    setDrafts(savedDrafts);
    const requestedDraft = new URLSearchParams(location.search).get("draft");
    if (requestedDraft && restoredDraft.current !== requestedDraft) {
      const saved = savedDrafts.find(d => d.id === requestedDraft);
      if (!saved) throw new Error("申请草稿不存在或不在当前账号和公司范围内。");
      restoredDraft.current = requestedDraft;
      const current = ts.find(t => t.id === saved.templateId);
      if (!current || current.version !== saved.templateVersion) setUpgradeId(saved.id);
      else { setDraft(saved); setSource(saved.source); setTemplateId(saved.templateId); setTitle(saved.title); setValues(saved.values); setChoices(saved.selectedApprovers || {}); setCreating(true); setDraftNotice("已恢复申请草稿，请补齐并核对后提交。"); }
    }
    const sourceId = new URLSearchParams(location.search).get("sourceId");
    if (!requestedDraft && sourceId && restoredSource.current !== sourceId) {
      const origin = await reviewApi<ReviewSource>(`/approvals/v2/source/collaboration/${encodeURIComponent(sourceId)}`);
      restoredSource.current = sourceId; setSource(origin); setCreating(true);
      const available = ts.find(t => !t.definition.subjectType);
      setTemplateId(available?.id || ""); setTitle(`${origin.label}的审批申请`.slice(0, 200));
      setValues(available?.definition.fields.some(f => f.id === "object_reference" && f.type === "text") ? { object_reference: `${origin.label} · ${origin.id} · 材料版本 ${origin.version}` } : {});
    }
    if (selected) {
      const detail = await reviewApi<InstanceView>(`/approvals/v2/instances/${selected.id}`);
      if (selectionRequest === detailRequest.current) setSelected(detail);
      return detail;
    }
  }
  const command = useReviewCommand(async (receipt, action) => {
    setCreating(false);
    setDraft(undefined); setSource(undefined); pendingCreation.current = undefined;
    setDraftNotice("");
      setValues({});
      setChoices({}); setPreview(undefined);
    setTitle("");
    setReason("");
    const refreshed = await load();
    const detail = action === "submit" ? await reviewApi<InstanceView>(`/approvals/v2/instances/${receipt.resourceId}`) : refreshed;
    if (action === "submit" && detail) setSelected(detail);
    if (detail) {
      const pending = detail.tasks.filter(t => t.status === "pending");
      return `${reviewStatusLabel(detail)}${pending.length ? ` · 当前处理人：${pending.map(t => context?.people.find(p => p.id === t.userId)?.name || t.userId).join("、")}` : ""}`;
    }
  });
  const saveLock = useRef(false);
  const [autosavePaused, setAutosavePaused] = useState(false);
  async function savePersonalDraft(automatic = false) {
    if (!template || saving || previewBusy || command.busy || saveLock.current) return;
    saveLock.current = true;
    setSaving(true);
    const content = JSON.stringify({ template: template.id, version: template.version, title, values, choices, source });
    if (!draft && pendingCreation.current?.signature !== content) pendingCreation.current = { key: randomUuid(), signature: content };
    try {
      const saved = await reviewApi<ReviewDraft>("/approvals/v2/drafts", {
        id: draft?.id,
        version: draft?.version,
        templateId: template.id,
        templateVersion: template.version,
        title,
        values,
        selectedApprovers: choices, source,
        ...(!draft ? { creationKey: pendingCreation.current?.key } : {}),
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
      return saved;
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
      previewBusy ||
      autosavePaused ||
      (!title && !Object.keys(values).length)
    )
      return;
    if (
      draft?.templateId === template.id &&
      draft.templateVersion === template.version &&
      draft.title === title &&
      JSON.stringify(draft.values) === JSON.stringify(values) && JSON.stringify(draft.selectedApprovers || {}) === JSON.stringify(choices)
    )
      return;
    const timer = window.setTimeout(() => {
      void savePersonalDraft(true);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [
    creating,
    templateId,
    choices,
    previewBusy,
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
  const applicationSignature = JSON.stringify({ templateId, templateVersion: template?.version, title, values, choices, source });
  const currentSignature = useRef(applicationSignature); currentSignature.current = applicationSignature;
  const currentPreview = previewSignature === applicationSignature ? preview : undefined;
  const dirty = creating && Boolean(title || Object.keys(values).length || Object.keys(choices).length) && !(draft?.templateId === templateId
    && draft.title === title && JSON.stringify(draft.values) === JSON.stringify(values) && JSON.stringify(draft.selectedApprovers || {}) === JSON.stringify(choices));
  const createCommand = (): Extract<ReviewCommand, { action: "submit" }> | undefined => template ? { action: "submit", templateId: template.id, templateVersion: template.version,
    title, values, selectedApprovers: choices, source, ...(draft ? { draft: { id: draft.id, version: draft.version } } : {}) } : undefined;
  const previewLock = useRef(false);
  async function checkApplication(submit = false) {
    const action = createCommand();
    if (!action || previewLock.current || saving || command.busy) return;
    previewLock.current = true; setPreviewBusy(true); setError("");
    const signature = applicationSignature;
    try {
      const result = await reviewApi<ReviewPreview>("/approvals/v2/preview", action);
      if (currentSignature.current !== signature) return;
      setPreview(result); setPreviewSignature(signature);
      if (submit) await command.run(action);
    } catch (e) { setError((e as Error).message); }
    finally { previewLock.current = false; setPreviewBusy(false); }
  }
  useEffect(() => {
    if (!dirty) return;
    const onLink = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element).closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target || anchor.download) return;
      const url = new URL(anchor.href); if (url.origin !== location.origin || url.href === location.href) return;
      event.preventDefault(); event.stopPropagation();
      if (saving || previewBusy || command.busy) return;
      leaveAction.current = () => navigate(url.pathname + url.search + url.hash); setLeaving(true);
    };
    document.addEventListener("click", onLink, true); return () => document.removeEventListener("click", onLink, true);
  }, [dirty, saving, previewBusy, command.busy]);
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
      if (request !== detailRequest.current) return false;
      setSelected(detail);
      return true;
    } catch (e) {
      if (request === detailRequest.current) setError((e as Error).message);
      return false;
    } finally {
      if (request === detailRequest.current) setDetailLoading(false);
    }
  }
  return (
    <main className={`review-page review-workbench${wide && selected ? " is-wide" : ""}`}>
      <header className="review-toolbar">
        <h1>审批中心</h1>
        <ReviewOrganization />
        {context && <ReviewInbox refreshKey={command.receipt} onOpen={async id => { setCreating(false); if (!await show({ id } as InstanceView)) throw new Error("未能打开审批，请重试；通知仍保留未读。"); }} />}
        <Link to="/approvals/legacy">旧审批单据</Link>
        {new URLSearchParams(location.search).get("session") && <Link to={`/s/${encodeURIComponent(new URLSearchParams(location.search).get("session")!)}`}>返回来源会话</Link>}
        {!creating && <button disabled={assistantBusy || !templates.length} onClick={() => setAssistantOpen(!assistantOpen)} aria-expanded={assistantOpen}>AI 辅助填写</button>}
        {!creating && (
          <button
            className={!selected && !command.busy ? "primary" : ""}
            disabled={
              !context || context.intake?.allowed === false
            }
            onClick={() => {
              setCreating(true);
              if (!templateId) setTemplateId(templates[0]?.id || "");
            }}
            title={context?.intake?.allowed === false ? context.intake.reason : undefined}
          >
            发起审批
          </button>
        )}
      </header>
      {assistantOpen && !creating && <form className="review-assistant-entry review-toolbar" onSubmit={async e => {
        e.preventDefault(); if (assistantBusy || !assistantText.trim()) return; setAssistantBusy(true); setError("");
        try { const session = await api.createSession(assistantText.slice(0, 40)); storePending(session.id, { text: assistantText, intent: "business_approval", entities: { review_company: context?.tenant, review_draft_only: true } }); navigate(`/s/${session.id}`); }
        catch (e) { setError((e as Error).message); } finally { setAssistantBusy(false); }
      }}><label>描述申请事项<input required value={assistantText} maxLength={4000} placeholder="说明要办什么，AI 仅形成草稿，提交仍需本人核对。" onChange={e => setAssistantText(e.target.value)} /></label><button disabled={assistantBusy || !assistantText.trim()}>{assistantBusy ? "正在打开会话…" : "整理申请草稿"}</button></form>}
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
            setDraft(saved); setSource(saved.source);
            setTemplateId(saved.templateId);
            setTitle(saved.title);
            setValues(saved.values);
            setChoices(saved.selectedApprovers || {});
            setCreating(true);
            setUpgradeId(undefined);
            setDraftNotice("已复制兼容材料，请核对后提交；原草稿保留。");
          }}
        />
      )}
      {loading ? (
        <p role="status">正在加载当前组织的评审…</p>
      ) : creating && !templates.length ? (
        <section className="review-empty" aria-label="审批流程未就绪">
          <h2>发起审批</h2>
          <p role="status">当前组织尚无已发布且启用的普通审批流程，暂时无法提交申请。</p>
          <p>流程草稿需由组织管理员核对并发布后使用；知识发布流程仅用于知识治理。</p>
          <div className="review-toolbar">
            {context?.admin ? <Link to={`/admin/approval-types?reviewCompany=${encodeURIComponent(context.tenant)}`}>配置并发布审批流程</Link> : <span>请联系组织管理员配置并发布审批流程。</span>}
            <button type="button" onClick={() => { setError(""); void load().catch(e => setError(e.message)); }}>重新读取流程</button>
            <button type="button" onClick={() => setCreating(false)}>返回审批列表</button>
          </div>
        </section>
      ) : creating ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void checkApplication(true);
          }}
        >
          <h2>发起审批</h2>
          {source && <p role="status">来源：{source.label} · {source.snapshot.brand} · {source.snapshot.stage} · 材料版本 {source.version.slice(0, 12)} <Link to={`/pipeline?kol=${encodeURIComponent(source.snapshot.handle)}`}>返回合作对象</Link></p>}
          <div className="review-create-workspace">
          <fieldset className="review-form review-create-fields" disabled={command.busy || saving || previewBusy}>
            <label>
              审批类型
              <select
                value={templateId}
                onChange={(e) => {
                  setTemplateId(e.target.value);
                  setValues(source && templates.find(t => t.id === e.target.value)?.definition.fields.some(f => f.id === "object_reference" && f.type === "text") ? { object_reference: `${source.label} · ${source.id} · 材料版本 ${source.version}` } : {});
                  setChoices({}); setPreview(undefined);
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
            {template && <ReviewChoices definition={template.definition} candidates={template.choiceCandidates || {}} people={context?.people || []} values={choices} onChange={setChoices} />}
            <p role="status">{draftNotice || "R2 草稿 · 填写内容尚未提交"}</p>
          </fieldset>
          <ReviewSubmissionPreview template={template} preview={currentPreview} people={context?.people || []} busy={previewBusy} />
          </div>
            <div className="review-toolbar review-submit-bar">
              <button
                type="button"
                disabled={!template || saving || command.busy || previewBusy}
                onClick={() => void savePersonalDraft()}
              >
                保存草稿
              </button>
              <button type="button" disabled={saving || command.busy || previewBusy} onClick={() => setCreating(false)}>
                返回（保留本次填写）
              </button>
              <button type="button" disabled={!template || saving || command.busy || previewBusy} onClick={() => void checkApplication()}>核对申请与路径</button>
              <button
                disabled={!template || saving || command.busy || previewBusy || context?.intake?.allowed === false}
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
                          setDraft(saved); setSource(saved.source);
                          setTemplateId(saved.templateId);
                          setTitle(saved.title);
                          setValues(saved.values);
                          setChoices(saved.selectedApprovers || {});
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
              ["done", "已处理"],
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
              <td>{i.definition.name}</td><td><span data-review-status={i.status}>{reviewStatusLabel(i)}</span></td>
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
      <ReviewLeaveDialog open={leaving} busy={saving || command.busy || previewBusy} error={error} subject="申请" onStay={() => setLeaving(false)} onDiscard={() => { setLeaving(false); leaveAction.current(); }} onSave={async () => { if (await savePersonalDraft()) { setLeaving(false); leaveAction.current(); } }} />
      {command.dialog}
    </main>
  );
}
