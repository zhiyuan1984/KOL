import { lazy, Suspense } from "react";
import RouteErrorBoundary from "./components/RouteErrorBoundary";
import { Navigate, Route, Routes } from "react-router-dom";
import Workbench from "./layout/Workbench";
import AuthGate, { useAccount } from "./components/AuthGate";
import { ViewModeProvider } from "./viewMode";

/** Route-level code splitting: the shell stays small; each surface loads on demand. */
const Home = lazy(() => import("./pages/Home"));
const Mail = lazy(() => import("./pages/Mail"));
const Chat = lazy(() => import("./pages/Chat"));
const Pipeline = lazy(() => import("./pages/Pipeline"));
const Approvals = lazy(() => import("./pages/Approvals"));
const ApprovalTypes = lazy(() => import("./pages/ApprovalTypes"));
const Cron = lazy(() => import("./pages/Cron"));
const SkillCatalog = lazy(() =>
  import("./pages/SkillCatalog").then((m) => ({ default: m.SkillCatalog })));
const Exam = lazy(() => import("./pages/Exam"));
const Knowledge = lazy(() => import("./pages/Knowledge"));
const AccountSettings = lazy(() => import("./pages/AccountSettings"));
const AdminConsole = lazy(() => import("./pages/AdminConsole"));
const SharedSession = lazy(() => import("./pages/SharedSession"));
const SkillHub = lazy(() => import("./pages/SkillHub").then((m) => ({ default: m.SkillHub })));
const Partners = lazy(() => import("./pages/Partners"));
const Agents = lazy(() => import("./pages/Agents"));
const AgentTeams = lazy(() => import("./pages/AgentTeams"));
const Tasks = lazy(() => import("./pages/Tasks"));

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

/** Formal ticket views are not available in the compatibility runtime. Keep the
 * established workbench session and task surface intact instead of exposing an
 * independent ticket-identity form. */
function TasksEntry() {
  const { postgresOnly } = useAccount();
  return postgresOnly ? <Tasks /> : <Navigate to="/?tab=today" replace />;
}

export default function App() {
  return (
    <RouteErrorBoundary label="app">
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/share/:token" element={<SharedSession />} />
          <Route path="*" element={<AuthGate><ViewModeProvider><Suspense fallback={<RouteFallback />}><Routes>
          <Route element={<Workbench />}>
            <Route path="/" element={<HomeEntry />} />
            <Route path="/work" element={<Navigate to="/" replace />} />
            <Route path="/s/:id" element={<Chat />} />
            <Route path="/tasks" element={<TasksEntry />} />
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
            <Route path="/approvals" element={<Approvals />} />
            <Route path="/admin/approval-types" element={<ApprovalTypes />} />
            <Route path="/settings" element={<AccountSettings />} />
            <Route path="/admin/*" element={<AdminConsole />} />
          </Route>
        </Routes></Suspense></ViewModeProvider></AuthGate>} />
        </Routes>
      </Suspense>
    </RouteErrorBoundary>
  );
}
