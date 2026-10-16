import { expect, request, test } from "@playwright/test";

const workspaceBody = (requestId) => ({
  request_id: requestId,
  text: "隔离运行时权限测试：发现北美露营候选",
  brief: {
    platforms: ["youtube"],
    region: "na",
    directions: [],
    keywords: ["camping"],
    min_followers: 100,
    max_followers: 20_000,
    min_avg_plays_10: 100,
    expect_count: 10,
  },
});

test("native runtime fixture normal principal has persisted Agent authority", async ({ request: authenticatedRequest }) => {
  const status = await authenticatedRequest.get("/api/auth/status");
  expect(status.ok(), await status.text()).toBeTruthy();
  const body = await status.json();
  expect(body).toMatchObject({
    authenticated: true,
    account: { id: "native-runtime-huang-qiyou", username: "native-runtime-huang-qiyou" },
    permissions: { admin: false },
  });
  expect(body.permissions.demo).toBeFalsy();
  expect(body.permissions.skills).toContain("crawler_collect");

  const workspace = await authenticatedRequest.post("/api/home/discovery/workspace", {
    data: workspaceBody(`native-runtime-positive-${Date.now()}`),
  });
  expect(workspace.status(), await workspace.text()).toBe(201);
  expect(await workspace.json()).toMatchObject({ pending: { agent_id: "agent:kol" } });
});

test("native runtime fixture keeps an unbound normal account at 403 runtime_agent_not_usable", async ({}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const unbound = await request.newContext({ baseURL });
  try {
    const login = await unbound.post("/api/auth/login", {
      data: { username: "native-runtime-unbound", password: "NativeRuntimeUnbound!2026" },
    });
    expect(login.ok(), await login.text()).toBeTruthy();
    const status = await unbound.get("/api/auth/status");
    expect(status.ok(), await status.text()).toBeTruthy();
    const identity = await status.json();
    expect(identity).toMatchObject({
      authenticated: true,
      account: { id: "native-runtime-unbound", username: "native-runtime-unbound" },
      permissions: { admin: false },
    });
    expect(identity.permissions.demo).toBeFalsy();

    const denied = await unbound.post("/api/home/discovery/workspace", {
      data: workspaceBody(`native-runtime-unbound-${Date.now()}`),
    });
    expect(denied.status(), await denied.text()).toBe(403);
    expect(await denied.json()).toMatchObject({ detail: { code: "runtime_agent_not_usable" } });
  } finally {
    await unbound.dispose();
  }
});
