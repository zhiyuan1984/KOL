import { Navigate } from "react-router-dom";

/** Teams live on /agents?tab=teams so employees don't get a second catalog. */
export default function AgentTeams() {
  return <Navigate to="/agents?tab=teams" replace />;
}
