import fs from "node:fs";
import { Hono } from "hono";
import { expertAvatarPath } from "../experts.js";
import { HttpFail } from "../host/errors.js";
import { employeeExperts, employeeExpert, summonEmployeeAgent } from "../runtime/employee-agents.js";
import { employeeAgentPreferences, employeeAgentWorkspace, updateEmployeeAgentPreference, resumeEmployeeAgentSession } from "../agents/employee-workspace.js";
import { employeeAgentBrowse } from "../agents/employee-browse.js";

export const experts = new Hono();

experts.get("/experts", (c) => c.json(employeeExperts()));
experts.get("/experts/browse", async (c) => c.json(await employeeAgentBrowse()));

experts.get("/experts/preferences", async (c) => c.json(await employeeAgentPreferences()));
experts.get("/experts/:id/workspace", async (c) => c.json(await employeeAgentWorkspace(c.req.param("id"), c.req.query("session_id"))));
experts.patch("/experts/:id/preference", async (c) => c.json(await updateEmployeeAgentPreference(c.req.param("id"), await c.req.json())));
experts.post("/experts/:id/resume", async (c) => {
  const body = await c.req.json<{ session_id?: unknown }>();
  if (typeof body?.session_id !== "string" || !body.session_id.trim()) throw new HttpFail(422, { code: "agent_session_required", message: "请选择原会话" });
  return c.json(await resumeEmployeeAgentSession(c.req.param("id"), body.session_id));
});

experts.get("/experts/:id/avatar", (c) => {
  employeeExpert(c.req.param("id"));
  const file = expertAvatarPath(c.req.param("id"));
  if (!fs.existsSync(file)) throw new HttpFail(404, { code: "expert_not_found", message: "未找到该专家" });
  c.header("Content-Type", "image/svg+xml; charset=utf-8");
  c.header("Cache-Control", "public, max-age=3600");
  return c.body(Uint8Array.from(fs.readFileSync(file)));
});

experts.get("/experts/:id", (c) => c.json(employeeExpert(c.req.param("id"))));

experts.post("/experts/:id/summon", (c) => c.json(summonEmployeeAgent(c.req.param("id"))));
