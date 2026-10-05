import { formatReviewValue } from "../reviews/formatReviewValue";
import { ReviewOrganization } from "../reviews/ReviewOrganization";
import { AttachmentLinks } from "../reviews/ReviewAttachments";
import KnowledgeMaterial from "../reviews/KnowledgeMaterial";
import { UpgradeDraft } from "../reviews/ReviewChanges";
import { useEffect, useState, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import type { ReviewTemplate, ReviewDraft } from "../../../shared/review";
import {
  reviewApi,
  type InstanceView,
  type ReviewContext,
} from "../reviews/api";
import { ReviewForm } from "../reviews/ReviewForm";
import { ReviewActions, reviewActionLabels } from "../reviews/ReviewActions";
import { ReviewInbox } from "../reviews/ReviewInbox";
import { useReviewCommand } from "../reviews/useReviewCommand";
import "../reviews/reviews.css";
const statusText = {
  reviewing: "评审中",
  approved: "已通过",
  rejected: "已拒绝",
  withdrawn: "已撤回",
  blocked: "已阻塞",
  awaiting_amendment: "等待补充材料",
};
const taskText = {
  pending: "待处理",
  waiting: "等待前序",
  approved: "已同意",
  rejected: "已拒绝",
  cancelled: "已关闭",
  transferred: "已转交",
  suspended: "已暂停",
  superseded: "已被新轮次取代",
  completed: "已完成",
};
export default function Reviews() {
  const { id } = useParams(),
    [context, setContext] = useState<ReviewContext>(),
    [templates, setTemplates] = useState<ReviewTemplate[]>([]),
    [instances, setInstances] = useState<InstanceView[]>([]),
    [selected, setSelected] = useState<InstanceView>(),
    [creating, setCreating] = useState(false),
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
      setSelected(
        await reviewApi<InstanceView>(`/approvals/v2/instances/${selected.id}`),
      );
    }
  }
  const command = useReviewCommand(async () => {
    setCreating(false);
    setDraft(undefined);
    setDraftNotice("");
    setValues({});
    setTitle("");
    setReason("");
    await load();
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
  async function show(i: InstanceView) {
    setError("");
    setReason("");
    try {
      setSelected(
        await reviewApi<InstanceView>(`/approvals/v2/instances/${i.id}`),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <main className="review-page">
      <ReviewOrganization />
      <header className="review-toolbar">
        <h1>评审中心</h1>
        <Link to="/approvals/legacy">旧审批单据</Link>
        {!creating && !selected && (
          <button
            className="primary"
            disabled={
              !context || !templates.length || context.intake?.allowed === false
            }
            onClick={() => {
              setCreating(true);
              if (!templateId) setTemplateId(templates[0]?.id || "");
            }}
          >
            发起评审
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
      {context && !creating && !selected && (
        <ReviewInbox
          refreshKey={command.receipt}
          onOpen={async (id) => {
            setReason("");
            setSelected(
              await reviewApi<InstanceView>(`/approvals/v2/instances/${id}`),
            );
          }}
        />
      )}
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
          <h2>发起评审</h2>
          <fieldset className="review-form" disabled={command.busy || saving}>
            <label>
              评审流程
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
                    {t.definition.name} · v{t.version}
                  </option>
                ))}
              </select>
            </label>
            <p>{template?.definition.description}</p>
            <label>
              申请标题
              <input
                required
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
            <div className="review-toolbar">
              <button
                type="button"
                disabled={!template}
                onClick={() => void savePersonalDraft()}
              >
                保存草稿
              </button>
              <button type="button" onClick={() => setCreating(false)}>
                返回（保留本次填写）
              </button>
              <button
                disabled={context?.intake?.allowed === false}
                className={command.busy ? "" : "primary"}
                type="submit"
              >
                预览并提交
              </button>
            </div>
          </fieldset>
        </form>
      ) : selected ? (
        <section>
          <div className="review-toolbar">
            <button onClick={() => setSelected(undefined)}>返回列表</button>
            <h2>{selected.title}</h2>
            <span>
              {statusText[selected.status]} · v{selected.templateVersion}
            </span>
          </div>
          {selected.knowledgePublication && <section aria-label="知识发布材料">
            <p>知识发布 · 原件：{selected.knowledgePublication.filename} · 材料版本 {selected.knowledgePublication.fingerprint.slice(0,12)}</p>
            <p>发布说明：{selected.knowledgePublication.releaseNote || "未填写"}</p>
            {selected.knowledgePublication.content ? <><pre className="kbv-body">{selected.knowledgePublication.content.body}</pre><dl>{Object.entries(selected.knowledgePublication.content.structured).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{Array.isArray(value)?value.join("、"):String(value)}</dd></div>)}</dl></> : <a href={`/api/approvals/v2/instances/${encodeURIComponent(selected.id)}/knowledge-source?company=${encodeURIComponent(selected.knowledgePublication.tenant)}`} target="_blank" rel="noreferrer">查看审批 PDF 原件（新窗口）</a>}
            <p>此流程通过后，服务端核对本次材料与授权并自动发布；未发布版本不参与员工问答。</p>
            <p>发布状态：{{waiting:"等待审批与发布服务",published:"已发布",failed:"发布失败",rejected:"已拒绝，未发布",withdrawn:"已撤回，未发布"}[selected.knowledgePublication.status]}</p>
            {selected.knowledgePublication.error && <p role="alert">{selected.knowledgePublication.error}</p>}
            {selected.knowledgePublication.receipt && <p>发布回执：{selected.knowledgePublication.receipt.id}</p>}
          </section>}
          {selected.blockedReason && (
            <p role="alert">{selected.blockedReason}</p>
          )}
          <dl className="review-values">
            {selected.definition.fields.filter(f=>f.id !== "knowledge_request" || selected.definition.subjectType !== "knowledge_publication").map((f) => (
              <div key={f.id}>
                <dt>{f.label}</dt>
                <dd>
                  {f.type === "attachment" ? (
                    <AttachmentLinks
                      ids={(selected.values[f.id] as string[]) || []}
                      instanceId={selected.id}
                    />
                  ) : (
                    formatReviewValue(selected.values[f.id])
                  )}
                </dd>
              </div>
            ))}
          </dl>
          {selected.definition.subjectType === "knowledge_publication" && !selected.knowledgePublication && <KnowledgeMaterial id={selected.id} />}
          <h3>评审进度</h3>
          <ol className="review-list">
            {selected.tasks.map((t, index) => (
              <li key={index}>
                <span>
                  {
                    selected.definition.nodes.find((n) => n.id === t.nodeId)
                      ?.name
                  }{" "}
                  /{" "}
                  {context?.people.find((p) => p.id === t.userId)?.name ||
                    t.userId}
                </span>
                <span>
                  第 {t.round || 1} 轮 · {taskText[t.status]}
                  {t.status === "pending" &&
                  t.dueAt &&
                  Date.parse(t.dueAt) < Date.now()
                    ? " · 已超时"
                    : ""}
                </span>
                {t.reason && <span>{t.reason}</span>}
              </li>
            ))}
          </ol>
          {selected.allowedActions.length > 0 && (
            <ReviewActions
              key={`${selected.id}:${selected.round || 1}`}
              instance={selected}
              people={context?.people || []}
              reason={reason}
              setReason={setReason}
              busy={command.busy}
              run={command.run}
            />
          )}
          {(selected.revisions?.length || 0) > 1 && (
            <details>
              <summary>历次材料（当前第 {selected.round || 1} 轮）</summary>
              {selected.revisions?.map((r) => (
                <section key={r.round}>
                  <h3>第 {r.round} 轮</h3>
                  <dl className="review-values">
                    {selected.definition.fields.map((f) => (
                      <div key={f.id}>
                        <dt>{f.label}</dt>
                        <dd>
                          {f.type === "attachment" ? (
                            <AttachmentLinks
                              ids={(r.values[f.id] as string[]) || []}
                              instanceId={selected.id}
                            />
                          ) : (
                            formatReviewValue(r.values[f.id])
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </details>
          )}
          <h3>操作记录</h3>
          <ol>
            {selected.events?.map((e) => (
              <li key={e.id}>
                {new Date(e.created_at).toLocaleString()} ·{" "}
                {context?.people.find((p) => p.id === e.actor)?.name || e.actor}{" "}
                ·{" "}
                {{
                  submit: "提交",
                  approve: "同意",
                  reject: "拒绝",
                  withdraw: "撤回",
                  retry: "重试",
                }[e.action] ||
                  reviewActionLabels[e.action] ||
                  e.action}
                {e.detail.reason && ` · ${e.detail.reason}`}
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <>
          <section aria-label="个人草稿">
            {drafts.length > 0 && (
              <>
                <h2>个人草稿</h2>
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
                </ul>
              </>
            )}
          </section>
          <nav aria-label="评审列表" className="review-toolbar">
            {[
              ["todo", "待我评审"],
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
            <button onClick={() => load().catch((e) => setError(e.message))}>
              刷新
            </button>
          </nav>
          {!templates.length && (
            <p>当前组织暂无已发布流程，请联系流程管理员。</p>
          )}
          <form
            className="review-toolbar"
            onSubmit={(e) => {
              e.preventDefault();
              setCursor(undefined);
              setSearch(query);
            }}
          >
            <label>
              搜索标题或流程名称
              <input
                value={query}
                maxLength={120}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <button type="submit">搜索</button>
          </form>
          {listLoading ? (
            <p role="status">正在检索参与范围内的评审…</p>
          ) : (
            !instances.length && (
              <p>
                当前页暂无匹配评审。{nextCursor ? "可继续检索下一页。" : ""}
              </p>
            )
          )}
          <ul className="review-list">
            {instances.map((i) => (
              <li key={i.id}>
                <button onClick={() => show(i)}>{i.title}</button>
                <span>{i.definition.name}</span>
                <span>{statusText[i.status]}</span>
                <time>{new Date(i.updatedAt).toLocaleString()}</time>
              </li>
            ))}
          </ul>
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
          <p className="review-muted">
            按发起时间排序；每页最多 30 条。通过评审不会自动外发或推进业务阶段。
          </p>
        </>
      )}
      {command.dialog}
    </main>
  );
}
