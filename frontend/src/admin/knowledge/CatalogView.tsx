import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type KnowledgeBaseRow, type KnowledgeDomainRow } from "../../api";
import {
  KB_ADMIN_ACTION,
  KB_ADMIN_EMPTY,
  KB_UNSTRUCTURED_NOT_IMPLEMENTED,
  kbBaseKindLabel,
  kbLevelLabel,
} from "../../knowledgeCopy";
import {
  basePath,
  textValue,
  useKbData,
  type KbFeed,
} from "./shared";

type CreateMode = "" | "family" | "domain" | "base";

/** 目录：知识分在哪几个主题域族 / 主题域 / 知识库？—— 唯一实底 CTA 是「新建知识库」。 */
export default function CatalogView({ notify, fail }: KbFeed) {
  const load = useCallback(async () => {
    const [domains, bases] = await Promise.all([
      api.adminKnowledgeDomains(),
      api.adminKnowledgeBases(),
    ]);
    return { domains: domains.domains || [], bases: bases.bases || [] };
  }, []);
  const { data, error, loading, reload } = useKbData(load);

  const [creating, setCreating] = useState<CreateMode>("");
  const [domainParent, setDomainParent] = useState("");

  const domains = data?.domains || [];
  const bases = data?.bases || [];
  const families = useMemo(
    () => domains.filter((row) => row.level === "family").sort(sortRows),
    [domains],
  );
  const domainsByFamily = useMemo(() => {
    const map = new Map<string, KnowledgeDomainRow[]>();
    for (const row of domains.filter((item) => item.level === "domain")) {
      const key = String(row.parent_id || "");
      map.set(key, [...(map.get(key) || []), row].sort(sortRows));
    }
    return map;
  }, [domains]);
  const basesByDomain = useMemo(() => {
    const map = new Map<string, KnowledgeBaseRow[]>();
    for (const row of bases) {
      const key = String(row.domain_id || "");
      map.set(key, [...(map.get(key) || []), row].sort(sortRows));
    }
    return map;
  }, [bases]);
  const domainOptions = useMemo(
    () => domains.filter((row) => row.level === "domain").sort(sortRows),
    [domains],
  );
  const hasClassification = domainOptions.length > 0;

  const run = async (fn: () => Promise<unknown>, message: string) => {
    try {
      await fn();
      notify(message);
      setCreating("");
      reload();
    } catch (cause) {
      fail(cause);
    }
  };

  const openCreate = (mode: CreateMode) => {
    setCreating((current) => (current === mode ? "" : mode));
    if (mode === "domain" && !domainParent) setDomainParent(String(families[0]?.id || ""));
  };

  return (
    <>
      {error && <p className="error" role="alert">{error}</p>}
      {loading && !data && <p className="muted" role="status">正在加载知识目录…</p>}

      <article className="panel" data-admin-kb-catalog>
        <div className="admin-section-head">
          <div>
            <h2>分类目录</h2>
            <p className="muted">
              族 / 域 / 库只做业务归类，不承载权限；可见范围仍按组织范围与授权。
              库分结构化（按键取用的受控条目）与非结构化（解析与检索后续阶段落地）。
            </p>
          </div>
          {/*
            同一视口只有一个实底 CTA：有分类时是「新建知识库」，没有分类时先建「主题域族」。
          */}
          <button
            className={creating ? "btn ghost" : "btn work"}
            type="button"
            aria-expanded={creating !== ""}
            data-admin-kb-create-base
            onClick={() => openCreate(hasClassification ? "base" : "family")}
          >
            {creating === (hasClassification ? "base" : "family")
              ? "收起表单"
              : hasClassification ? KB_ADMIN_ACTION.newBase : KB_ADMIN_ACTION.newFamily}
          </button>
        </div>

        <div className="kbadmin-row-actions kbadmin-catalog-actions">
          {hasClassification ? (
            <button
              className="kbadmin-action-link"
              type="button"
              data-admin-kb-create-family
              onClick={() => openCreate("family")}
            >
              {KB_ADMIN_ACTION.newFamily}
            </button>
          ) : null}
          {families.length ? (
            <button
              className="kbadmin-action-link"
              type="button"
              data-admin-kb-create-domain
              onClick={() => openCreate("domain")}
            >
              {KB_ADMIN_ACTION.newDomain}
            </button>
          ) : null}
        </div>

        {creating === "family" ? (
          <form
            className="settings-form kbadmin-form"
            data-admin-kb-family-form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void run(
                () => api.adminKnowledgeDomainCreate({
                  code: textValue(form.get("code")),
                  name: textValue(form.get("name")),
                  level: "family",
                  note: textValue(form.get("note")) || undefined,
                }),
                "主题域族已创建。",
              );
            }}
          >
            <h3 className="kb-subhead">新建主题域族</h3>
            <div className="kbadmin-form-grid">
              <label className="field">编码<input name="code" required placeholder="kol_business" /></label>
              <label className="field">名称<input name="name" required placeholder="KOL 业务" /></label>
              <label className="field">备注<input name="note" /></label>
            </div>
            <p className="muted">族是最高一层分类；域必须挂在族下，库必须挂在域下。</p>
            <button className="btn work" data-admin-kb-family-submit>{KB_ADMIN_ACTION.saveDomain}</button>
          </form>
        ) : null}

        {creating === "domain" ? (
          <form
            className="settings-form kbadmin-form"
            data-admin-kb-domain-form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void run(
                () => api.adminKnowledgeDomainCreate({
                  code: textValue(form.get("code")),
                  name: textValue(form.get("name")),
                  level: "domain",
                  parent_id: textValue(form.get("parent_id")),
                  note: textValue(form.get("note")) || undefined,
                }),
                "主题域已创建。",
              );
            }}
          >
            <h3 className="kb-subhead">新建主题域</h3>
            <div className="kbadmin-form-grid">
              <label className="field">所属族
                <select
                  name="parent_id"
                  required
                  value={domainParent}
                  data-admin-kb-domain-parent
                  onChange={(event) => setDomainParent(event.target.value)}
                >
                  <option value="">请选择族</option>
                  {families.map((family) => (
                    <option key={family.id} value={family.id}>{family.name}</option>
                  ))}
                </select>
              </label>
              <label className="field">编码<input name="code" required placeholder="email_sop" /></label>
              <label className="field">名称<input name="name" required placeholder="邮件 SOP" /></label>
              <label className="field">备注<input name="note" /></label>
            </div>
            <button className="btn work" data-admin-kb-domain-submit>{KB_ADMIN_ACTION.saveDomain}</button>
          </form>
        ) : null}

        {creating === "base" ? (
          <form
            className="settings-form kbadmin-form"
            data-admin-kb-base-form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void run(
                () => api.adminKnowledgeBaseCreate({
                  code: textValue(form.get("code")),
                  name: textValue(form.get("name")),
                  domain_id: textValue(form.get("domain_id")),
                  kind: textValue(form.get("kind")) || "structured",
                  description: textValue(form.get("description")),
                }),
                "知识库已创建；条目仍需逐条新建并审批发布。",
              );
            }}
          >
            <h3 className="kb-subhead">新建知识库</h3>
            <div className="kbadmin-form-grid">
              <label className="field">所属主题域
                <select name="domain_id" required data-admin-kb-base-domain defaultValue="">
                  <option value="">请选择主题域</option>
                  {domainOptions.map((domain) => (
                    <option key={domain.id} value={domain.id}>
                      {[domainNameOf(domain, families), domain.name].filter(Boolean).join(" / ")}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">编码<input name="code" required placeholder="legacy" /></label>
              <label className="field">名称<input name="name" required placeholder="历史知识（结构化）" /></label>
              <label className="field">库类型
                <select name="kind" defaultValue="structured" data-admin-kb-base-kind>
                  <option value="structured">{kbBaseKindLabel("structured")}：按键取用的受控条目</option>
                  <option value="unstructured">{kbBaseKindLabel("unstructured")}：文档 / 媒体（本阶段未实现）</option>
                </select>
              </label>
              <label className="field">说明<input name="description" /></label>
            </div>
            <p className="muted">{KB_UNSTRUCTURED_NOT_IMPLEMENTED}</p>
            <button className="btn work" data-admin-kb-base-submit>{KB_ADMIN_ACTION.saveBase}</button>
          </form>
        ) : null}

        {!domains.length && !bases.length && !loading ? <p className="muted">{KB_ADMIN_EMPTY.catalog}</p> : null}

        {families.length ? (
          <ul className="kbadmin-tree" data-admin-kb-catalog-tree>
            {families.map((family) => (
              <li className="kbadmin-tree-node" key={family.id} data-admin-kb-family={family.id}>
                <p className="kbadmin-tree-head">
                  <span className="chip kbadmin-level">{kbLevelLabel("family")}</span>
                  <strong>{family.name}</strong>
                  <span className="muted">{family.code}</span>
                </p>
                {!domainsByFamily.get(family.id)?.length ? (
                  <p className="muted kbadmin-tree-empty">这个族下还没有主题域。</p>
                ) : null}
                <ul className="kbadmin-tree-children">
                  {(domainsByFamily.get(family.id) || []).map((domain) => (
                    <li className="kbadmin-tree-node" key={domain.id} data-admin-kb-domain={domain.id}>
                      <p className="kbadmin-tree-head">
                        <span className="chip kbadmin-level">{kbLevelLabel("domain")}</span>
                        <strong>{domain.name}</strong>
                        <span className="muted">{domain.code}</span>
                      </p>
                      {!basesByDomain.get(domain.id)?.length ? (
                        <p className="muted kbadmin-tree-empty">{KB_ADMIN_EMPTY.bases}</p>
                      ) : null}
                      <ul className="kbadmin-tree-children">
                        {(basesByDomain.get(domain.id) || []).map((base) => (
                          <li className="admin-row kbadmin-tree-base" key={base.id} data-admin-kb-base={base.id}>
                            <div>
                              <Link className="kbadmin-title-link" to={basePath(base.id)}>{base.name}</Link>
                              <p className="muted">
                                <span className="chip kbadmin-kind" data-admin-kb-base-kind={base.kind}>
                                  {kbBaseKindLabel(base.kind)}
                                </span>
                                <span data-admin-kb-base-entries={Number(base.entries || 0)}>
                                  {Number(base.entries || 0)} 条条目
                                </span>
                                {" · "}{base.code}
                                {base.status === "archived" ? " · 已归档" : ""}
                                {base.description ? ` · ${base.description}` : ""}
                              </p>
                            </div>
                            <Link className="kbadmin-action-link" to={basePath(base.id)}>
                              {KB_ADMIN_ACTION.viewDetail}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : null}
      </article>
    </>
  );
}

function sortRows(a: { sort?: number; name?: string }, b: { sort?: number; name?: string }): number {
  const bySort = Number(a.sort || 0) - Number(b.sort || 0);
  if (bySort) return bySort;
  return String(a.name || "").localeCompare(String(b.name || ""), "zh-CN");
}

function domainNameOf(domain: KnowledgeDomainRow, families: KnowledgeDomainRow[]): string {
  return String(families.find((family) => family.id === domain.parent_id)?.name || "");
}
