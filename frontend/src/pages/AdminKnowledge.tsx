import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import {
  KB_ADMIN_DEFAULT_PATH,
  KB_ADMIN_NAV,
  KB_ADMIN_VIEW_LEAD,
  KB_ADMIN_VIEW_TITLE,
  type KbAdminView,
} from "../knowledgeCopy";
import { errorMessage } from "../admin/knowledge/shared";
import CatalogView from "../admin/knowledge/CatalogView";
import BaseView from "../admin/knowledge/BaseView";
import EntryView from "../admin/knowledge/EntryView";
import IngestView from "../admin/knowledge/IngestView";
import BindingsView from "../admin/knowledge/BindingsView";
import KnowledgeHome from "../admin/knowledge/KnowledgeHome";
import "../admin/knowledge/knowledge-admin.css";
import "../knowledge-page.css";

/**
 * 知识治理宿主（IA v2，2026-10-02）：
 * - 默认路由 `/admin/knowledge` ＝新主页（列表＋同页详情）；
 * - 旧子视图（catalog / bases / entries / ingest / bindings）过渡保留：slim 导航（← 知识首页 ＋ 5 项），
 *   能力逐项折叠进主页后退役（见 docs/superpowers/plans/2026-10-02-knowledge-ia-v2-implementation.md）。
 */
export function parseKnowledgePath(pathname: string): { view: KbAdminView; id: string } {
  const rest = pathname.replace(/^\/admin\/knowledge\/?/, "");
  if (!rest) return { view: "review", id: "" };
  const [head, ...tail] = rest.split("/").filter(Boolean).map(decodeURIComponent);
  if (head === "catalog") return { view: "catalog", id: "" };
  if (head === "bases") return { view: "base", id: tail.join("/") };
  if (head === "entries") return { view: "entry", id: tail.join("/") };
  if (head === "ingest") return { view: "ingest", id: "" };
  if (head === "bindings") return { view: "bindings", id: "" };
  return { view: "review", id: "" };
}

export default function AdminKnowledge() {
  const location = useLocation();
  const { view, id } = parseKnowledgePath(location.pathname);
  if (view === "review") return <KnowledgeHome />;
  return <LegacyKnowledgeHost view={view} id={id} />;
}

const LEGACY_NAV = KB_ADMIN_NAV.filter((item) => item.view !== "review");

/** 旧六子视图的过渡宿主：只换导航壳，视图本身原样保留。 */
function LegacyKnowledgeHost({ view, id }: { view: KbAdminView; id: string }) {
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const notify = useCallback((message: string) => {
    setError("");
    setNotice(message);
  }, []);
  const fail = useCallback((cause: unknown, fallback = "操作失败") => {
    setNotice("");
    setError(errorMessage(cause, fallback));
  }, []);

  useEffect(() => {
    setNotice("");
    setError("");
  }, [view, id]);

  return (
    <section className="admin-kb admin-govern" data-admin-knowledge data-admin-kb-view={view}>
      {notice ? (
        <p className="admin-receipt status-ok" data-admin-receipt role="status">{notice}</p>
      ) : null}
      {error ? <p className="error" role="alert">{error}</p> : null}

      <header className="admin-section-head">
        <div>
          <h2>{KB_ADMIN_VIEW_TITLE[view]}</h2>
          <p className="muted">{KB_ADMIN_VIEW_LEAD[view]}</p>
        </div>
      </header>

      <nav className="kb-tabs kbadmin-tabs" aria-label="知识治理子视图（旧版过渡）">
        <Link to={KB_ADMIN_DEFAULT_PATH} data-admin-kb-home-link className="kbadmin-action-link">
          ← 知识首页
        </Link>
        {LEGACY_NAV.map((item) => (
          <NavLink
            key={item.view}
            to={item.path}
            data-admin-kb-tab={item.view}
            title={item.question}
            className={({ isActive }) => (isActive ? "active" : undefined)}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      {view === "catalog" ? <CatalogView notify={notify} fail={fail} /> : null}
      {view === "base" ? (
        id ? (
          <BaseView id={id} notify={notify} fail={fail} />
        ) : (
          <CatalogHint what="知识库" />
        )
      ) : null}
      {view === "entry" ? (
        id ? (
          <EntryView id={id} notify={notify} fail={fail} />
        ) : (
          <CatalogHint what="条目" />
        )
      ) : null}
      {view === "ingest" ? <IngestView notify={notify} fail={fail} /> : null}
      {view === "bindings" ? <BindingsView notify={notify} fail={fail} /> : null}
    </section>
  );
}

/** base / entry 是上下文视图：没有 id 时不猜测对象，回目录选一个。 */
function CatalogHint({ what }: { what: string }) {
  return (
    <article className="panel" data-admin-kb-context-hint>
      <p className="muted">请先在知识目录里选一个{what}。</p>
      <NavLink className="kbadmin-action-link" to="/admin/knowledge/catalog">去知识目录</NavLink>
    </article>
  );
}
