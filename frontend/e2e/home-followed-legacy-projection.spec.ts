import { expect, test } from "@playwright/test";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

// These demo-only setup calls do not use authentication cookies. Playwright's
// global keep-alive agent can reuse a socket closed while another spec ran.
// A fresh connection prevents that race; no retry can replay a reset silently.
async function setupPost(baseURL: string, pathname: string, data: unknown) {
  const url = new URL(pathname, baseURL), body = JSON.stringify(data);
  await new Promise<void>((resolve, reject) => {
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const request = send(url, { method: "POST", agent: false, headers: {
      "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), Connection: "close",
    } }, response => {
      let text = ""; response.setEncoding("utf8"); response.on("data", chunk => { text += chunk; });
      response.on("error", reject); response.on("end", () => {
        try {
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) throw new Error(`Demo setup ${pathname} failed: HTTP ${response.statusCode}`);
          JSON.parse(text); resolve();
        } catch (error) { reject(error); }
      });
    });
    request.setTimeout(60000, () => request.destroy(new Error(`Demo setup ${pathname} timed out`)));
    request.on("error", reject); request.end(body);
  });
}

test.beforeEach(async ({ baseURL }) => {
  if (!baseURL) throw new Error("Explicit E2E baseURL is required");
  await setupPost(baseURL, "/api/demo/reset", { workbench: true });
  await setupPost(baseURL, "/api/me/persona", { persona: "sriphy" });
});

function followingEnvelope(kols: Array<Record<string, unknown>>) {
  return {
    entry: "memory",
    kind: "memory",
    creates_session: false,
    calls_model: false,
    index: "我的跟进",
    authority: "kol_follow_index+verified_starry_binding",
    completeness: "complete",
    follow_scope: {
      required: true,
      bound: true,
      mailbox_email: "larry.zhao@amperetime.com",
      mailbox_id: "mbx_larry",
      owner_name: "赵良玉",
      status: "connected",
      has_token: false,
      updated_at: null,
    },
    kols,
  };
}

test("我的红人正常显示 following 返回的已验证 Starry 历史记录", async ({ page }) => {
  const sessionPosts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.startsWith("/api/sessions")) {
      sessionPosts.push(new URL(request.url()).pathname);
    }
  });

  // board remains available to other Home surfaces, but it cannot authorize a
  // follow-list row or supplement this list.
  await page.route("**/api/home/board*", (route) => route.fulfill({
    json: {
      follow_scope: followingEnvelope([]).follow_scope,
      kols: [{
        id: "col_other_owner",
        kol_uid: "kol_other_owner",
        handle: "OtherOwnerOnly",
        display_name: "Other Owner Creator",
        platform: "YouTube",
        brand: "LT",
        stage_code: "INITIAL_CONTACT",
        stage_label: "初步接触",
        days_in_stage: 3,
        status: "active",
        owner_name: "其他负责人",
      }],
      workbench: {},
    },
  }));
  await page.route("**/api/home/following", (route) => route.fulfill({
    json: followingEnvelope([{
      id: "col_larry_starry",
      kol_uid: "kol_larry_starry",
      handle: "LarryFollowed",
      display_name: "Larry Followed Creator",
      platform: "YouTube",
      brand: "LT",
      stage_code: "INITIAL_CONTACT",
      stage_label: "初步接触",
      days_in_stage: 3,
      status: "active",
      source_kind: "starry_binding",
    }]),
  }));

  await page.goto("/");
  await page.locator('[data-home-mode="lifecycle"]').click();

  await expect(page.locator('[data-home-pane="lifecycle"]')).toBeVisible();
  // 总数只在中栏概览里；右栏工具行不重复一次计数。
  await expect(page.locator("[data-followed-overview-count]")).toHaveText("目前跟进了 1 位");
  await expect(page.locator("[data-followed-selected-count]")).toHaveCount(0);
  const list = page.locator("[data-followed-kol-list]");
  await expect(list).toBeVisible();
  await expect(list.locator('[data-followed-kol="LarryFollowed"]')).toBeVisible();
  await expect(list).toContainText("@LarryFollowed");
  await expect(list.locator('[data-followed-kol="OtherOwnerOnly"]')).toHaveCount(0);
  expect(sessionPosts).toEqual([]);
});

test("following 明确成功为空时绝不混入 board 的其他负责人记录", async ({ page }) => {
  await page.route("**/api/home/board*", (route) => route.fulfill({
    json: {
      follow_scope: followingEnvelope([]).follow_scope,
      kols: [{
        id: "col_other_owner",
        kol_uid: "kol_other_owner",
        handle: "OtherOwnerOnly",
        display_name: "Other Owner Creator",
        platform: "YouTube",
        stage_code: "INITIAL_CONTACT",
        stage_label: "初步接触",
        status: "active",
        owner_name: "其他负责人",
      }],
      workbench: {},
    },
  }));
  await page.route("**/api/home/following", (route) => route.fulfill({ json: followingEnvelope([]) }));

  await page.goto("/");
  await page.locator('[data-home-mode="lifecycle"]').click();

  await expect(page.locator('[data-follow-empty="mailbox"]')).toBeVisible();
  await expect(page.locator('[data-followed-kol="OtherOwnerOnly"]')).toHaveCount(0);
  await expect(page.locator("[data-followed-overview-count]")).toHaveText("目前跟进了 0 位");
});

test('demo setup transport never reuses an idle socket or retries a failed reset', async () => {
  const { createServer } = await import('node:http');let requests=0,connections=0;
  const server=createServer((_request,response)=>{requests++;response.writeHead(requests===3?503:200,{'Content-Type':'application/json'});response.end(JSON.stringify({ok:true}));});
  server.on('connection',()=>{connections++;});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const address=server.address();if(!address||typeof address==='string')throw new Error('Local fixture server did not bind');const base=`http://127.0.0.1:${address.port}`;
    await setupPost(base,'/api/demo/reset',{workbench:true});await setupPost(base,'/api/me/persona',{persona:'sriphy'});
    expect(requests).toBe(2);expect(connections).toBe(2);
    await expect(setupPost(base,'/api/demo/reset',{workbench:true})).rejects.toThrow('HTTP 503');
    expect(requests).toBe(3);expect(connections).toBe(3);
  } finally {await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
