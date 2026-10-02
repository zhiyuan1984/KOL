import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import {
  knowledgeArchiveConfirm,
  knowledgeHardDeleteConfirm,
  knowledgePublishConfirm,
} from "../../adminConfirm";
import { useAdminConfirm } from "../../components/ConfirmDialog";
import { formatKbTime, kbBaseKindLabel, kindLabel, statusLabel, versionLine } from "../../knowledgeCopy";
import KbvIcon from "../../knowledgeIcons";
import {
  errorStatus,
  structuredDisplay,
  textValue,
  useKbData,
  type KbAssetRow,
  type Row,
} from "./shared";
import PhaseNotice from "./PhaseNotice";

type VersionRow = Row & { version?: number };
type RailTab = "content" | "props" | "versions";
type Notice = { title: string; body: string; legacyHref?: string; legacyLabel?: string };

const TABS: Array<{ key: RailTab; label: string }> = [
  { key: "content", label: "内容" },
  { key: "props", label: "属性与范围" },
  { key: "versions", label: "版本记录" },
];

type Props = {
  row: KbAssetRow;
  path: string;
  baseKind?: string;
  notify: (message: string) => void;
  fail: (cause: unknown, fallback?: string) => void;
  reload: () => void;
};

/** 管理端右栏：内容 / 属性与范围 / 版本记录＋按状态唯一主 CTA（IA v2，P1）。
 *  发布决断将在 P3 迁入审批系统；过渡期保留就地「审核」（同一 API 与回执口径）。 */
