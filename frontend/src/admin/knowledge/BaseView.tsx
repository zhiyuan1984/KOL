import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { knowledgeArchiveConfirm, knowledgeHardDeleteConfirm } from "../../adminConfirm";
import { useAdminConfirm } from "../../components/ConfirmDialog";
import { KB_ADMIN_ACTION, KB_ADMIN_EMPTY, KB_UNSTRUCTURED_P1_NOTE, brandLabel, formatKbTime, kbBaseKindLabel, kindLabel, statusLabel } from "../../knowledgeCopy";
import StructuredFields from "./StructuredFields";
import UnstructuredBasePanel from "./UnstructuredBasePanel";
import {
  KB_BRANDS,
  KB_LANGS,
  KB_STATUSES,
  entryPath,
  kbScopeLine,
  kbSkillNames,
  kindAllowedInBase,
  kindFields,
  KNOWLEDGE_KIND_SPECS,
  splitList,
  structuredErrorList,
  structuredPayload,
  useKbData,
  type KbAssetRow,
  type KbFeed,
} from "./shared";

/** 库详情：这个库里有哪些条目、什么状态？—— 唯一实底 CTA 是「新建条目」。 */
/** §9.1 空单元格占位：渲染 — 并降到 --text-quiet，不留白格。 */
const emptyCell = <span className="kb-cell-empty">—</span>;

