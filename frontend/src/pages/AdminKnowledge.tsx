import { useLocation } from "react-router-dom";
import type { KbAdminView } from "../knowledgeCopy";
import { useAccount } from "../components/AuthGate";
import { reviewCompany } from "../reviews/api";
import KnowledgeHome from "../admin/knowledge/KnowledgeHome";
import type { KnowledgeStage } from "../admin/knowledge/KnowledgeLifecycleTabs";
import "../admin/knowledge/knowledge-admin.css";
import "../knowledge-page.css";

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

/** 原路径与对象 ID 保持；子页面只共享三栏宿主和右栏治理入口。 */
export default function AdminKnowledge() {
  const location = useLocation();
  const { account } = useAccount();
  const { view, id } = parseKnowledgePath(location.pathname);
  const stage: KnowledgeStage = ({ catalog: "catalog", base: "catalog", ingest: "processing", bindings: "bindings" } as Record<string, KnowledgeStage>)[view] || "published";
  return <KnowledgeHome key={`${account?.id}:${reviewCompany()}:${location.pathname}`} initialStage={stage}
    routeBaseId={view === "base" ? id : undefined} routeEntryId={view === "entry" ? id : undefined} />;
}
