/**
 * Home 入口登记 — 与 frontend/src/home/entryRegistry.ts 同构。
 * CONST-07 / PROD-AGENT-01 / UX-03 / TECH-ARCH-02
 *
 * think   = Codex 思考流程（允许 thread/turn/model）
 * memory  = 快捷查询，零 thread / 零 turn / 零 model
 * command = 已明确的受控业务动作
 * cron    = 已发布后台流程；Home 本页不新增
 *
 * GET /api/home/board · GET /api/tasks · GET /api/home/following ·
 * GET /api/discovery/requests/:id/results 不得 INSERT sessions。
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
    route: "GET /api/home/following · GET /api/home/board → kols",
  },
  {
    id: "existing-discovery",
    kind: "memory",
    action: "已有发现批次 / 结果",
    creates_session: false,
    creates_turn: false,
    calls_model: false,
    route: "GET /api/discovery/requests · GET /api/discovery/requests/:id/results",
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
    action: "新发现分析（确认后开 Run）",
    creates_session: false,
    creates_turn: false,
    calls_model: false,
    route: "POST /api/discovery/requests/:id/runs",
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
