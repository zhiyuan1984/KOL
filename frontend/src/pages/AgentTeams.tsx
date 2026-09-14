import { Navigate } from "react-router-dom";

/** Teams / 专家团 are not an employee surface. Keep the old URL honest. */
export default function AgentTeams() {
  return <Navigate to="/agents" replace />;
}
