import type { Hono } from "hono";
import { hashPassword } from "../../src/auth.js";
import { nowIso, postgresDb } from "../../src/postgres/access.js";
import { syncUserOrganization } from "../../src/runtime/organization-tree.js";
import { publishKnowledgeThroughNativeGovernance } from "./knowledge-governance-native.js";

/**
 * 使用 seed 中已存在且关联组织目录的 sriphy 身份完成真实登录。
 * 新原生 PG 知识分类事务会再次从 users 读取 admin 角色，因此不能依赖
 * AUTH_MODE=disabled 下仅存在于内存的演示管理员。
 */
export async function loginKnowledgeAdministrator(app: Hono): Promise<string> {
  const password = "knowledge-governance-test-password";
  await postgresDb().execute(
    `INSERT INTO users(id,username,name,password_hash,roles,brands,site,active,created_at,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,$8)
     ON CONFLICT(id) DO UPDATE SET username=EXCLUDED.username,name=EXCLUDED.name,password_hash=EXCLUDED.password_hash,
       roles=EXCLUDED.roles,brands=EXCLUDED.brands,site=EXCLUDED.site,active=1,updated_at=EXCLUDED.updated_at`,
    "sriphy",
    "sriphy",
    "鄢棽",
    await hashPassword(password),
    JSON.stringify(["employee", "admin"]),
    JSON.stringify(["LT", "RO", "PQ"]),
    "深圳站",
    nowIso(),
  );
  await syncUserOrganization("sriphy", "org:lt_team");
  const connectorStamp = nowIso();
  for (const [id, label] of [["starry", "Starry legacy adapter"], ["starrykol", "Starry KOL MCP"]]) {
    await postgresDb().execute(
      `INSERT INTO connectors(id,label,enabled,status,updated_at) VALUES($1,$2,1,'configured',$3)
       ON CONFLICT(id) DO UPDATE SET enabled=1,status='configured',updated_at=EXCLUDED.updated_at`,
      id,
      label,
      connectorStamp,
    );
    await postgresDb().execute(
      `INSERT INTO user_connector_grants(user_id,connector_id,access,created_at) VALUES($1,$2,'admin',$3)
       ON CONFLICT(user_id,connector_id) DO UPDATE SET access=EXCLUDED.access,created_at=EXCLUDED.created_at`,
      "sriphy",
      id,
      connectorStamp,
    );
  }
  const response = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "sriphy", password }),
  });
  if (response.status !== 200)
    throw new Error(`knowledge admin login failed: ${response.status} ${await response.text()}`);
  const cookie = response.headers.get("set-cookie")?.split(";")[0] || "";
  if (!cookie)
    throw new Error("knowledge admin login did not issue a session cookie");
  return cookie;
}

/** 创建与权威组织节点关联的普通员工，并通过真实 auth/login 取得会话。 */
export async function loginKnowledgeEmployee(app: Hono): Promise<string> {
  const password = "knowledge-employee-test-password";
  const now = nowIso();
  await postgresDb().execute(
    `INSERT INTO users(id,username,name,password_hash,roles,brands,site,active,created_at,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,$8)
     ON CONFLICT(id) DO UPDATE SET username=EXCLUDED.username,name=EXCLUDED.name,password_hash=EXCLUDED.password_hash,
       roles=EXCLUDED.roles,brands=EXCLUDED.brands,site=EXCLUDED.site,active=1,updated_at=EXCLUDED.updated_at`,
    "usr_lingong",
    "lingong",
    "林工",
    await hashPassword(password),
    JSON.stringify(["employee"]),
    JSON.stringify(["LT"]),
    "深圳站",
    now,
  );
  await syncUserOrganization("usr_lingong", "org:lt_team");
  const response = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "lingong", password }),
  });
  if (response.status !== 200)
    throw new Error(`knowledge employee login failed: ${response.status} ${await response.text()}`);
  const cookie = response.headers.get("set-cookie")?.split(";")[0] || "";
  if (!cookie)
    throw new Error("knowledge employee login did not issue a session cookie");
  return cookie;
}

/**
 * 走生产 native 发布链：确认、提交、评审、执行，返回持久化的发布版本。
 * 不直接写 published_version，也不伪造审批回执。
 */
export async function publishKnowledgeThroughApproval(knowledgeId: string) {
  return await publishKnowledgeThroughNativeGovernance(knowledgeId);
}
