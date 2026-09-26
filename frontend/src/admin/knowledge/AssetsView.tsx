import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { knowledgeArchiveConfirm } from "../../adminConfirm";
import { useAdminConfirm } from "../../components/ConfirmDialog";
import {
  KB_ADMIN_ACTION,
  KB_ADMIN_EMPTY,
  brandLabel,
  formatKbTime,
  kindLabel,
  statusLabel,
} from "../../knowledgeCopy";
import {
  KB_BRANDS,
  KB_KINDS,
  KB_LANGS,
  KB_STATUSES,
  detailPath,
  kbScopeLine,
  kbSkillNames,
  useKbData,
  type KbAssetRow,
  type KbFeed,
} from "./shared";

/** 资产：有哪些资产、什么状态、被谁用？ */
export default function AssetsView({ notify, fail }: KbFeed) {
  const { ask, dialog } = useAdminConfirm();
  const load = useCallback(async () => api.adminKnowledgeAssets() as Promise<KbAssetRow[]>, []);
  const { data, error, loading, reload } = useKbData(load);
  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState("all");
  const [brand, setBrand] = useState("all");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  const run = async (fn: () => Promise<unknown>, message: string) => {
    try {
      await fn();
      notify(message);
      reload();
    } catch (cause) {
      fail(cause);
    }
  };

  const rows = data || [];
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (kind !== "all" && (row.kind || "policy") !== kind) return false;
      if (status !== "all" && (row.status || "draft") !== status) return false;
      if (brand !== "all" && (row.brand || "*") !== brand) return false;
      if (!needle) return true;
      return [row.title, row.subject, row.body, row.tags, row.id]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [rows, kind, status, brand, query]);

  return (
    <>
      {dialog}
      {error && <p className="error" role="alert">{error}</p>}
      {loading && !data && <p className="muted" role="status">正在加载资产…</p>}

      <article className="panel" data-admin-knowledge-assets>
        <div className="admin-section-head">
          <div>
            <h2>资产目录</h2>
            <p className="muted">「引用」列是当前启用绑定会解析到这份知识的技能；点标题进详情治理。</p>
          </div>
          <button
            className={creating ? "btn ghost" : "btn work"}
            type="button"
            aria-expanded={creating}
            data-admin-kb-create-toggle
            onClick={() => setCreating((value) => !value)}
          >
            {creating ? "收起新建" : KB_ADMIN_ACTION.createDraft}
          </button>
        </div>

        {creating ? (
          <form
            className="settings-form kbadmin-form"
            data-admin-kb-create
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const stageCodes = String(form.get("stage_codes") || "")
                .split(/[\s,，、]+/)
                .map((code) => code.trim())
                .filter(Boolean);
              void run(
                () => api.createKnowledge({
                  title: String(form.get("title") || "").trim(),
                  kind: String(form.get("kind") || "policy"),
                  brand: String(form.get("brand") || "*"),
                  lang: String(form.get("lang") || "en"),
                  subject: String(form.get("subject") || ""),
                  body: String(form.get("body") || ""),
                  body_en: String(form.get("body_en") || ""),
                  stage_codes: stageCodes,
                  tags: String(form.get("tags") || ""),
                  status: "draft",
                }).then(() => setCreating(false)),
                "草稿已创建，尚未发布；审批后才对员工生效。",
              );
            }}
          >
            <h3 className="kb-subhead">新建知识（写草稿）</h3>
            <div className="kbadmin-form-grid">
              <label className="field">标题<input name="title" required /></label>
              <label className="field">类型
                <select name="kind" defaultValue="policy">
                  {KB_KINDS.map((value) => <option key={value} value={value}>{kindLabel(value)}</option>)}
                </select>
              </label>
              <label className="field">品牌
                <select name="brand" defaultValue="*">
                  <option value="*">全品牌</option>
                  {KB_BRANDS.map((value) => <option key={value} value={value}>{brandLabel(value)}</option>)}
                </select>
              </label>
              <label className="field">语言
                <select name="lang" defaultValue="en">
                  {KB_LANGS.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <label className="field">主题<input name="subject" /></label>
              <label className="field">标签（逗号分隔）<input name="tags" placeholder="email_compose,policy" /></label>
            </div>
            <label className="field">正文<textarea name="body" rows={3} /></label>
            <label className="field">英文正文<textarea name="body_en" rows={3} /></label>
            <label className="field">适用阶段（填阶段代码，空格分隔）<input name="stage_codes" placeholder="INITIAL_CONTACT INTERESTED" /></label>
            <p className="muted">保存后是草稿：不出现在员工知识库，也不参与运行时解析。</p>
            <button className="btn work" data-admin-kb-create-submit>{KB_ADMIN_ACTION.saveDraft}</button>
          </form>
        ) : null}

        <div className="kbadmin-toolbar">
          <label className="field">类型
            <select value={kind} onChange={(event) => setKind(event.target.value)} data-admin-kb-filter="kind">
              <option value="all">全部类型</option>
              {KB_KINDS.map((value) => <option key={value} value={value}>{kindLabel(value)}</option>)}
            </select>
          </label>
          <label className="field">状态
            <select value={status} onChange={(event) => setStatus(event.target.value)} data-admin-kb-filter="status">
              <option value="all">全部状态</option>
              {KB_STATUSES.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
            </select>
          </label>
          <label className="field">品牌
            <select value={brand} onChange={(event) => setBrand(event.target.value)} data-admin-kb-filter="brand">
              <option value="all">全部品牌</option>
              <option value="*">全品牌</option>
              {KB_BRANDS.map((value) => <option key={value} value={value}>{brandLabel(value)}</option>)}
            </select>
          </label>
          <label className="field">搜索
            <input
              type="search"
              value={query}
              placeholder="标题、正文、标签"
              data-admin-kb-filter="query"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <p className="muted kbadmin-filter-count" role="status">
            显示 {filtered.length} / {rows.length} 条
          </p>
        </div>

        {rows.length && !filtered.length ? <p className="muted">{KB_ADMIN_EMPTY.assetsFiltered}</p> : null}
        {!rows.length && !loading ? <p className="muted">{KB_ADMIN_EMPTY.assets}</p> : null}

        {filtered.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table" data-admin-kb-assets-table>
              <thead>
                <tr>
                  <th>标题</th>
                  <th>类型</th>
                  <th>状态</th>
                  <th>版本</th>
                  <th>适用</th>
                  <th>引用技能</th>
                  <th>更新</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const refs = kbSkillNames(row.ref_skills);
                  return (
                    <tr key={row.id} data-admin-knowledge-id={row.id} data-admin-kb-status={row.status || "draft"}>
                      <td>
                        <Link className="kbadmin-title-link" to={detailPath(row.id)}>{row.title}</Link>
                        <p className="muted">{row.id}</p>
                      </td>
                      <td>{kindLabel(row.kind)}</td>
                      <td>{statusLabel(row.status)}</td>
                      <td>第 {row.current_version || 1} 版</td>
                      <td>{kbScopeLine(row)}</td>
                      <td>
                        {refs.length ? (
                          <details className="kbadmin-refs" title={refs.join("、")}>
                            <summary data-admin-kb-ref-count={refs.length}>{refs.length} 个技能</summary>
                            <ul>{refs.map((name) => <li key={name}>{name}</li>)}</ul>
                          </details>
                        ) : (
                          <span className="muted" data-admin-kb-ref-count="0">0 个技能</span>
                        )}
                      </td>
                      <td>{formatKbTime(row.updated_at) || "—"}</td>
                      <td>
                        <div className="kbadmin-row-actions">
                          <Link className="kbadmin-action-link" to={detailPath(row.id)}>{KB_ADMIN_ACTION.viewDetail}</Link>
                          {row.status === "published" ? (
                            <button
                              className="kbadmin-action-link kbadmin-action-danger"
                              type="button"
                              data-kb-archive={row.id}
                              onClick={() => ask(
                                knowledgeArchiveConfirm(row.title, Number(row.current_version || 1)),
                                () => run(() => api.archiveKnowledge(row.id), "已归档：新的运行不再解析到这份知识。"),
                              )}
                            >
                              {KB_ADMIN_ACTION.archive}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </article>
    </>
  );
}