export default function BaseView({ id, notify, fail }: KbFeed & { id: string }) {
  const { ask, dialog } = useAdminConfirm();
  const load = useCallback(async () => {
    const [bases, rows, assets] = await Promise.all([
      api.adminKnowledgeBases(),
      id ? api.adminKnowledge({ base: id }) : Promise.resolve([]),
      api.adminKnowledgeAssets().catch(() => [] as KbAssetRow[]),
    ]);
    return {
      base: bases.bases.find((item) => item.id === id) || null,
      rows: rows as KbAssetRow[],
      assets: assets as KbAssetRow[],
    };
  }, [id]);
  const { data, error, loading, reload } = useKbData(load, [id]);

  const [kind, setKind] = useState("policy");
  const [filterKind, setFilterKind] = useState("all");
  const [status, setStatus] = useState("all");
  const [brand, setBrand] = useState("all");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string[]>([]);

  const base = data?.base || null;
  const allRows = data?.rows || [];
  const rowsKnown = allRows.length > 0 && allRows.every((row) => Boolean(row.base_id));
  const rows = useMemo(
    () => (rowsKnown ? allRows.filter((row) => row.base_id === id) : allRows),
    [allRows, id, rowsKnown],
  );
  const refCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of data?.assets || []) map.set(row.id, (row.ref_skills || []).length);
    return map;
  }, [data?.assets]);

  const structured = Boolean(base && kindFields(kind).length);
  const kindOptions = useMemo(
    () => KNOWLEDGE_KIND_SPECS.filter((spec) => kindAllowedInBase(spec.code, base?.kind)),
    [base?.kind],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (filterKind !== "all" && (row.kind || "policy") !== filterKind) return false;
      if (status !== "all" && (row.status || "draft") !== status) return false;
      if (brand !== "all" && (row.brand || "*") !== brand) return false;
      if (!needle) return true;
      return [row.title, row.body, row.tags, row.id]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [rows, filterKind, status, brand, query]);

  const run = async (fn: () => Promise<unknown>, message: string) => {
    try {
      await fn();
      notify(message);
      reload();
    } catch (cause) {
      fail(cause);
    }
  };

  if (!base && loading) {
    return <p className="muted" role="status">正在加载知识库…</p>;
  }
  if (!base) {
    return (
      <article className="panel" data-admin-kb-base-missing>
        <p className="muted">{error || KB_ADMIN_EMPTY.baseMissing}</p>
        <Link className="kbadmin-action-link" to="/admin/knowledge/catalog">返回知识规划</Link>
      </article>
    );
  }

  const unstructured = base.kind === "unstructured";
  const canCreateEntry = !unstructured;

  const submit = (form: HTMLFormElement) => {
    const body = new FormData(form);
    setFormError([]);
    const stageCodes = splitList(String(body.get("stage_codes") || ""));
    void api
      .createKnowledge({
        title: String(body.get("title") || "").trim(),
        kind: String(body.get("kind") || "policy"),
        base_id: base.id,
        brand: String(body.get("brand") || "*"),
        lang: String(body.get("lang") || "en"),
        body: String(body.get("body") || ""),
        stage_codes: stageCodes,
        tags: String(body.get("tags") || ""),
        status: "draft",
        structured: structuredPayload(body, String(body.get("kind") || "policy")),
      })
      .then(() => {
        notify("草稿已创建，尚未发布；审批后才对员工生效。");
        setCreating(false);
        reload();
      })
      .catch((cause: unknown) => {
        const errors = structuredErrorList(cause);
        if (errors.length) {
          setFormError(errors);
          return;
        }
        fail(cause);
      });
  };

  return (
    <>
      {dialog}
      {error && <p className="error" role="alert">{error}</p>}

      <p className="admin-crumb">
        <Link to="/admin/knowledge/catalog">知识规划</Link>
        {" / "}
        {[base.family_name, base.domain_name].filter(Boolean).join(" / ") || "未分类"}
        {" / "}
        {base.name}
      </p>

      <article className="panel" data-admin-kb-base-meta>
        <div className="admin-section-head">
          <div>
            <h2>{base.name}</h2>
            <p className="muted">
              <span className="chip" data-admin-kb-base-kind={base.kind}>{kbBaseKindLabel(base.kind)}</span>
              {" "}{base.status === "archived" ? "已停用" : "启用中"}
              {unstructured ? "" : ` · ${Number(base.entries || rows.length)} 条条目`}
              {" · "}{base.code}
            </p>
          </div>
          {canCreateEntry ? (
            <button
              className={creating ? "btn ghost" : "btn work"}
              type="button"
              aria-expanded={creating}
              data-admin-kb-create-entry
              onClick={() => setCreating((value) => !value)}
            >
              {creating ? "收起表单" : KB_ADMIN_ACTION.newEntry}
            </button>
          ) : null}
        </div>
        {base.description ? <p className="muted">{base.description}</p> : null}
        {unstructured ? (
          <p className="muted admin-note" data-admin-kb-unstructured-note>{KB_UNSTRUCTURED_P1_NOTE}</p>
        ) : null}
        {!rowsKnown && allRows.length ? (
          <p className="muted admin-note" data-admin-kb-base-unfiltered>
            列表接口这次没有返回 base_id 字段，无法确认条目是否属于本库；下表按接口原样展示，不做猜测。
          </p>
        ) : null}
      </article>

      {creating && canCreateEntry ? (
        <form
          className="settings-form kbadmin-form"
          data-admin-kb-create
          onSubmit={(event) => {
            event.preventDefault();
            submit(event.currentTarget);
          }}
        >
          <h3 className="kb-subhead">新建条目（写草稿）</h3>
          <div className="kbadmin-form-grid">
            <label className="field">标题<input name="title" required /></label>
            <label className="field">类型
              <select
                name="kind"
                defaultValue="policy"
                data-admin-kb-create-kind
                onChange={(event) => setKind(event.target.value)}
              >
                {kindOptions.map((spec) => (
                  <option key={spec.code} value={spec.code}>{spec.label}</option>
                ))}
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
            <label className="field">标签（逗号分隔）<input name="tags" placeholder="email_compose,policy" /></label>
            <label className="field">适用阶段（空格分隔）<input name="stage_codes" placeholder="INITIAL_CONTACT INTERESTED" /></label>
          </div>
          <StructuredFields kind={kind} />
          <label className="field">正文{structured ? "（长文本内容；有结构化字段时以字段为准）" : ""}
            <textarea name="body" rows={3} />
          </label>
          {formError.length ? (
            <ul className="error" data-admin-kb-structured-errors role="alert">
              {formError.map((line) => <li key={line}>{line}</li>)}
            </ul>
          ) : null}
          <p className="muted">保存后是草稿：不出现在员工知识库，也不参与运行时解析。</p>
          <button className="btn work" data-admin-kb-create-submit>{KB_ADMIN_ACTION.saveDraft}</button>
        </form>
      ) : null}

      {unstructured ? (
        <UnstructuredBasePanel baseId={id} notify={notify} fail={fail} />
      ) : (
      <article className="panel" data-admin-knowledge-entries>
        <div className="admin-section-head">
          <div>
            <h2>条目治理表</h2>
            <p className="muted">行点开是条目详情；归档从解析与员工面移除，彻底删除只对草稿开放。</p>
          </div>
          <span className="muted" role="status">显示 {filtered.length} / {rows.length} 条</span>
        </div>

        <div className="kbadmin-toolbar">
          <label className="field">类型
            <select value={filterKind} onChange={(event) => setFilterKind(event.target.value)} data-admin-kb-filter="kind">
              <option value="all">全部类型</option>
              {kindOptions.map((spec) => <option key={spec.code} value={spec.code}>{kindLabel(spec.code)}</option>)}
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
        </div>

        {rows.length && !filtered.length ? <p className="muted">{KB_ADMIN_EMPTY.entriesFiltered}</p> : null}
        {!rows.length && !loading ? <p className="muted">{KB_ADMIN_EMPTY.entries}</p> : null}

        {filtered.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table" data-admin-kb-entries-table>
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
                  const count = refCounts.get(row.id) ?? refs.length;
                  const scope = kbScopeLine(row);
                  return (
                    <tr key={row.id} data-admin-knowledge-id={row.id} data-admin-kb-status={row.status || "draft"}>
                      <td>
                        <Link className="kbadmin-title-link" to={entryPath(row.id)} title={row.title}>{row.title}</Link>
                      </td>
                      <td>{kindLabel(row.kind) || emptyCell}</td>
                      <td>{statusLabel(row.status) || emptyCell}</td>
                      <td>第 {row.current_version || 1} 版</td>
                      <td title={scope || undefined}>{scope || emptyCell}</td>
                      <td>
                        <span className="muted" data-admin-kb-ref-count={count}>{count} 个技能</span>
                      </td>
                      <td>{formatKbTime(row.updated_at) || emptyCell}</td>
                      <td>
                        <div className="kbadmin-row-actions">
                          <Link className="kbadmin-action-link" to={entryPath(row.id)}>{KB_ADMIN_ACTION.viewDetail}</Link>
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
                          {row.status === "draft" ? (
                            <button
                              className="kbadmin-action-link kbadmin-action-danger"
                              type="button"
                              data-kb-hard-delete={row.id}
                              onClick={() => ask(
                                knowledgeHardDeleteConfirm(row.title),
                                () => run(() => api.deleteKnowledge(row.id), "草稿已删除。"),
                              )}
                            >
                              彻底删除
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
      )}
    </>
  );
}
