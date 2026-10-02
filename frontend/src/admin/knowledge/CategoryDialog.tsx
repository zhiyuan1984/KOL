import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { KnowledgeBaseRow, KnowledgeDomainRow } from "../../api";
import KbvIcon from "../../knowledgeIcons";

export type KbCategory = { domainId: string; baseId: string };

type Props = {
  open: boolean;
  onClose: () => void;
  domains: KnowledgeDomainRow[];
  bases: KnowledgeBaseRow[];
  baseCounts: Map<string, number>;
  domainCounts: Map<string, number>;
  selected: KbCategory;
  onPick: (next: KbCategory) => void;
};

/** 分类目录（选择态）：族→领域→主题（库）树＋搜索＋计数；管理动作在旧版目录（迁移中）。 */
export default function CategoryDialog({ open, onClose, domains, bases, baseCounts, domainCounts, selected, onPick }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      setSearch("");
      el.showModal();
    }
    if (!open && el.open) el.close();
  }, [open]);

  const families = useMemo(() => domains.filter((row) => row.level === "family"), [domains]);
  const domainsByFamily = useMemo(() => {
    const map = new Map<string, KnowledgeDomainRow[]>();
    for (const row of domains) {
      if (row.level !== "domain") continue;
      const key = String(row.parent_id || "");
      map.set(key, [...(map.get(key) || []), row]);
    }
    return map;
  }, [domains]);
  const basesByDomain = useMemo(() => {
    const map = new Map<string, KnowledgeBaseRow[]>();
    for (const row of bases) {
      const key = String(row.domain_id || "");
      map.set(key, [...(map.get(key) || []), row]);
    }
    return map;
  }, [bases]);

  const q = search.trim();
  const familyRows = families
    .map((family) => ({
      family,
      rows: (domainsByFamily.get(family.id) || []).filter((domain) => {
        if (!q) return true;
        return domain.name.includes(q) || (basesByDomain.get(domain.id) || []).some((base) => base.name.includes(q));
      }),
    }))
    .filter(({ rows }) => rows.length > 0);

  const pick = (next: KbCategory) => {
    onPick(next);
    onClose();
  };

  return (
    <dialog
      ref={ref}
      className="kbv-dialog"
      data-size="browse"
      data-kbv-category-dialog
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="kbv-dialog-head">
        <h2>选择领域与主题</h2>
        <button type="button" className="btn ghost" aria-label="关闭" onClick={onClose}>
          <KbvIcon name="close" />
        </button>
      </div>
      <div className="kbv-dialog-body">
        <div className="kbv-search">
          <KbvIcon name="search" />
          <input
            type="search"
            aria-label="搜索领域或主题"
            placeholder="搜索领域或主题"
            data-kbv-category-search
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="kbv-tree">
          {!q ? (
            <button type="button" data-kbv-category-all onClick={() => pick({ domainId: "", baseId: "" })}>
              全部领域与主题
            </button>
          ) : null}
          {familyRows.map(({ family, rows }) => (
            <div key={family.id}>
              <h3>{family.name}</h3>
              {rows.map((domain) => {
                const list = basesByDomain.get(domain.id) || [];
                return (
                  <details key={domain.id} open={Boolean(q) || domain.id === selected.domainId}>
                    <summary>
                      {domain.name}
                      <span className="muted"> · {list.length} 个主题</span>
                    </summary>
                    <div className="kbv-topics">
                      <button
                        type="button"
                        data-kbv-category-domain={domain.id}
                        onClick={() => pick({ domainId: domain.id, baseId: "" })}
                      >
                        查看整个领域 <small>{domainCounts.get(domain.id) || 0} 条</small>
                      </button>
                      {list.map((base) => (
                        <button
                          key={base.id}
                          type="button"
                          data-kbv-category-base={base.id}
                          onClick={() => pick({ domainId: domain.id, baseId: base.id })}
                        >
                          {base.name} <small>{baseCounts.get(base.id) || 0} 条</small>
                        </button>
                      ))}
                    </div>
                  </details>
                );
              })}
            </div>
          ))}
          {familyRows.length === 0 ? <p className="muted">没有匹配的领域或主题。</p> : null}
        </div>
        <p className="muted">
          分类只做业务归类，不承载权限；新建/改名/合并需校验引用并保留历史标识。
          结构管理暂在 <Link className="kbv-link-plain" to="/admin/knowledge/catalog">旧版目录（迁移中）</Link>。
        </p>
      </div>
    </dialog>
  );
}
