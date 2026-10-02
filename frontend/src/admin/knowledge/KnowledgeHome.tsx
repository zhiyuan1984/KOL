import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { kindLabel } from "../../knowledgeCopy";
import { KNOWLEDGE_KIND_SPECS, errorMessage, useKbData, type KbAssetRow } from "./shared";
import LibraryPane, { type KbView } from "./LibraryPane";
import CategoryDialog, { type KbCategory } from "./CategoryDialog";
import PhaseNotice from "./PhaseNotice";

const VIEW_STATUS: Record<Exclude<KbView, "all">, string> = {
  pending: "pending_review",
  published: "published",
  draft: "draft",
  disabled: "archived",
};

const KIND_OPTIONS = KNOWLEDGE_KIND_SPECS.map((spec) => ({ value: spec.code, label: spec.label }));

type Notice = { title: string; body: string; legacyHref: string; legacyLabel: string };

/** 管理端知识主页（IA v2，P1）：顶栏＋中栏列表＋右栏详情（右栏 P1.6 填充）。 */
export default function KnowledgeHome() {
  const load = useCallback(async () => {
    const [rows, bases, domains, documents] = await Promise.all([
      api.adminKnowledge(),
      api.adminKnowledgeBases(),
      api.adminKnowledgeDomains(),
      api.adminKnowledgeDocuments({ status: "pending_review" }).catch(() => null),
    ]);
    return {
      rows: rows as KbAssetRow[],
      bases: bases.bases || [],
      domains: domains.domains || [],
      pendingDocs: documents?.documents || [],
    };
  }, []);
  const { data, error, loading } = useKbData(load);

  const [view, setView] = useState<KbView>("all");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const [category, setCategory] = useState<KbCategory>({ domainId: "", baseId: "" });
  const [sort, setSort] = useState<"updated" | "title">("updated");
  const [selectedId, setSelectedId] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const rows = data?.rows || [];
  const bases = data?.bases || [];
  const domains = data?.domains || [];
  const pendingDocsCount = data?.pendingDocs.length || 0;

  const basesById = useMemo(() => new Map(bases.map((base) => [base.id, base])), [bases]);
  const domainsById = useMemo(() => new Map(domains.map((domain) => [domain.id, domain])), [domains]);

  const pathOf = useCallback((row: KbAssetRow) => {
    const base = row.base_id ? basesById.get(row.base_id) : undefined;
    const domain = base ? domainsById.get(base.domain_id) : undefined;
    const family = domain?.parent_id ? domainsById.get(String(domain.parent_id)) : undefined;
    return [family?.name, domain?.name, base?.name].filter(Boolean).join(" / ");
  }, [basesById, domainsById]);

  const counts = useMemo(() => {
    const result: Record<KbView, number> = { all: rows.length, pending: 0, published: 0, draft: 0, disabled: 0 };
    for (const row of rows) {
      const status = String(row.status || "");
      if (status === "pending_review") result.pending += 1;
      else if (status === "published") result.published += 1;
      else if (status === "archived") result.disabled += 1;
      else result.draft += 1;
    }
    return result;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((row) => {
        if (view !== "all" && String(row.status || "") !== VIEW_STATUS[view]) return false;
        if (kind && row.kind !== kind) return false;
        if (category.baseId && row.base_id !== category.baseId) return false;
        if (category.domainId && !category.baseId) {
          const base = row.base_id ? basesById.get(row.base_id) : undefined;
          if (!base || String(base.domain_id) !== category.domainId) return false;
        }
        if (q) {
          const haystack = [row.title, row.kind ? kindLabel(row.kind) : "", pathOf(row), row.created_by || ""]
            .join(" ")
            .toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sort === "title") return String(a.title).localeCompare(String(b.title), "zh-CN");
        return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
      });
  }, [rows, view, kind, category, query, sort, basesById, pathOf]);

  const selectedRow = useMemo(
    () => filtered.find((row) => row.id === selectedId) || filtered[0] || null,
    [filtered, selectedId],
  );

  const baseCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) {
      if (!row.base_id) continue;
      map.set(row.base_id, (map.get(row.base_id) || 0) + 1);
    }
    return map;
  }, [rows]);

  const domainCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const base of bases) {
      const count = baseCounts.get(base.id) || 0;
      if (!count) continue;
      map.set(base.domain_id, (map.get(base.domain_id) || 0) + count);
    }
    return map;
  }, [bases, baseCounts]);

  const categoryLabel = useMemo(() => {
    if (category.baseId) {
      const base = basesById.get(category.baseId);
      const domain = base ? domainsById.get(base.domain_id) : undefined;
      return base ? `${domain?.name || "未分类"} / ${base.name}` : "全部领域 / 主题";
    }
    if (category.domainId) return domainsById.get(category.domainId)?.name || "全部领域 / 主题";
    return "全部领域 / 主题";
  }, [category, basesById, domainsById]);

  const reset = useCallback(() => {
    setQuery("");
    setKind("");
    setCategory({ domainId: "", baseId: "" });
    setView("all");
  }, []);

  return (
    <section className="kbv" data-admin-knowledge data-admin-kb-v2="home">
      {error ? <p className="error" role="alert">{errorMessage(error)}</p> : null}

      <header className="kbv-top" data-kbv-top>
        <div className="kbv-heading">
          <h1>知识管理</h1>
          <span className="kbv-lead">维护可信、可用的知识</span>
        </div>
        <div className="kbv-actions">
          <button type="button" className="btn" data-kbv-category onClick={() => setCategoryOpen(true)}>
            分类目录
          </button>
          <button
            type="button"
            className="btn"
            data-kbv-upload
            onClick={() => setNotice({
              title: "上传文件 · P2 接入",
              body: "多格式上传与提取管线将在 P2 接入本页；过渡期请使用旧版入库视图完成上传。",
              legacyHref: "/admin/knowledge/ingest",
              legacyLabel: "打开旧版入库（迁移中）",
            })}
          >
            上传文件
          </button>
          <button
            type="button"
            className="btn work"
            data-kbv-new
            onClick={() => setNotice({
              title: "新建知识 · P2 接入",
              body: "新建与修订将在 P2 接入本页；过渡期可在旧版目录里进入知识库后新建条目。",
              legacyHref: "/admin/knowledge/catalog",
              legacyLabel: "打开旧版目录（迁移中）",
            })}
          >
            新建知识
          </button>
        </div>
      </header>

      <div className="kbv-workspace">
        <LibraryPane
          rows={filtered}
          totalCount={rows.length}
          counts={counts}
          view={view}
          onView={setView}
          query={query}
          onQuery={setQuery}
          categoryLabel={categoryLabel}
          onOpenCategory={() => setCategoryOpen(true)}
          kindOptions={KIND_OPTIONS}
          kind={kind}
          onKind={setKind}
          sort={sort}
          onSort={setSort}
          onReset={reset}
          selectedId={selectedRow?.id || ""}
          onSelect={setSelectedId}
          expanded={expanded}
          onToggleExpand={() => setExpanded((current) => !current)}
          pendingDocsCount={pendingDocsCount}
          loading={loading}
          pathOf={pathOf}
          onUpload={() => setNotice({
            title: "上传文件 · P2 接入",
            body: "多格式上传与提取管线将在 P2 接入本页；过渡期请使用旧版入库视图完成上传。",
            legacyHref: "/admin/knowledge/ingest",
            legacyLabel: "打开旧版入库（迁移中）",
          })}
          onCreate={() => setNotice({
            title: "新建知识 · P2 接入",
            body: "新建与修订将在 P2 接入本页；过渡期可在旧版目录里进入知识库后新建条目。",
            legacyHref: "/admin/knowledge/catalog",
            legacyLabel: "打开旧版目录（迁移中）",
          })}
        />

        <aside className="kbv-rail" aria-label="知识详情" data-kbv-detail>
          {selectedRow ? (
            <p className="kbv-empty">
              详情视图接入中；过渡期可在
              <Link className="kbv-link-plain" to={`/admin/knowledge/entries/${encodeURIComponent(selectedRow.id)}`}>
                旧版条目视图（迁移中）
              </Link>
              查看这条知识。
            </p>
          ) : (
            <p className="kbv-empty">从列表选择一条知识，查看内容与来源。</p>
          )}
        </aside>
      </div>

      <CategoryDialog
        open={categoryOpen}
        onClose={() => setCategoryOpen(false)}
        domains={domains}
        bases={bases}
        baseCounts={baseCounts}
        domainCounts={domainCounts}
        selected={category}
        onPick={(next) => {
          setCategory(next);
          setView("all");
        }}
      />
      <PhaseNotice
        open={Boolean(notice)}
        title={notice?.title || ""}
        body={notice?.body || ""}
        legacyHref={notice?.legacyHref}
        legacyLabel={notice?.legacyLabel}
        onClose={() => setNotice(null)}
      />
    </section>
  );
}
