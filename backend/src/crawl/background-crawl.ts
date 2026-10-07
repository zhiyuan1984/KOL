/**
 * 后台采集通道：平台主体（system:platform-sync）的专用调用路径。
 *
 * 授权依据：ADR-2026-10-08（用户明确指令：发现搜索必须每天定时跑；定时任务的
 * 发布即 CONST-05「明确授权覆盖已定义范围内的自动任务」）。
 *
 * 与员工通道的区别（窄口径例外，有意为之）：
 * - 不校验「技能装配在可用 Agent 上」的人员使用资格——平台同步 Agent 按
 *   bootstrap 显式只装只读技能（side_effects === "none"，见 runtime/store.ts
 *   bootstrapPlatformSync），crawler_collect 永远不会被装配上去；
 * - 保留的闸门：工具参数口径校验（与交互式 validateStart 同口径）、连接器
 *   「已启用 + 已配置」校验、采集排队 FIFO、同一时间只跑一个采集的不变量、
 *   运行回执诚实（成功/跳过如实记录，不伪造）。
 * - 定时跑只产候选：绝不自动创建 Collaboration、不做排他认领（BIZ-05 铁律）。
 *
 * 连接器配置读取说明：连接器配置表目前只在 SQLite 兼容层维护，PG 侧无镜像；
 * 此处是与 runtime action gate 完全相同的显式只读基础设施配置读取（非业务
 * 数据、非静默回退），不是 cron 模块治理所禁止的「悄悄走业务仓储兼容层」。
 */
import { HttpFail } from "../host/errors.js";
import { getConn } from "../db.js";
import { getConnectorConfig, type ConnectorConfig } from "../runtime/store.js";
import { createConfiguredClient, type RuntimeContext, type RuntimeRemote } from "../runtime/execution.js";
import { RemoteMcpClient, type RemoteMcpOptions } from "../mcp/remote.js";
import {
  isPlatformAgent,
  isPlatformPrincipal,
  PLATFORM_PRINCIPAL,
  PLATFORM_SYNC_AGENT,
} from "../runtime/platform-principal.js";
import { START_FIELDS } from "./tool-contract.js";
import type { Json, Row } from "../types.js";

export const BACKGROUND_CRAWL_SKILL = "crawler_collect";
const CRAWL_PLATFORMS = ["youtube", "instagram", "facebook"];
const CRAWL_MODES = ["search", "detail", "creator"];

const fail = (code: string, status = 409): never => {
  throw new HttpFail(status, { code });
};

/** 后台采集的执行身份：平台系统主体 + 平台系统智能体 + 采集技能声明。 */
export function backgroundCrawlContext(runRef: string): RuntimeContext {
  return {
    agentId: PLATFORM_SYNC_AGENT,
    skillId: BACKGROUND_CRAWL_SKILL,
    userId: PLATFORM_PRINCIPAL,
    runId: runRef,
  };
}

/**
 * 采集工具参数口径校验：与交互式 validateStart（runtime-gates.ts）同口径，
 * 只做参数合法性，不做身份校验，供两条通道共用。
 */
export function assertBackgroundCrawlArgs(args: Json): void {
  if (
    !Array.isArray(args.platforms) ||
    args.platforms.length !== 1 ||
    !CRAWL_PLATFORMS.includes(String(args.platforms[0]))
  ) {
    fail("runtime_crawl_platform_invalid");
  }
  if (!CRAWL_MODES.includes(String(args.crawler_type))) fail("runtime_crawl_mode_invalid");
  // Additional remote switches may enable uploads or broaden scope; only reviewed fields are accepted.
  if (Object.keys(args).some((key) => !START_FIELDS.includes(key))) fail("runtime_crawl_scope_invalid");
  if (
    args.max_notes_count !== undefined &&
    (!Number.isSafeInteger(args.max_notes_count) ||
      Number(args.max_notes_count) < 1 ||
      Number(args.max_notes_count) > 10000)
  ) {
    fail("runtime_crawl_scope_invalid");
  }
  if (
    ["enable_comments", "enable_sub_comments"].some((key) => args[key] !== undefined && args[key] !== false)
  ) {
    fail("runtime_crawl_scope_invalid");
  }
  const required =
    args.crawler_type === "search"
      ? "keywords"
      : args.crawler_type === "detail"
        ? "specified_ids"
        : "creator_ids";
  if (typeof args[required] !== "string" || !String(args[required]).trim()) {
    fail("runtime_crawl_input_required");
  }
}

