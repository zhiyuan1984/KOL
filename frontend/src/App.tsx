import { lazy, Suspense, useRef } from "react";
import RouteErrorBoundary from "./components/RouteErrorBoundary";
import { Navigate, Route, Routes, useLocation, type Location } from "react-router-dom";
import Workbench from "./layout/Workbench";
import AuthGate, { useAccount } from "./components/AuthGate";
import { ViewModeProvider } from "./viewMode";

/** Route-level code splitting: the shell stays small; each surface loads on demand. */
const Home = lazy(() => import("./pages/Home"));
const Mail = lazy(() => import("./pages/Mail"));
const Session = lazy(() => import("./pages/Session"));
const Pipeline = lazy(() => import("./pages/Pipeline"));
const Approvals = lazy(() => import("./pages/Approvals"));
const ApprovalTypes = lazy(() => import("./pages/ApprovalTypes"));
const Reviews = lazy(() => import("./pages/Reviews"));
const ReviewTypes = lazy(() => import("./pages/ReviewTypes"));
const Cron = lazy(() => import("./pages/Cron"));
const SkillCatalog = lazy(() =>
  import("./pages/SkillCatalog").then((m) => ({ default: m.SkillCatalog })));
const Exam = lazy(() => import("./pages/Exam"));
const Knowledge = lazy(() => import("./pages/Knowledge"));
const AccountSettings = lazy(() => import("./pages/AccountSettings"));
const OntologyWorkspace = lazy(() => import("./ontology/OntologyWorkspace"));
const AdminConsole = lazy(() => import("./pages/AdminConsole"));
const SharedSession = lazy(() => import("./pages/SharedSession"));
const SkillHub = lazy(() => import("./pages/SkillHub").then((m) => ({ default: m.SkillHub })));
const Partners = lazy(() => import("./pages/Partners"));
const Agents = lazy(() => import("./pages/Agents"));
const AgentTeams = lazy(() => import("./pages/AgentTeams"));
const PerformanceWorkspace = lazy(() => import("./performance/PerformanceWorkspace"));
const AdminPerformance = lazy(() => import("./performance/AdminPerformance"));
const Tasks = lazy(() => import("./pages/Tasks"));
const TaskDetailPage = lazy(() => import("./pages/TaskDetailPage"));
const BusinessMap = lazy(() => import("./pages/BusinessMap"));

function RouteFallback() {
  return <p className="muted" style={{ padding: 24 }} data-route-loading>加载中…</p>;
}

/** The historical Home reads legacy task/collaboration projections. In the
 * PostgreSQL-only deployment it must not become a broken implicit fallback;
 * employees enter the audited formal ticket center instead. */
function HomeEntry() {
  const { postgresOnly } = useAccount();
  return postgresOnly ? <Navigate to="/tasks" replace /> : <Home />;
}

/** Only mail is an overlay: freeze the previous location and its mounted page.
 * Direct /mail links keep their existing route; other deep links are unchanged. */
function WorkbenchRoutes() {
  const location = useLocation();
  const previous = useRef<Location | null>(null);
  const onMail = location.pathname === "/mail";
  if (!onMail) previous.current = location;
  const background = onMail ? previous.current : null;
  return <>
        <div style={{ display: "contents" }} inert={!!background} aria-hidden={background ? true : undefined} data-mail-background={background ? true : undefined}>
        <Routes location={background || location}>
          <Route element={<Workbench />}>
            <Route path="/" element={<HomeEntry />} />
            <Route path="/work" element={<Navigate to="/" replace />} />
            <Route path="/s/:id" element={<Session />} />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/performance" element={<Navigate to="/performance/me" replace />} />
            <Route path="/performance/records/:recordId" element={<PerformanceWorkspace />} />
            <Route path="/performance/:view" element={<PerformanceWorkspace />} />
            <Route path="/admin/performance/*" element={<AdminPerformance />} />
            <Route path="/tasks/:taskId" element={<TaskDetailPage />} />
            <Route path="/leads" element={<BusinessMap view="leads" />} />
            <Route path="/cooperations" element={<BusinessMap view="cooperations" />} />
            <Route path="/pipeline" element={<Pipeline />} />
            <Route path="/cron" element={<Cron />} />
            <Route path="/cron/:jobId" element={<Cron />} />
            <Route path="/mail" element={<Mail />} />
            <Route path="/skills" element={<SkillCatalog />} />
            <Route path="/agents/:id" element={<Agents />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/teams" element={<AgentTeams />} />
            <Route path="/kb" element={<Knowledge />} />
            <Route path="/market/skills" element={<SkillHub />} />
            <Route path="/partners" element={<Partners />} />
            <Route path="/market/kb" element={<Navigate to="/kb" replace />} />
            <Route path="/exam/:assignmentId" element={<Exam />} />
            <Route path="/exam" element={<Exam />} />
            <Route path="/approvals/:id" element={<Approvals />} />
            <Route path="/approvals/legacy" element={<Approvals />} />
            <Route path="/reviews/:id" element={<Reviews />} />
            <Route path="/approvals" element={<Reviews />} />
            <Route path="/admin/approval-types/legacy" element={<ApprovalTypes />} />
            <Route path="/admin/approval-types" element={<ReviewTypes />} />
            <Route path="/settings" element={<AccountSettings />} />
            <Route path="/ontology" element={<OntologyWorkspace />} />
            <Route path="/admin/ontology" element={<OntologyWorkspace admin />} />
            <Route path="/admin/data/ontology" element={<Navigate to="/admin/ontology" replace />} />
            <Route path="/admin/*" element={<AdminConsole />} />
          </Route>
        </Routes>
        </div>
        {background ? <Suspense fallback={<RouteFallback />}><Mail /></Suspense> : null}
  </>;
}

export default function App() {
  return (
    <RouteErrorBoundary label="app">
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/share/:token" element={<SharedSession />} />
          <Route path="*" element={<AuthGate><ViewModeProvider><Suspense fallback={<RouteFallback />}><WorkbenchRoutes /></Suspense></ViewModeProvider></AuthGate>} />
        </Routes>
      </Suspense>
    </RouteErrorBoundary>
  );
}
