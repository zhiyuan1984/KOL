import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { createPortal } from "react-dom";
import type {
  KnowledgePublicationCommand,
  KnowledgePublicationOptions,
} from "../../../../shared/knowledge-publication";
import { reviewApi, reviewCompany } from "../../reviews/api";
import { ReviewForm } from "../../reviews/ReviewForm";
import { useAdminConfirm } from "../../components/ConfirmDialog";
import { errorMessage, useKbData } from "./shared";
import KbvIcon from "../../knowledgeIcons";

const stateLabel: Record<string, string> = {
  reviewing: "审批中",
  approved: "审批通过 · 等待发布服务",
  rejected: "审批已拒绝",
  withdrawn: "已撤回",
  blocked: "审批阻塞",
  awaiting_amendment: "待补充材料",
  published: "已发布",
  failed: "发布失败",
};
const jobLabel:Record<string,string>={queued:"等待发布服务",running:"正在发布",retrying:"恢复处理中",failed:"发布作业失败",uncertain:"结果待核对",cancelled:"已取消",succeeded:"作业已结束"};
export default function PublicationPanel({
  id,
  notify,
  refreshDocument,
  actionTarget,
}: {
  id: string;
  notify: (s: string) => void;
  refreshDocument: () => void;
  actionTarget: HTMLElement | null;
}) {
  const [company, setCompany] = useState(reviewCompany);
  const [, setSearchParams] = useSearchParams();
  const publicationApi = useCallback(
    <T,>(url: string, body?: unknown) =>
      reviewApi<T>(url, body, body === undefined ? "GET" : "POST", company),
    [company],
  );
  const load = useCallback(
    () =>
      publicationApi<KnowledgePublicationOptions>(
        `/admin/knowledge/documents/${encodeURIComponent(id)}/publication`,
      ),
    [id, publicationApi],
  );
  const { data, error, loading, reload } = useKbData(load);
  const loadCompanies = useCallback(
    () =>
      reviewApi<{ id: string; name: string }[]>(
        "/admin/knowledge/publication/companies",
      ),
    [],
  );
  const companies = useKbData(loadCompanies);
  const [templateId, setTemplateId] = useState("");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [releaseNote, setReleaseNote] = useState("");
  const [check, setCheck] = useState<{
      allowed: boolean;
      reason: string;
      reviewers: string[];
    } | null>(null),
    [checking, setChecking] = useState(false),
    [checkVersion, setCheckVersion] = useState(0);
  const [busy, setBusy] = useState(false),
    [uploadBusy, setUploadBusy] = useState(false),
    [actionError, setActionError] = useState("");
  const confirm = useAdminConfirm(),
    lock = useRef(false);
  const template = data?.templates.find((t) => t.id === templateId);
  const p = data?.publication;
  const waiting = p?.status === "waiting";
  const lastState = useRef("");
  useEffect(() => {
    if (data?.templates.length === 1 && !templateId)
      setTemplateId(data.templates[0].id);
  }, [data, templateId]);
  useEffect(() => {
    if (!template || waiting) return;
    let cancelled = false;
    setChecking(true);
    setCheck(null);
    const timer = window.setTimeout(
      () =>
        void publicationApi<{
          allowed: boolean;
          reason: string;
          reviewers: string[];
        }>(
          `/admin/knowledge/documents/${encodeURIComponent(id)}/publication/check`,
          {
            templateId: template.id,
            templateVersion: template.version,
            values,
            releaseNote,
          },
        )
          .then((result) => {
            if (!cancelled) setCheck(result);
          })
          .catch((cause) => {
            if (!cancelled)
              setCheck({
                allowed: false,
                reason: errorMessage(cause),
                reviewers: [],
              });
          })
          .finally(() => {
            if (!cancelled) setChecking(false);
          }),
      300,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    id,
    template,
    waiting,
    values,
    releaseNote,
    checkVersion,
    publicationApi,
  ]);
  useEffect(() => {
    const state = p ? `${p.instanceId}:${p.status}` : "";
    if (lastState.current && lastState.current !== state) refreshDocument();
    lastState.current = state;
    if (!waiting || loading || error || busy || confirm.open) return;
    const timer = window.setTimeout(reload, 3000);
    return () => window.clearTimeout(timer);
  }, [
    p?.instanceId,
    p?.status,
    waiting,
    loading,
    error,
    busy,
    confirm.open,
    reload,
    refreshDocument,
  ]);
  const submit = async () => {
    if (lock.current || !template) return;
    lock.current = true;
    setBusy(true);
    setActionError("");
    const command: KnowledgePublicationCommand = {
      templateId: template.id,
      templateVersion: template.version,
      values: structuredClone(values),
      releaseNote,
    };
    try {
      const prepared = await publicationApi<{
        confirmationId: string;
        expiresAt: string;
        summary: {
          name: string;
          flow: string;
          version: number;
          reviewers: string[];
          consequence: string;
        };
      }>(
        `/admin/knowledge/documents/${encodeURIComponent(id)}/publication/prepare`,
        command,
      );
      const key = crypto.randomUUID();
      confirm.ask(
        {
          kind: "knowledge-document-publish",
          title: "确认提交知识发布审批",
          object: prepared.summary.name,
          scope: `${prepared.summary.flow} · 评审人：${prepared.summary.reviewers.join("、")}`,
          ruleVersion: `v${prepared.summary.version}`,
          change: releaseNote,
          consequence: prepared.summary.consequence,
          confirmLabel: "确认提交审批",
          confirmTone: "work",
        },
        async () => {
          const receipt = await publicationApi<{
            id: string;
            instanceId: string;
            tenant: string;
          }>(
            `/admin/knowledge/documents/${encodeURIComponent(id)}/publication/submit`,
            {
              command,
              confirmationId: prepared.confirmationId,
              idempotencyKey: key,
            },
          );
          notify(`已提交审批 · 回执 ${receipt.id}`);
          reload();
          refreshDocument();
        },
      );
    } catch (cause) {
      setActionError(errorMessage(cause));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const blocked =
    busy || confirm.open || loading || Boolean(error) || uploadBusy;
  const recover = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setActionError("");
    try {
      const r = await publicationApi<{ confirmationId: string; title: string }>(
          `/admin/knowledge/documents/${encodeURIComponent(id)}/publication/recovery/prepare`,
          {},
        ),
        key = crypto.randomUUID();
      confirm.ask(
        {
          kind: "knowledge-document-publish",
          title: "确认恢复发布",
          object: r.title,
          scope: "已通过审批的原资料版本",
          consequence:
            "重新提交服务端发布作业；再次核对材料与授权，成功后该资料参与员工检索。",
          confirmLabel: "确认恢复发布",
          confirmTone: "work",
        },
        async () => {
          const receipt = await publicationApi<{ id: string }>(
            `/admin/knowledge/documents/${encodeURIComponent(id)}/publication/recovery/submit`,
            { confirmationId: r.confirmationId, idempotencyKey: key },
          );
          notify(`已提交发布恢复 · 回执 ${receipt.id}`);
          reload();
        },
      );
    } catch (cause) {
      setActionError(errorMessage(cause));
    } finally {
      setBusy(false);
      lock.current = false;
    }
  };
  return (
    <section
      className="kbv-publication"
      aria-label="知识发布审批"
      aria-busy={busy || loading}
    >
      {confirm.dialog}
      {(companies.data?.length || 0) > 1 && (
        <label>
          当前组织
          <select
            value={company}
            disabled={busy || confirm.open || loading}
            onChange={(e) => {
              sessionStorage.setItem("review.company", e.target.value);
              setSearchParams(
                (previous) => {
                  const next = new URLSearchParams(previous);
                  if (e.target.value) next.set("reviewCompany", e.target.value);
                  else next.delete("reviewCompany");
                  return next;
                },
                { replace: true },
              );
              setCompany(e.target.value);
              setTemplateId("");
              setValues({});
              setCheck(null);
              setActionError("");
              reload();
            }}
          >
            <option value="">请选择组织</option>
            {companies.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {(error || actionError) && (
        <div className="kbv-document-notice" role="alert">
          <KbvIcon name="status" />
          <span>{error || actionError}</span>
          <button
            className="kbv-text-action"
            disabled={busy || loading || confirm.open}
            onClick={() => {
              setActionError("");
              reload();
            }}
          >
            重新检查
          </button>
        </div>
      )}
      {loading && !data && <p role="status">正在检查发布流程与组织配置…</p>}
      {p && (
        <div className="kbv-publication-state">
          <p role="status">
            {stateLabel[p.status === "waiting" ? p.reviewStatus : p.status] ||
              p.reviewStatus}
          </p>
          {(p.blockedReason || p.error || p.job?.error) && (
            <p role="alert">{p.blockedReason || p.error || p.job?.error}</p>
          )}
          <p>
            审批材料：{p.filename} · 版本 {p.fingerprint.slice(0, 12)}
          </p>
          {p.releaseNote && <p>发布说明：{p.releaseNote}</p>}
          {p.receipt && <p>回执 {p.receipt.id}</p>}
          {p.job && (
            <p>
              发布进度：{jobLabel[p.job.status] || p.job.status} · {p.job.id}
            </p>
          )}
          <Link
            className="kbv-link-plain"
            to={`/reviews/${encodeURIComponent(p.instanceId)}?reviewCompany=${encodeURIComponent(p.tenant)}`}
          >
            查看审批记录与处理入口 →
          </Link>
          {waiting &&
            p.reviewStatus === "approved" &&
            p.job &&
            ["failed", "uncertain", "cancelled"].includes(p.job.status) &&
            actionTarget &&
            createPortal(
              <button
                className={confirm.open ? "btn" : "btn work"}
                disabled={blocked}
                onClick={() => void recover()}
              >
                恢复发布
              </button>,
              actionTarget,
            )}
        </div>
      )}
      {data && !waiting && p?.status !== "published" && (
        <>
          {!data.intake.allowed && <p role="alert">{data.intake.reason}</p>}
          {!data.templates.length ? (
            <div className="kbv-document-notice" role="alert">
              <span>
                当前组织没有已发布的评审流程，请配置并发布知识发布审批流程后重新检查。
              </span>
              <Link to="/admin/approval-types">配置审批流程</Link>
            </div>
          ) : (
            <>
              <details className="kbv-publication-flow" open>
                <summary>
                  发布流程
                  {template
                    ? `：${template.definition.name} · v${template.version}`
                    : ""}
                </summary>
                <label>
                  审批流程
                  <select
                    value={templateId}
                    disabled={blocked}
                    onChange={(e) => {
                      setTemplateId(e.target.value);
                      setValues({});
                      setActionError("");
                    }}
                  >
                    <option value="">请选择已发布流程</option>
                    {data.templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.definition.name} · v{t.version}
                      </option>
                    ))}
                  </select>
                </label>
                {template && (
                  <ReviewForm
                    fields={template.definition.fields}
                    values={values}
                    onChange={setValues}
                    disabled={blocked}
                    onUploadBusy={setUploadBusy}
                  />
                )}
                <Link className="kbv-link-plain" to="/admin/approval-types">
                  查看流程配置
                </Link>
              </details>
              <label className="kbv-release-note">
                发布说明
                <textarea
                  maxLength={2000}
                  value={releaseNote}
                  disabled={blocked}
                  onChange={(e) => setReleaseNote(e.target.value)}
                  placeholder="说明本次发布内容与适用范围"
                />
              </label>
              {checking && <p role="status">正在检查评审人与材料版本…</p>}
              {check && !check.allowed && (
                <div className="kbv-document-notice" role="alert">
                  <KbvIcon name="status" />
                  <span>{check.reason}</span>
                  <button
                    className="kbv-text-action"
                    disabled={blocked || checking}
                    onClick={() => setCheckVersion((v) => v + 1)}
                  >
                    重新检查
                  </button>
                </div>
              )}
              {check?.allowed && (
                <p>当前评审人：{check.reviewers.join("、")}</p>
              )}
              {actionTarget &&
                createPortal(
                  <button
                    type="button"
                    className={confirm.open ? "btn" : "btn work"}
                    data-kbv-doc-action="submit"
                    data-risk="L3"
                    disabled={
                      blocked ||
                      checking ||
                      !check?.allowed ||
                      !template ||
                      !data.intake.allowed
                    }
                    onClick={() => void submit()}
                  >
                    {busy ? "检查中…" : "提交审批"}
                  </button>,
                  actionTarget,
                )}
            </>
          )}
        </>
      )}
      <p className="muted">
        保存、解析、提交审批和发布分别留痕；未发布版本不参与员工问答。
      </p>
    </section>
  );
}
