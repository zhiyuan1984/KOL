import { useCallback, useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  KB_ADMIN_NAV,
  KB_ADMIN_VIEW_LEAD,
  KB_ADMIN_VIEW_TITLE,
  type KbAdminView,
} from "../knowledgeCopy";
import { errorMessage } from "../admin/knowledge/shared";
import ReviewView from "../admin/knowledge/ReviewView";
import CatalogView from "../admin/knowledge/CatalogView";
import BaseView from "../admin/knowledge/BaseView";
import EntryView from "../admin/knowledge/EntryView";
import IngestView from "../admin/knowledge/IngestView";
import BindingsView from "../admin/knowledge/BindingsView";
import "../admin/knowledge/knowledge-admin.css";

/**
 * 知识治理宿主：自己解析 pathname，映射六个子视图（一页一问）。
 *
 * DOM 契约（规格 §5.2）：view ∈ review | catalog | base | entry | ingest | bindings。
 * 子导航是链接式 tab：深链可达；base / entry 是上下文视图，没有 id 时提示先去目录。
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

      <nav className="kb-tabs kbadmin-tabs" aria-label="知识治理子视图">
        {KB_ADMIN_NAV.map((item) => (
          <NavLink
            key={item.view}
            to={item.path}
            end={item.view === "review"}
            data-admin-kb-tab={item.view}
            title={item.question}
            className={({ isActive }) => (isActive ? "active" : undefined)}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      {view === "review" ? <ReviewView notify={notify} fail={fail} /> : null}
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
