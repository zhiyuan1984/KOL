import { useCallback, useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  KB_ADMIN_NAV,
  KB_ADMIN_VIEW_LEAD,
  KB_ADMIN_VIEW_TITLE,
  type KbAdminView,
} from "../knowledgeCopy";
import { errorMessage } from "../admin/knowledge/shared";
import TodoView from "../admin/knowledge/TodoView";
import AssetsView from "../admin/knowledge/AssetsView";
import AssetDetailView from "../admin/knowledge/AssetDetailView";
import IngestView from "../admin/knowledge/IngestView";
import BindingsView from "../admin/knowledge/BindingsView";
import FeedbackView from "../admin/knowledge/FeedbackView";
import "../admin/knowledge/knowledge-admin.css";

/**
 * 知识治理宿主：自己解析 pathname，映射六个子视图（一页一问）。
 * 子导航是链接式 tab：深链可达，详情页高亮「资产」。
 */
export function parseKnowledgePath(pathname: string): { view: KbAdminView; id: string } {
  const rest = pathname.replace(/^\/admin\/knowledge\/?/, "");
  if (!rest) return { view: "todo", id: "" };
  const [head, ...tail] = rest.split("/").filter(Boolean).map(decodeURIComponent);
  if (head === "assets") {
    return tail.length ? { view: "detail", id: tail.join("/") } : { view: "assets", id: "" };
  }
  if (head === "ingest") return { view: "ingest", id: "" };
  if (head === "bindings") return { view: "bindings", id: "" };
  if (head === "feedback") return { view: "feedback", id: "" };
  return { view: "todo", id: "" };
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
            end={item.view === "todo"}
            data-admin-kb-tab={item.view}
            title={item.question}
            className={({ isActive }) => (isActive ? "active" : undefined)}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      {view === "todo" ? <TodoView notify={notify} fail={fail} /> : null}
      {view === "assets" ? <AssetsView notify={notify} fail={fail} /> : null}
      {view === "detail" ? <AssetDetailView id={id} notify={notify} fail={fail} /> : null}
      {view === "ingest" ? <IngestView notify={notify} fail={fail} /> : null}
      {view === "bindings" ? <BindingsView notify={notify} fail={fail} /> : null}
      {view === "feedback" ? <FeedbackView notify={notify} fail={fail} /> : null}
    </section>
  );
}
