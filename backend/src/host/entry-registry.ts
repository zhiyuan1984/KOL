/**
 * Home 入口登记 — 与 frontend/src/home/entryRegistry.ts 同构。
 * CONST-07 / PROD-AGENT-01 / UX-03 / TECH-ARCH-02
 * design §4：切 Tab 不得创建 session；retry-discovery-run = command。
 *
 * think   = Codex 思考流程（允许 thread/turn/model）
 * memory  = 快捷查询，零 thread / 零 turn / 零 model
 * command = 已明确的受控业务动作
 * cron    = 已发布后台流程；Home 本页不新增
 *
 * GET /api/home/board · GET /api/tasks · GET /api/home/following ·
 * GET /api/home/discovery/runs · GET /api/home/discovery/runs/:id ·
 * GET /api/home/discovery/runs/:id/candidates
 * 不得 INSERT sessions。
 */

export type HomeEntryKind = "think" | "memory" | "command" | "cron";

export type HomeEntry = {
  id: string;
  kind: HomeEntryKind;
  action: string;
  creates_session: boolean;
  creates_turn: boolean;
  calls_model: boolean;
  route: string;
};

export const HOME_COMPOSER_COPY = "让 Agent 分析/安排";
export const HOME_HANDOFF_TO_AGENT = "交给 Agent";

export const HOME_ENTRY_REGISTRY: readonly HomeEntry[] = [
  {
    id: "switch-tab",
    kind: "memory",
    action: "切换 Tab / 改 ?tab=",
    creates_session: false,
    creates_turn: false,
    calls_model: false,
    route: "GET 前端路由",
  },
  {
    id: "pull-board",
    kind: "memory",
    action: "拉取 / 刷新 Home board",
    creates_session: false,
    creates_turn: false,
    calls_model: false,
    route: "GET /api/home/board",
  },
  {
    id: "list-todos",
    kind: "memory",
    action: "未了结工作列表",
    creates_session: false,
    creates_turn: false,
    calls_model: false,
    route: "GET /api/tasks?view=open · GET /api/home/board → workbench.open",
  },
  {
    id: "list-followed",
    kind: "memory",
    action: "我跟进的红人",
    creates_session: false,
    creates_turn: false,
    calls_model: false,
    route: "GET /api/home/following",
  },
  {
    id: "list-pool",
    kind: "memory",
    action: "公海红人",
    creates_session: false,
    creates_turn: false,
    calls_model: false,
    route: "GET /api/home/pool",
  },
  {
    id: "existing-discovery",
    kind: "memory",
    action: "已有发现运行 / 结果",
    creates_session: false,
    creates_turn: false,
    calls_model: false,
    route: "GET /api/home/discovery/runs · GET /api/home/discovery/runs/:id · GET /api/home/discovery/runs/:id/candidates",
  },
  {
    id: "open-discovery-template",
    kind: "memory",
    action: "开始发现 / 预填发现模板",
    creates_session: false,
    creates_turn: false,
    calls_model: false,
    route: "FE Composer prefill · GET /api/home/discovery/template",
  },
  {
    id: "composer-analyze",
    kind: "think",
    action: HOME_COMPOSER_COPY,
    creates_session: true,
    creates_turn: true,
    calls_model: true,
    route: "POST /api/tasks/from-text → POST /api/tasks/:id/run",
  },
  {
    id: "new-discovery",
    kind: "think",
    action: "提交发现任务",
    creates_session: true,
    creates_turn: true,
    calls_model: true,
    route: "POST /api/home/discovery/run",
  },
  {
    id: "retry-discovery-run",
    kind: "command",
    action: "重试发现采集",
    creates_session: false,
    creates_turn: false,
    calls_model: false,
    route: "POST /api/home/discovery/run",
  },
  {
    id: "acknowledge-task",
    kind: "command",
    action: "打开今日任务 / 记录处理",
    creates_session: false,
    creates_turn: false,
    calls_model: false,
    route: "POST /api/tasks/:id/acknowledge",
  },
  {
    id: "adopt-recommendation",
    kind: "command",
    action: "采纳推荐 → 正式待办",
    creates_session: false,
    creates_turn: false,
    calls_model: false,
    route: "POST /api/tasks/adopt-recommendation",
  },
  {
    id: "follow-candidate",
    kind: "command",
    action: "确认加入跟进",
    creates_session: false,
    creates_turn: false,
    calls_model: false,
    route: "POST /api/discovery/candidates/:id/follow",
  },
  {
    id: "discovery-ingest",
    kind: "command",
    action: "L3 确认入库公海（不领取跟进）",
    creates_session: false,
    creates_turn: false,
    calls_model: false,
    route: "POST /api/home/discovery/ingest",
  },
  {
    id: "claim-kol",
    kind: "command",
    action: "L3 领取公海正式档案",
    creates_session: false,
    creates_turn: false,
    calls_model: false,
    route: "POST /api/kols/:kolUid/claim",
  },
  {
    id: "release-follow",
    kind: "command",
    action: "L3 释放跟进",
    creates_session: false,
    creates_turn: false,
    calls_model: false,
    route: "POST /api/follows/:followId/release",
  },
  {
    id: "kol-analyze-enqueue",
    kind: "think",
    action: "锁定 kol_analyze 入队（禁止 from-text 意图识别）",
    creates_session: false,
    creates_turn: false,
    calls_model: false,
    route: "POST /api/home/kol-analyze/enqueue",
  },
  {
    id: "confirm-stage",
    kind: "command",
    action: "确认阶段变更",
    creates_session: false,
    creates_turn: false,
    calls_model: false,
    route: "L3 ConfirmStage（既有会话或打开已有任务）",
  },
  {
    id: "confirm-send",
    kind: "command",
    action: "确认发送",
    creates_session: false,
    creates_turn: false,
    calls_model: false,
    route: "既有 L3 发信确认（本页不新开发送闸门）",
  },
] as const;

export function publicEntryRegistry(): HomeEntry[] {
  return HOME_ENTRY_REGISTRY.map((row) => ({ ...row }));
}
