import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import Workbench from "./layout/Workbench";
// Home and Mail are the two landings: keep them in the entry chunk so a page
// load never costs an extra round trip on a slow link.
import Home from "./pages/Home";
import Mail from "./pages/Mail";
import AuthGate from "./components/AuthGate";
import { ViewModeProvider } from "./viewMode";

/** Route-level code splitting: /mail must not download /skills, /exam, … */
const Chat = lazy(() => import("./pages/Chat"));
const Pipeline = lazy(() => import("./pages/Pipeline"));
const Approvals = lazy(() => import("./pages/Approvals"));
const Cron = lazy(() => import("./pages/Cron"));
const SkillCatalog = lazy(() =>
  import("./pages/SkillCatalog").then((m) => ({ default: m.SkillCatalog })));
const SkillLifecycle = lazy(() => import("./pages/SkillLifecycle"));
const Exam = lazy(() => import("./pages/Exam"));
const Knowledge = lazy(() => import("./pages/Knowledge"));
const AccountSettings = lazy(() => import("./pages/AccountSettings"));
const ConnectorUse = lazy(() => import("./pages/ConnectorUse"));
const AdminConsole = lazy(() => import("./pages/AdminConsole"));
const SharedSession = lazy(() => import("./pages/SharedSession"));
const SkillHub = lazy(() => import("./pages/SkillHub").then((m) => ({ default: m.SkillHub })));
const Partners = lazy(() => import("./pages/Partners"));
const Agents = lazy(() => import("./pages/Agents"));
const AgentTeams = lazy(() => import("./pages/AgentTeams"));

function RouteFallback() {
  return <p className="muted" style={{ padding: 24 }} data-route-loading>加载中…</p>;
}

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/share/:token" element={<SharedSession />} />
        <Route path="*" element={<AuthGate><ViewModeProvider><Suspense fallback={<RouteFallback />}><Routes>
          <Route element={<Workbench />}>
            <Route path="/" element={<Home />} />
            <Route path="/work" element={<Navigate to="/" replace />} />
            <Route path="/s/:id" element={<Chat />} />
            <Route path="/pipeline" element={<Pipeline />} />
            <Route path="/cron" element={<Cron />} />
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
            <Route path="/settings" element={<AccountSettings />} />
            <Route path="/connectors" element={<ConnectorUse />} />
            <Route path="/admin/*" element={<AdminConsole />} />
          </Route>
        </Routes></Suspense></ViewModeProvider></AuthGate>} />
      </Routes>
    </Suspense>
  );
}
