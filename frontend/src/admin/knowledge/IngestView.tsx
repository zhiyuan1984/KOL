import { useCallback } from "react";
import { api } from "../../api";
import {
  KB_ADMIN_ACTION,
  KB_ADMIN_EMPTY,
  formatKbTime,
  jobStatusLabel,
} from "../../knowledgeCopy";
import { useKbData, type KbFeed, type Row, textValue } from "./shared";

/** 入库：素材入库与提取成败？—— 失败可重试，终态如实展示。 */
export default function IngestView({ notify, fail }: KbFeed) {
  const load = useCallback(async () => {
    const [raw, jobs] = await Promise.all([
      api.adminKnowledgeRaw(),
      api.adminKnowledgeJobs(),
    ]);
    return { raw, jobs };
  }, []);
  const { data, error, loading, reload } = useKbData(load);

  const run = async (fn: () => Promise<unknown>, message: string) => {
    try {
      await fn();
      notify(message);
      reload();
    } catch (cause) {
      fail(cause);
    }
  };

  const raw = data?.raw || [];
  const jobs = data?.jobs || [];
  const rawName = (id: string) => {
    const hit = raw.find((item) => String(item.id) === id);
    return hit ? textValue(hit.filename || hit.source) || id : id;
  };

  return (
    <>
      {error && <p className="error" role="alert">{error}</p>}
      {loading && !data && <p className="muted" role="status">正在加载入库数据…</p>}

      <article className="panel" data-admin-knowledge-ingest>
        <div className="admin-section-head">
          <div>
            <h2>素材入库</h2>
            <p className="muted">上传只写原文库；原文不上线，抽取只生成待审草稿。支持 md / txt / eml / pdf / docx。</p>
          </div>
          <label className="btn work kbadmin-upload" data-admin-kb-upload>
            <span>{KB_ADMIN_ACTION.upload}</span>
            <input
              className="sr-only"
              type="file"
              accept=".md,.txt,.eml,.pdf,.docx"
              data-kb-upload
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void run(() => api.uploadKnowledgeRaw(file), "已写入原文库，尚未抽取。");
                event.currentTarget.value = "";
              }}
            />
          </label>
        </div>

        <h3 className="kb-subhead">原文库</h3>
        {raw.map((item: Row) => (
          <article className="admin-row" key={String(item.id)} data-admin-kb-raw={String(item.id)}>
            <div>
              <strong>{textValue(item.filename || item.source) || String(item.id)}</strong>
              <p className="muted">
                {textValue(item.source) || "上传"} · {formatKbTime(textValue(item.created_at)) || "—"}
                {textValue(item.uploaded_by) ? ` · ${textValue(item.uploaded_by)}` : ""}
              </p>
            </div>
            <button
              className="kbadmin-action-link"
              type="button"
              data-admin-kb-extract={String(item.id)}
              onClick={() => void run(
                () => api.extractKnowledge(String(item.id)),
                "已抽取为待审草稿，未发布。",
              )}
            >
              {KB_ADMIN_ACTION.extract}
            </button>
          </article>
        ))}
        {!raw.length && !loading ? <p className="muted">{KB_ADMIN_EMPTY.ingestRaw}</p> : null}
      </article>

      <article className="panel" data-admin-kb-jobs>
        <div className="admin-section-head">
          <div>
            <h2>提取作业</h2>
            <p className="muted">状态按服务端真实终态展示；失败可以重试同一份原文，不会伪造完成。</p>
          </div>
          <span className="muted" role="status">{jobs.length} 个作业</span>
        </div>
        {jobs.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table" data-admin-kb-jobs-table>
              <thead>
                <tr>
                  <th>原文</th>
                  <th>状态</th>
                  <th>结果</th>
                  <th>时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job: Row) => {
                  const status = String(job.status || "");
                  const failed = status === "failed";
                  return (
                    <tr key={String(job.id)} data-admin-kb-job={String(job.id)}>
                      <td>{rawName(String(job.raw_id || ""))}</td>
                      <td>{jobStatusLabel(status) || status || "—"}</td>
                      <td>
                        {job.result_knowledge_id
                          ? `已生成待审页 ${String(job.result_knowledge_id)}`
                          : textValue(job.error) || (failed ? "抽取失败" : "等待结果")}
                      </td>
                      <td>{formatKbTime(textValue(job.created_at)) || "—"}</td>
                      <td>
                        {failed && job.raw_id ? (
                          <button
                            className="kbadmin-action-link"
                            type="button"
                            data-admin-kb-retry={String(job.raw_id)}
                            onClick={() => void run(
                              () => api.extractKnowledge(String(job.raw_id)),
                              "已重新提交抽取，仍会生成待审草稿。",
                            )}
                          >
                            {KB_ADMIN_ACTION.retry}
                          </button>
                        ) : (
                          <span className="muted">{job.result_knowledge_id ? "已入待审" : "无需操作"}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">{KB_ADMIN_EMPTY.ingestJobs}</p>
        )}
      </article>
    </>
  );
}