export type CrawlConnectorAuth = {
  configuration: { config: ConnectorConfig; version: number };
  connector: Row;
};

/**
 * 采集连接器可用性校验：连接器行已启用 + 配置存在（含服务地址）。
 * 组织级凭据可被平台主体解析；个人账号凭据会如实失败（见 ADR-2026-10-06）。
 */
export function assertCrawlConnectorAvailable(): CrawlConnectorAuth {
  const connector = getConn().prepare("SELECT id,enabled,updated_at FROM connectors WHERE id=?").get("claw") as
    | Row
    | undefined;
  if (!connector?.enabled) {
    throw new HttpFail(409, { code: "runtime_connector_disabled" });
  }
  const configuration = getConnectorConfig("claw");
  if (!configuration) {
    throw new HttpFail(409, { code: "runtime_connector_not_configured" });
  }
  if (!configuration.config.url) {
    throw new HttpFail(503, { code: "crawl_capability_unavailable" });
  }
  return { configuration, connector };
}

/**
 * 后台调用方授权：仅平台主体可用；免除「技能装配在可用 Agent 上」的人员
 * 使用资格校验（平台同步 Agent 只读装配是既有治理，本通道不触碰它），
 * 连接器「已启用 + 已配置」校验保留。
 */
export function authorizeBackgroundCrawl(context: RuntimeContext): CrawlConnectorAuth {
  if (!isPlatformPrincipal(context.userId) || !isPlatformAgent(context.agentId)) {
    fail("runtime_agent_not_usable");
  }
  return assertCrawlConnectorAvailable();
}

/** 与 SkillExecution 的 {discover, invoke, close} 子集结构兼容的后台执行器。 */
export interface BackgroundToolInvoker {
  discover(): Promise<{
    tools: Array<{ connectorId: string; remoteName: string; exposed: Json }>;
  }>;
  invoke(name: string, args: Json): Promise<Json>;
  close(): Promise<void> | void;
}

const BACKGROUND_TOOLS = ["get_crawl_status", "get_creators"] as const;

/**
 * 直调连接器 MCP 工具的后台执行器：不经过「技能装配」发现（平台同步 Agent
 * 只装只读技能），直接按已登记的 claw 工具契约调用。调用前必须已完成
 * authorizeBackgroundCrawl（入队/出队时已做，出队只是履约）。
 */
export function backgroundToolRuntime(
  context: RuntimeContext,
  mcpFactory: (options: RemoteMcpOptions) => RuntimeRemote = (options) => new RemoteMcpClient(options),
): BackgroundToolInvoker {
  const { configuration } = authorizeBackgroundCrawl(context);
  const client = createConfiguredClient(context, configuration.config, mcpFactory);
  let closed = false;
  return {
    async discover() {
      return {
        tools: BACKGROUND_TOOLS.map((remoteName) => ({
          connectorId: "claw",
          remoteName,
          exposed: {
            name: remoteName,
            inputSchema: {
              type: "object",
              properties: { task_id: {}, offset: {}, limit: {}, platform: {} },
            },
          } as Json,
        })),
      };
    },
    async invoke(name: string, args: Json): Promise<Json> {
      if (closed) fail("runtime_run_closed", 410);
      if (!(BACKGROUND_TOOLS as readonly string[]).includes(name)) fail("runtime_tool_not_discovered");
      const raw = (await client.callToolRaw(name, args)) as unknown as Json;
      return raw;
    },
    async close() {
      closed = true;
      await client.close().catch(() => undefined);
    },
  };
}
