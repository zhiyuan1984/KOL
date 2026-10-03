import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { knowledgeArchiveConfirm, knowledgeHardDeleteConfirm, knowledgePublishConfirm } from "../../adminConfirm";
import { useAdminConfirm } from "../../components/ConfirmDialog";
import { formatKbTime, kbBaseKindLabel, kindLabel, statusLabel, versionLine } from "../../knowledgeCopy";
import KbvIcon from "../../knowledgeIcons";
import { errorStatus, kbScopeLine, structuredDisplay, textValue, useKbData, type KbAssetRow, type Row } from "./shared";

type VersionRow = Row & { version?: number };
type Props = {
  row: KbAssetRow;
  path: string;
  baseKind?: string;
  notify: (message: string) => void;
  fail: (cause: unknown, fallback?: string) => void;
  reload: () => void;
};

/** 管理端详情：标题和状态、正文、属性范围、来源版本依序呈现；正文区域独立滚动。 */
export default function DetailRail({ row, path, baseKind, notify, fail, reload }: Props) {
  const { ask, dialog } = useAdminConfirm();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDialogElement>(null);
  const load = useCallback(
    async () => ({ versions: (await api.knowledgeVersions(row.id).catch(() => [])) as VersionRow[] }),
    [row.id],
  );
  const { data, loading } = useKbData(load);
  const versions = data?.versions || [];

  useEffect(() => {
    const el = moreRef.current;
    if (!el) return;
    if (moreOpen && !el.open) el.showModal();
    if (!moreOpen && el.open) el.close();
  }, [moreOpen]);

  const status = String(row.status || "draft");
  const version = Number(row.current_version || 1);
  const needsApproval = status === "pending_review";
  const isDraft = status === "draft";
  const isPublished = status === "published";
  const entryPath = `/admin/knowledge/entries/${encodeURIComponent(row.id)}`;
  const fields = structuredDisplay(row.kind, row.structured).filter((field) => field.value !== String(row.body || "").trim());
  const scope = kbScopeLine(row);
  const statusClass = status === "published"
    ? "is-published"
    : status === "pending_review"
      ? "is-pending"
      : status === "archived"
        ? "is-disabled"
        : "is-draft";

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
  const closeMore = () => {
    moreRef.current?.close();
    setMoreOpen(false);
  };

  return (
    <>
      {dialog}
      <div className="kbv-rail-head">
        <div className="kbv-title-row">
          <h2>{row.title}</h2>
          <span className={`kbv-status ${statusClass}`} data-kbv-status={status}>{statusLabel(status)}</span>
        </div>
      </div>

      <div className="kbv-rail-body">
        {needsApproval ? (
          <div className="kbv-notice" data-kbv-approval-hint>
            <strong>此版本正在审批中</strong>
            <Link className="kbv-link-plain" to="/approvals">前往审批 →</Link>
          </div>
        ) : null}

        <section>
          <h3>正文</h3>
          {fields.length ? (
            <dl className="kbv-properties kbv-content-fields">
              {fields.map((field) => <div key={field.key}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}
            </dl>
          ) : null}
          {String(row.body || "").trim() ? <p className="kbv-body">{String(row.body)}</p> : <p className="muted">暂无正文内容。</p>}
        </section>

        <section>
          <h3>属性与范围</h3>
          <dl className="kbv-properties">
            <div><dt>知识标识</dt><dd>{row.id}</dd></div>
            <div><dt>知识类型</dt><dd>{kindLabel(row.kind)}</dd></div>
            {path ? <div><dt>分类</dt><dd>{path}</dd></div> : null}
            {scope ? <div><dt>适用范围</dt><dd>{scope}</dd></div> : null}
            {baseKind ? <div><dt>内容模型</dt><dd>{kbBaseKindLabel(baseKind)}</dd></div> : null}
            {row.created_by ? <div><dt>维护责任人</dt><dd>{row.created_by}</dd></div> : null}
            {row.expires_at ? <div><dt>到期</dt><dd>{formatKbTime(row.expires_at)}</dd></div> : null}
          </dl>
        </section>

        <section data-kbv-provenance>
          <h3>来源与版本</h3>
          <dl className="kbv-properties">
            <div><dt>来源</dt><dd>{row.base_name || (row.created_by ? `${row.created_by} 维护` : "在线编辑")}</dd></div>
            <div><dt>当前版本</dt><dd>第 {version} 版</dd></div>
            {row.updated_at ? <div><dt>更新时间</dt><dd>{formatKbTime(row.updated_at)}</dd></div> : null}
            {row.approved_at ? <div><dt>审批</dt><dd>{textValue((row as unknown as Row).approved_by) || "—"} · {formatKbTime(row.approved_at)}</dd></div> : null}
          </dl>
          {loading && !data ? <p className="muted" role="status">正在加载版本记录…</p> : null}
          {!loading && versions.length ? (
            <div className="kbv-version-list">
              {versions.map((item) => {
                const number = Number(item.version || 0);
                return <p className="kbv-version" key={String(item.id || number)} data-kbv-version={number}>第 {number} 版{number === version ? "（当前）" : ""} · {versionLine(item)}</p>;
              })}
            </div>
          ) : null}
        </section>
      </div>

      <footer className="kbv-rail-foot">
        <div className="kbv-actions">
          {needsApproval ? (
            <>
              <Link className="btn" data-kbv-action="goto-approval" to="/approvals">前往审批 ↗</Link>
              <Link className="btn" data-kbv-action="edit" to={entryPath}>修订</Link>
              <button type="button" className="btn" data-kbv-action="approve" onClick={() => ask(knowledgePublishConfirm(row.title, version), approve)}>审核</button>
            </>
          ) : null}
          {isDraft ? (
            <>
              <Link className="btn" data-kbv-action="edit" to={entryPath}>修订</Link>
              <button type="button" className="btn danger" data-kbv-action="delete" onClick={() => ask(knowledgeHardDeleteConfirm(row.title), () => run(() => api.deleteKnowledge(row.id), "草稿已删除。"))}>删除草稿</button>
            </>
          ) : null}
          {(isPublished || status === "archived") ? (
            <>
              <Link className="btn" data-kbv-action="edit" to={entryPath}>修订</Link>
              <button type="button" className="btn" data-kbv-action="more" aria-expanded={moreOpen} onClick={() => setMoreOpen(true)}>更多 ▾</button>
            </>
          ) : null}
        </div>
      </footer>

      <dialog ref={moreRef} className="kbv-dialog" data-kbv-more-dialog onClose={() => setMoreOpen(false)} onClick={(event) => { if (event.target === moreRef.current) closeMore(); }}>
        <div className="kbv-dialog-head">
          <h2>知识维护</h2>
          <button type="button" className="btn ghost" aria-label="关闭" onClick={closeMore}><KbvIcon name="close" /></button>
        </div>
        <div className="kbv-dialog-body">
          <Link className="btn" data-kbv-action="versions" to={entryPath} onClick={closeMore}>查看版本记录</Link>
          <Link className="btn" data-kbv-action="scope" to={entryPath} onClick={closeMore}>调整适用范围</Link>
          <button
            type="button"
            className="btn danger"
            data-kbv-action="archive"
            disabled={!isPublished}
            title={isPublished ? undefined : "仅已发布版本可停用"}
            onClick={() => { closeMore(); ask(knowledgeArchiveConfirm(row.title, version), () => run(() => api.archiveKnowledge(row.id), "已停用：新的运行不再解析到这份知识。")); }}
          >
            停用已发布版本
          </button>
        </div>
      </dialog>
    </>
  );
}