export default function DetailRail({ row, path, baseKind, notify, fail, reload }: Props) {
  const { ask, dialog } = useAdminConfirm();
  const [tab, setTab] = useState<RailTab>("content");
  const [phase, setPhase] = useState<Notice | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = moreRef.current;
    if (!el) return;
    if (moreOpen && !el.open) el.showModal();
    if (!moreOpen && el.open) el.close();
  }, [moreOpen]);

  const load = useCallback(
    async () => ({ versions: (await api.knowledgeVersions(row.id).catch(() => [])) as VersionRow[] }),
    [row.id],
  );
  const { data, loading } = useKbData(load);
  const versions = data?.versions || [];

  const status = String(row.status || "draft");
  const version = Number(row.current_version || 1);
  const needsApproval = status === "pending_review";
  const isDraft = status === "draft";
  const isPublished = status === "published";

  const run = async (fn: () => Promise<unknown>, message: string) => {
    try {
      await fn();
      notify(message);
      reload();
    } catch (cause) {
      fail(cause);
    }
  };

  const approve = async () => {
    try {
      await api.approveKnowledge(row.id, version);
      notify("已审批发布，员工可见性按下一次解析生效。");
      reload();
    } catch (cause) {
      if (errorStatus(cause) === 409) {
        reload();
        fail(new Error("内容已变，请刷新后重新审核"));
        return;
      }
      fail(cause);
    }
  };

  const editNotice: Notice = {
    title: "修订 · P2 接入",
    body: "修订（写入新版本草稿）将在 P2 接入本页；过渡期请使用旧版条目视图完成编辑。",
    legacyHref: `/admin/knowledge/entries/${encodeURIComponent(row.id)}`,
    legacyLabel: "打开旧版条目视图（迁移中）",
  };
  const submitNotice: Notice = {
    title: "提交审批 · P2 接入",
    body: "「提交审批」受理侧（创建审批单）将在 P2/P3 接入；过渡期可继续在旧版条目视图提交。",
    legacyHref: `/admin/knowledge/entries/${encodeURIComponent(row.id)}`,
    legacyLabel: "打开旧版条目视图（迁移中）",
  };
  const approvalNotice: Notice = {
    title: "前往审批 · P3 接入",
    body: "知识发布审批将接入平台审批系统（方案 B：/approvals 审批单、审批链与回执）；接入前请使用「审核」就地处理。",
    legacyHref: "/approvals",
    legacyLabel: "打开平台审批列表",
  };
  const scopeNotice: Notice = {
    title: "调整适用范围 · P2 接入",
    body: "范围调整将在 P2 接入本页；过渡期请使用旧版条目视图修改。",
    legacyHref: `/admin/knowledge/entries/${encodeURIComponent(row.id)}`,
    legacyLabel: "打开旧版条目视图（迁移中）",
  };

  const closeMore = () => {
    moreRef.current?.close();
    setMoreOpen(false);
  };

  const statusClass = status === "published"
    ? "is-published"
    : status === "pending_review"
      ? "is-pending"
      : status === "archived"
        ? "is-disabled"
        : "is-draft";
  const symbol = status === "published" ? "✓ " : status === "pending_review" ? "◷ " : "";
  const fields = structuredDisplay(row.kind, row.structured);

  return (
    <>
      {dialog}
      <PhaseNotice
        open={Boolean(phase)}
        title={phase?.title || ""}
        body={phase?.body || ""}
        legacyHref={phase?.legacyHref}
        legacyLabel={phase?.legacyLabel}
        onClose={() => setPhase(null)}
      />

      <div className="kbv-rail-head">
        <div className="kbv-crumb">{path || "未分类"}</div>
        <div className="kbv-title-row">
          <h2>{row.title}</h2>
        </div>
        <div className="kbv-subtitle">
          <span className={"kbv-status " + statusClass} data-kbv-status={status}>{symbol}{statusLabel(status)}</span>
          <span>第 {version} 版</span>
          <span>
            {row.created_by || "—"}
            {row.updated_at ? ` · ${formatKbTime(row.updated_at)}` : ""}
          </span>
        </div>
      </div>

      <div className="kbv-tabs kbv-rail-tabs" role="group" aria-label="详情视图">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            className="kbv-tab"
            aria-pressed={tab === item.key}
            data-kbv-detail-tab={item.key}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="kbv-rail-body">
        {tab === "content" ? (
          <>
            {needsApproval ? (
              <div className="kbv-notice" data-kbv-approval-hint>
                <strong>此版本正在审批中</strong>
                <button type="button" className="kbv-link-plain" onClick={() => setPhase(approvalNotice)}>
                  查看审批（P3 接入）→
                </button>
              </div>
            ) : null}
            {fields.length ? (
              <section>
                <h3>结构化字段</h3>
                <dl className="kbv-properties">
                  {fields.map((field) => (
                    <div key={field.key}>
                      <dt>{field.label}</dt>
                      <dd>{field.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ) : null}
            <section>
              <h3>正文</h3>
              {String(row.body || "").trim() ? (
                <p className="kbv-body">{String(row.body)}</p>
              ) : (
                <p className="muted">暂无正文内容。</p>
              )}
            </section>
            <section>
              <h3>来源材料</h3>
              <p className="muted">
                {row.base_name ? `${row.base_name} · ` : ""}
                {row.created_by || "—"} 维护
                {row.created_at ? ` · 编制于 ${formatKbTime(row.created_at)}` : ""}
              </p>
            </section>
          </>
        ) : null}

        {tab === "props" ? (
          <>
            <dl className="kbv-properties">
              <div><dt>知识标识</dt><dd>{row.id}</dd></div>
              <div><dt>领域 / 主题</dt><dd>{path || "未分类"}</dd></div>
              <div><dt>知识类型</dt><dd>{kindLabel(row.kind)}</dd></div>
              <div><dt>内容模型</dt><dd>{baseKind ? kbBaseKindLabel(baseKind) : "—"}</dd></div>
              <div><dt>状态</dt><dd>{statusLabel(status)} · 第 {version} 版</dd></div>
              <div><dt>维护责任人</dt><dd>{row.created_by || "—"}</dd></div>
              <div>
                <dt>审批</dt>
                <dd>
                  {row.approved_at
                    ? `${textValue((row as unknown as Row).approved_by) || "—"} · ${formatKbTime(row.approved_at)}`
                    : "尚未审批"}
                </dd>
              </div>
              {row.expires_at ? <div><dt>到期</dt><dd>{formatKbTime(row.expires_at)}</dd></div> : null}
              <div><dt>更新时间</dt><dd>{row.updated_at ? formatKbTime(row.updated_at) : "—"}</dd></div>
            </dl>
            <p className="muted">
              完整治理信息（范围授权 / 引用列表 / 审计）在
              <Link className="kbv-link-plain" to={`/admin/knowledge/entries/${encodeURIComponent(row.id)}`}>
                旧版条目视图（迁移中）
              </Link>
              。
            </p>
          </>
        ) : null}

        {tab === "versions" ? (
          <>
            {loading && !data ? <p className="muted" role="status">正在加载版本记录…</p> : null}
            {!loading && versions.length === 0 ? <p className="muted">暂无版本记录。</p> : null}
            {versions.map((item) => {
              const number = Number(item.version || 0);
              return (
                <div className="kbv-version" key={String(item.id || number)} data-kbv-version={number}>
                  <h3>第 {number} 版{number === version ? "（当前）" : ""}</h3>
                  <p className="muted">{versionLine(item)}</p>
                </div>
              );
            })}
            <p className="muted">
              版本对比与回滚在
              <Link className="kbv-link-plain" to={`/admin/knowledge/entries/${encodeURIComponent(row.id)}`}>
                旧版条目视图（迁移中）
              </Link>
              提供。
            </p>
          </>
        ) : null}
      </div>

      <footer className="kbv-rail-foot">
        <small className="muted">
          {needsApproval
            ? "审批系统接入中（P3）；过渡期可就地审核。"
            : isDraft
              ? "提交审批将在 P2 接入。"
              : "操作保留确认与回执。"}
        </small>
        <div className="kbv-actions">
          {needsApproval ? (
            <>
              <button type="button" className="btn" data-kbv-action="goto-approval" onClick={() => setPhase(approvalNotice)}>
                前往审批 ↗
              </button>
              <button type="button" className="btn" data-kbv-action="edit" onClick={() => setPhase(editNotice)}>修订</button>
              <button
                type="button"
                className="btn work"
                data-kbv-action="approve"
                onClick={() => ask(knowledgePublishConfirm(row.title, version), approve)}
              >
                审核
              </button>
            </>
          ) : null}
          {isDraft ? (
            <>
              <button type="button" className="btn" data-kbv-action="edit" onClick={() => setPhase(editNotice)}>修订</button>
              <button
                type="button"
                className="btn danger"
                data-kbv-action="delete"
                onClick={() => ask(
                  knowledgeHardDeleteConfirm(row.title),
                  () => run(() => api.deleteKnowledge(row.id), "草稿已删除。"),
                )}
              >
                删除草稿
              </button>
              <button type="button" className="btn work" data-kbv-action="submit" onClick={() => setPhase(submitNotice)}>提交审批</button>
            </>
          ) : null}
          {(isPublished || status === "archived") ? (
            <>
              <button type="button" className="btn" data-kbv-action="edit" onClick={() => setPhase(editNotice)}>修订</button>
              <button type="button" className="btn" data-kbv-action="more" aria-expanded={moreOpen} onClick={() => setMoreOpen(true)}>
                更多 ▾
              </button>
            </>
          ) : null}
        </div>
      </footer>

      <dialog
        ref={moreRef}
        className="kbv-dialog"
        data-kbv-more-dialog
        onClose={() => setMoreOpen(false)}
        onClick={(event) => {
          if (event.target === moreRef.current) closeMore();
        }}
      >
        <div className="kbv-dialog-head">
          <h2>知识维护</h2>
          <button type="button" className="btn ghost" aria-label="关闭" onClick={closeMore}>
            <KbvIcon name="close" />
          </button>
        </div>
        <div className="kbv-dialog-body">
          <button type="button" className="btn" data-kbv-action="versions" onClick={() => { closeMore(); setTab("versions"); }}>
            查看版本记录
          </button>
          <button type="button" className="btn" data-kbv-action="scope" onClick={() => { closeMore(); setPhase(scopeNotice); }}>
            调整适用范围（P2 接入）
          </button>
          <button
            type="button"
            className="btn danger"
            data-kbv-action="archive"
            disabled={!isPublished}
            title={isPublished ? undefined : "仅已发布版本可停用"}
            onClick={() => {
              closeMore();
              ask(
                knowledgeArchiveConfirm(row.title, version),
                () => run(() => api.archiveKnowledge(row.id), "已停用：新的运行不再解析到这份知识。"),
              );
            }}
          >
            停用已发布版本
          </button>
          <p className="muted">正式写入前需再次确认并保留审计回执。</p>
        </div>
      </dialog>
    </>
  );
}
