import { Navigate, Route, Routes } from "react-router-dom";
import Workbench from "./layout/Workbench";
import Home from "./pages/Home";
import Chat from "./pages/Chat";
import Pipeline from "./pages/Pipeline";
import Approvals from "./pages/Approvals";
import Cron from "./pages/Cron";
import { Exam, Skills } from "./pages/SimplePages";
import Knowledge from "./pages/Knowledge";
import AuthGate from "./components/AuthGate";
import { ViewModeProvider } from "./viewMode";
import AccountSettings from "./pages/AccountSettings";
import AdminConsole from "./pages/AdminConsole";
import SharedSession from "./pages/SharedSession";
import { SkillHub } from "./pages/SkillHub";
import Agents from "./pages/Agents";
import AgentTeams from "./pages/AgentTeams";

export default function App() {
  return (
    <Routes>
      <Route path="/share/:token" element={<SharedSession />} />
      <Route path="*" element={<AuthGate><ViewModeProvider><Routes>
        <Route element={<Workbench />}>
          <Route path="/" element={<Home />} />
          <Route path="/work" element={<Navigate to="/" replace />} />
          <Route path="/s/:id" element={<Chat />} />
          <Route path="/pipeline" element={<Pipeline />} />
          <Route path="/cron" element={<Cron />} />
          <Route path="/skills" element={<Skills />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/teams" element={<AgentTeams />} />
          <Route path="/kb" element={<Knowledge />} />
          <Route path="/market/skills" element={<SkillHub view="catalog" />} />
          <Route path="/partners" element={<SkillHub view="partners" />} />
          <Route path="/market/kb" element={<Knowledge market />} />
          <Route path="/exam" element={<Exam />} />
          <Route path="/approvals" element={<Approvals />} />
          <Route path="/settings" element={<AccountSettings />} />
          <Route path="/admin/*" element={<AdminConsole />} />
        </Route>
      </Routes></ViewModeProvider></AuthGate>} />
    </Routes>
  );
}
