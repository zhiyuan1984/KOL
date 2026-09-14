/**
 * MediaCrawler connectivity probe for Home AI发现.
 * 「已配置」= credentials present AND a live probe succeeded.
 * Never logs tokens or employee-facing URLs.
 */
import { mediaCrawlerConfigured } from "../config.js";
import { nowIso } from "../db.js";
import {
  COLLECTOR_CONNECT_MESSAGE,
  COLLECTOR_NOT_CONFIGURED_MESSAGE,
  isConnectionClassError,
} from "../discovery-errors.js";
import { RemoteMcpClient } from "../mcp/remote.js";
import type { Json } from "../types.js";

export type CollectorStatus = "not_configured" | "unchecked" | "unreachable" | "ok";

export type CollectorConnection = {
  status: CollectorStatus;
  credentials_present: boolean;
  reachable: boolean | null;
  connected: boolean | null;
  checked_at: string | null;
  message: string;
  status_label: string;
};

const STATUS_LABEL: Record<CollectorStatus, string> = {
  not_configured: "未配置",
  unchecked: "待检查",
  unreachable: "连接失败",
  ok: "已配置",
};

const STATUS_MESSAGE: Record<CollectorStatus, string> = {
  not_configured: COLLECTOR_NOT_CONFIGURED_MESSAGE,
  unchecked: "采集服务待检查",
  unreachable: COLLECTOR_CONNECT_MESSAGE,
  ok: "采集服务可用",
};

type ProbeClient = Pick<RemoteMcpClient, "listTools" | "close">;

let clientFactory: () => ProbeClient = () => new RemoteMcpClient({
  timeoutMs: probeTimeoutMs(),
});
let fetchImpl: typeof fetch = fetch;
let lastProbe: CollectorConnection | null = null;

export function setCollectorProbeClientFactory(factory?: () => ProbeClient): void {
  clientFactory = factory || (() => new RemoteMcpClient({ timeoutMs: probeTimeoutMs() }));
}

export function setCollectorProbeFetch(fn?: typeof fetch): void {
  fetchImpl = fn || fetch;
}

export function resetCollectorConnectionCache(): void {
  lastProbe = null;
}

export function probeTimeoutMs(): number {
  const n = Number(process.env.MEDIACRAWLER_PROBE_TIMEOUT_MS || "4000");
  if (!Number.isFinite(n) || n <= 0) return 4000;
  return Math.min(Math.max(n, 250), 10_000);
}

export function mediaCrawlerCredentialsPresent(): boolean {
  return mediaCrawlerConfigured();
}

function snapshot(status: CollectorStatus, extras: Partial<CollectorConnection> = {}): CollectorConnection {
  const credentials = extras.credentials_present ?? mediaCrawlerCredentialsPresent();
  const checked = extras.checked_at !== undefined ? extras.checked_at : nowIso();
  const reachable = extras.reachable !== undefined
    ? extras.reachable
    : status === "ok"
      ? true
      : status === "not_configured" || status === "unchecked"
        ? null
        : false;
  const connected = extras.connected !== undefined
    ? extras.connected
    : status === "ok"
      ? true
      : status === "not_configured" || status === "unchecked"
        ? null
        : false;
  return {
    status,
    credentials_present: credentials,
    reachable,
    connected,
    checked_at: checked,
    message: extras.message || STATUS_MESSAGE[status],
    status_label: extras.status_label || STATUS_LABEL[status],
  };
}

export function getCollectorConnectionSnapshot(): CollectorConnection {
  if (!mediaCrawlerCredentialsPresent()) {
    return snapshot("not_configured", { credentials_present: false, reachable: false, connected: false });
  }
  if (lastProbe) return lastProbe;
  return snapshot("unchecked", { credentials_present: true, reachable: null, connected: null, checked_at: null });
}

function mediaCrawlerUrl(): string {
  return String(process.env.MEDIACRAWLER_MCP_URL || "").trim();
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timeout`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function httpHostUp(url: string, timeoutMs: number): Promise<boolean> {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return false;
  }
  const targets = [`${origin}/health`, url];
  let sawNetworkFailure = false;
  for (const target of targets) {
    try {
      await fetchImpl(target, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      return true;
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      if (isConnectionClassError(text) || /abort|timeout/i.test(text)) {
        sawNetworkFailure = true;
        continue;
      }
      sawNetworkFailure = true;
    }
  }
  return !sawNetworkFailure;
}

async function mcpInitializeOk(timeoutMs: number): Promise<boolean> {
  const client = clientFactory();
  try {
    const tools = await withTimeout(client.listTools(), timeoutMs, "collector probe");
    return Array.isArray(tools);
  } finally {
    await client.close().catch(() => undefined);
  }
}

function warnProbe(reason: string): void {
  console.warn("[discovery.connection] probe failed", { status: "unreachable", reason });
}

export async function probeMediaCrawlerConnection(): Promise<CollectorConnection> {
  const checkedAt = nowIso();
  if (!mediaCrawlerCredentialsPresent()) {
    lastProbe = snapshot("not_configured", {
      credentials_present: false,
      reachable: false,
      connected: false,
      checked_at: checkedAt,
    });
    return lastProbe;
  }

  const timeoutMs = probeTimeoutMs();
  const url = mediaCrawlerUrl();
  try {
    const httpUp = await withTimeout(httpHostUp(url, timeoutMs), timeoutMs, "collector http");
    if (!httpUp) {
      warnProbe("http_unreachable");
      lastProbe = snapshot("unreachable", { credentials_present: true, reachable: false, connected: false, checked_at: checkedAt });
      return lastProbe;
    }
    const connected = await mcpInitializeOk(timeoutMs);
    if (!connected) {
      warnProbe("mcp_initialize_empty");
      lastProbe = snapshot("unreachable", { credentials_present: true, reachable: true, connected: false, checked_at: checkedAt });
      return lastProbe;
    }
    lastProbe = snapshot("ok", { credentials_present: true, reachable: true, connected: true, checked_at: checkedAt });
    return lastProbe;
  } catch (error) {
    const reason = isConnectionClassError(error) ? "mcp_unreachable" : "probe_failed";
    warnProbe(reason);
    lastProbe = snapshot("unreachable", { credentials_present: true, reachable: false, connected: false, checked_at: checkedAt });
    return lastProbe;
  }
}

export function publicCollectorConnection(row: CollectorConnection): Json {
  return {
    status: row.status,
    credentials_present: row.credentials_present,
    reachable: row.reachable,
    connected: row.connected,
    checked_at: row.checked_at,
    message: row.message,
    status_label: row.status_label,
  };
}
