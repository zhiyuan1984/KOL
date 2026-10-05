import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, Navigate, useLocation } from "react-router-dom";
import {
  KB_ADMIN_DEFAULT_PATH,
  KB_ADMIN_VIEW_LEAD,
  KB_ADMIN_VIEW_TITLE,
  type KbAdminView,
} from "../knowledgeCopy";
import { errorMessage } from "../admin/knowledge/shared";
import {useAccount} from "../components/AuthGate";
import {reviewCompany} from "../reviews/api";
import CatalogView from "../admin/knowledge/CatalogView";
import BaseView from "../admin/knowledge/BaseView";
import EntryView from "../admin/knowledge/EntryView";
import IngestView from "../admin/knowledge/IngestView";
import BindingsView from "../admin/knowledge/BindingsView";
import KnowledgeHome from "../admin/knowledge/KnowledgeHome";
import "../admin/knowledge/knowledge-admin.css";
import "../knowledge-page.css";

/**
 * 知识治理宿主（IA v2）：
 * - 默认路由 `/admin/knowledge` ＝新主页（三级分类 tab＋列表＋同页详情）；
 * - 子视图（catalog / bases / entries / ingest / bindings）直达可达，页面内仅保留「返回知识管理」回链。
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
  const {account}=useAccount();
  const { view, id } = parseKnowledgePath(location.pathname);
  if(view === "entry" && id) { const query=new URLSearchParams(location.search);query.set("mode","detail");query.set("assetType","entry");query.set("assetId",id);return <Navigate replace to={`/admin/knowledge?${query}`} />; }
  if (view === "review") return <KnowledgeHome key={`${account?.id}:${reviewCompany()}`} />;
  return <SubViewHost view={view} id={id} />;
}

/** 子视图宿主：直达可达，仅保留返回回链。 */
function SubViewHost({ view, id }: { view: KbAdminView; id: string }) {
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

      <p className="kbadmin-back">
        <Link to={KB_ADMIN_DEFAULT_PATH} data-admin-kb-home-link className="kbadmin-action-link">
          ← 返回知识管理
        </Link>
      </p>

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
