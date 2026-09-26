import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { useAdminConfirm } from "../../components/ConfirmDialog";
import { knowledgeArchiveConfirm } from "../../adminConfirm";
import {
  HIDE_REASONS,
  KB_ADMIN_ACTION,
  KB_ADMIN_EMPTY,
  formatKbTime,
  hideReasonLabel,
  kbFeedbackActionLabel,
  kbFeedbackReasonLabel,
} from "../../knowledgeCopy";
import { detailPath, useKbData, type KbFeed, textValue } from "./shared";

type FeedbackRow = {
  user_id: string;
  knowledge_id: string;
  title?: string;
  reason?: string;
  reason_note?: string;
  deprecated_at?: string;
  handled_at?: string;
  handled_by?: string;
  handle_action?: string;
  handle_note?: string;
};

function keyOf(row: FeedbackRow): string {
  return `${row.user_id}::${row.knowledge_id}`;
}

/** 反馈：员工反馈了什么、怎么处置？—— 未选中行时 0 个实底 CTA。 */
export default function FeedbackView({ notify, fail }: KbFeed) {
  const { ask, dialog } = useAdminConfirm();
  const load = useCallback(async () => api.adminKnowledgeFeedback() as Promise<FeedbackRow[]>, []);
  const { data, error, loading, reload } = useKbData(load);
  const [selected, setSelected] = useState<FeedbackRow | null>(null);
  const [note, setNote] = useState("");

  const rows = data || [];
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) {
      const reason = String(row.reason || "");
      map.set(reason, (map.get(reason) || 0) + 1);
    }
    return map;
  }, [rows]);
  const selectedKey = selected ? keyOf(selected) : "";

  const run = async (fn: () => Promise<unknown>, message: string) => {
    try {
      await fn();
      notify(message);
      setSelected(null);
      setNote("");
      reload();
    } catch (cause) {
      fail(cause);
    }
  };

  const handle = (action: "to_revision" | "ignore") => {
    if (!selected) return;
    const row = selected;
    void run(
      () => api.adminKnowledgeFeedbackHandle(row.knowledge_id, { user_id: row.user_id, action, note: note.trim() }),
      action === "to_revision"
        ? "已转修订：生成新草稿版本，仍需重新审批才生效。"
        : "已忽略并留档。",
    );
  };

  const archive = () => {
    if (!selected) return;
    const row = selected;
    ask(knowledgeArchiveConfirm(row.title || row.knowledge_id), () => run(
      async () => {
        await api.adminKnowledgeFeedbackHandle(row.knowledge_id, { user_id: row.user_id, action: "archive", note: note.trim() });
        return null;
      },
      "已归档并记入反馈处置。",
    ));
  };

  return (
    <>
      {dialog}
      {error && <p className="error" role="alert">{error}</p>}
      {loading && !data && <p className="muted" role="status">正在加载反馈…</p>}

      <article className="panel" data-admin-kb-feedback>
        <div className="admin-section-head">
          <div>
            <h2>反馈汇总</h2>
            <p className="muted">数字是本组织内隐藏该原因的次数（按账号计），不是拦截次数，也不改已发信。</p>
          </div>
          <span className="muted" role="status">共 {rows.length} 条</span>
        </div>
        <div className="kbadmin-reason-row">
          {HIDE_REASONS.map((reason) => (
            <span className="kbadmin-reason" key={reason.code} data-admin-kb-reason={reason.code}>
              <strong>{hideReasonLabel(reason.code)}</strong>
              <span className="muted">{counts.get(reason.code) || 0} 条</span>
            </span>
          ))}
          {!rows.length && <span className="muted">{KB_ADMIN_EMPTY.feedbackAggregate}</span>}
        </div>
        <p className="muted">
          原因明细里未识别的编码按原样显示；处置动作只有转修订 / 归档 / 忽略，不会让模型自动改主文档。
        </p>
      </article>

      <article className="panel" data-admin-kb-feedback-list>
        <div className="admin-section-head">
          <div>
            <h2>反馈明细</h2>
            <p className="muted">选中一条未处置的记录，在底部决定转修订、归档或忽略；已处置的不能重复处置。</p>
          </div>
        </div>
        {!rows.length && !loading ? <p className="muted">{KB_ADMIN_EMPTY.feedback}</p> : null}
        {rows.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table" data-admin-kb-feedback-table>
              <thead>
                <tr>
                  <th>选择</th>
                  <th>知识</th>
                  <th>账号</th>
                  <th>原因</th>
                  <th>反馈时间</th>
                  <th>处置</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const handled = Boolean(row.handled_at);
                  const key = keyOf(row);
                  return (
                    <tr
                      key={key}
                      className={selectedKey === key ? "is-selected" : undefined}
                      data-admin-kb-feedback-row={key}
                      data-admin-kb-feedback-handled={handled ? "1" : "0"}
                    >
                      <td>
                        {handled ? (
                          <span className="muted">已处置</span>
                        ) : (
                          <label className="kbadmin-pick">
                            <input
                              type="radio"
                              name="kb-feedback-pick"
                              checked={selectedKey === key}
                              data-admin-kb-feedback-pick={key}
                              onChange={() => {
                                setSelected(row);
                                setNote("");
                              }}
                            />
                            <span className="sr-only">{`选择 ${row.title || row.knowledge_id}`}</span>
                          </label>
                        )}
                      </td>
                      <td>
                        <Link className="kbadmin-title-link" to={detailPath(row.knowledge_id)}>
                          {row.title || row.knowledge_id}
                        </Link>
                        <p className="muted">{row.knowledge_id}</p>
                      </td>
                      <td>{row.user_id}</td>
                      <td>
                        {kbFeedbackReasonLabel(row.reason)}
                        {row.reason_note ? <p className="muted">备注：{row.reason_note}</p> : null}
                      </td>
                      <td>{formatKbTime(row.deprecated_at) || "—"}</td>
                      <td>
                        {handled ? (
                          <span className="kbadmin-handled" data-admin-kb-handled={key}>
                            {kbFeedbackActionLabel(row.handle_action)} · {row.handled_by || "—"} · {formatKbTime(row.handled_at) || "—"}
                            {row.handle_note ? ` · 备注：${row.handle_note}` : ""}
                          </span>
                        ) : (
                          <span className="muted">待处置</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </article>

      <article className="panel kbadmin-actionbar" data-admin-kb-feedback-actionbar>
        <div className="admin-section-head">
          <div>
            <h2>处置</h2>
            <p className="muted">
              {selected
                ? `选中：${selected.title || selected.knowledge_id} · ${selected.user_id}`
                : "先在明细里选中一条未处置的反馈。"}
            </p>
          </div>
        </div>
        <label className="field">处置备注（可空）
          <input
            value={note}
            data-admin-kb-feedback-note
            disabled={!selected}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <div className="admin-actions">
          <button
            className={selected ? "btn work" : "btn ghost"}
            type="button"
            data-admin-kb-feedback-revision
            disabled={!selected}
            onClick={() => handle("to_revision")}
          >
            {KB_ADMIN_ACTION.toRevision}
          </button>
          <button className="btn ghost" type="button" data-admin-kb-feedback-archive disabled={!selected} onClick={archive}>
            {KB_ADMIN_ACTION.archive}
          </button>
          <button
            className="btn ghost"
            type="button"
            data-admin-kb-feedback-ignore
            disabled={!selected}
            onClick={() => handle("ignore")}
          >
            {KB_ADMIN_ACTION.ignore}
          </button>
        </div>
        <p className="muted admin-note">
          转修订会生成新草稿版本（仍需审批）；归档会从解析与员工面移除；忽略只留档。
          {textValue(selected?.handle_note) ? ` 上次备注：${textValue(selected?.handle_note)}` : ""}
        </p>
      </article>
    </>
  );
}
