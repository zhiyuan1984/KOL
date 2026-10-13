import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { HttpFail } from '../host/errors.js';
import { runtimeErrorCode } from '../runtime/execution.js';
import { RemoteToolFailure } from '../mcp/tool-failure.js';
import type { Json } from '../types.js';

export type MailboxPhase = 'preflight' | 'credential_resolution' | 'remote_request' | 'decode';
export type MailboxTrace = { requestId: string; occurredAt: string; phase: MailboxPhase; upstreamAttempted: boolean };
const scope = new AsyncLocalStorage<MailboxTrace>();
export function newMailboxTrace(): MailboxTrace {
  return { requestId: randomUUID(), occurredAt: new Date().toISOString(), phase: 'preflight', upstreamAttempted: false };
}
export function withMailboxTrace<T>(trace: MailboxTrace, fn: () => T): T { return scope.run(trace, fn); }
export function markMailboxPhase(phase: MailboxPhase): void {
  const trace = scope.getStore();
  if (trace) { trace.phase = phase; if (phase === 'remote_request') trace.upstreamAttempted = true; }
}

type FailureSpec = { status: number; message: string; category: string; retryable: boolean; recovery: string };
const failures: Record<string, FailureSpec> = {
  authentication_required: { status: 401, message: '登录已失效，请重新登录。', category: 'authentication', retryable: false, recovery: 'login' },
  runtime_connector_not_configured: { status: 503, message: '业务邮箱服务尚未配置，请联系管理员开通。', category: 'configuration', retryable: false, recovery: 'contact_admin' },
  starrykol_not_configured: { status: 503, message: '业务邮箱服务尚未就绪，请联系管理员检查。', category: 'configuration', retryable: false, recovery: 'contact_admin' },
  runtime_connector_disabled: { status: 503, message: '组织邮箱服务已暂停使用，请联系管理员。', category: 'service_unavailable', retryable: false, recovery: 'contact_admin' },
  starry_connector_verification_failed: { status: 503, message: '组织邮箱服务在上次检查失败后暂停使用，本次未读取邮箱列表。', category: 'service_unavailable', retryable: false, recovery: 'contact_admin' },
  starry_mock_runtime_forbidden: { status: 503, message: '业务邮箱服务不能在演示模式中执行，请联系管理员恢复真实连接。', category: 'configuration', retryable: false, recovery: 'contact_admin' },
  starrykol_login_required: { status: 401, message: '业务邮箱认证已失效，请恢复邮箱连接后重试。', category: 'authentication', retryable: false, recovery: 'restore_mailbox_auth' },
  starrykol_api_key_required: { status: 401, message: '业务邮箱服务认证配置不可用，请联系管理员检查。', category: 'authentication', retryable: false, recovery: 'contact_admin' },
  starry_credential_migration_required: { status: 409, message: '邮箱认证需要迁移到安全存储，请联系管理员处理。', category: 'credential', retryable: false, recovery: 'contact_admin' },
  runtime_remote_unauthorized: { status: 502, message: '邮箱服务拒绝认证，请联系管理员核对连接凭据。', category: 'authentication', retryable: false, recovery: 'contact_admin' },
  runtime_remote_forbidden: { status: 403, message: '当前账号无权读取这些邮箱。', category: 'permission', retryable: false, recovery: 'contact_admin' },
  runtime_remote_not_found: { status: 502, message: '邮箱服务端点不可用，请联系管理员检查。', category: 'response', retryable: false, recovery: 'contact_admin' },
  runtime_remote_rejected: { status: 502, message: '邮箱服务拒绝请求，请联系管理员检查。', category: 'response', retryable: false, recovery: 'contact_admin' },
  runtime_remote_rate_limited: { status: 429, message: '邮箱服务访问频率受限，请稍后重试。', category: 'rate_limit', retryable: true, recovery: 'retry_later' },
  runtime_remote_unavailable: { status: 502, message: '邮箱服务暂不可用，请稍后重试。', category: 'service_unavailable', retryable: true, recovery: 'retry_later' },
  runtime_remote_timeout: { status: 504, message: '读取邮箱超时，请稍后重试。', category: 'timeout', retryable: true, recovery: 'retry_later' },
  runtime_remote_unreachable: { status: 502, message: '邮箱服务未返回可用响应，请稍后重试。', category: 'network', retryable: true, recovery: 'retry_later' },
  starrykol_bad_gateway: { status: 502, message: '邮箱服务返回无效响应，请联系管理员检查。', category: 'response', retryable: false, recovery: 'contact_admin' },
  starry_mailbox_business_rejected: { status: 502, message: '邮箱服务未接受本次读取，请联系管理员核对。', category: 'business', retryable: false, recovery: 'contact_admin' },
  starry_mailbox_unavailable: { status: 502, message: '读取邮箱未完成，原因尚未确认。请稍后重试或联系管理员。', category: 'unknown', retryable: true, recovery: 'retry_later' },
};
const credentialCodes = [
  'runtime_credential_master_key_unavailable', 'runtime_credential_master_key_invalid',
  'runtime_credential_decryption_failed', 'runtime_credential_unavailable',
  'runtime_credential_provider_unavailable', 'runtime_credential_owner_mismatch',
  'runtime_credential_not_found', 'runtime_credential_disabled',
  'runtime_credential_access_denied', 'runtime_credential_account_required', 'runtime_credential_account_type_invalid',
];
for (const code of credentialCodes) failures[code] = {
  status: ['runtime_credential_owner_mismatch', 'runtime_credential_access_denied'].includes(code) ? 403 : 503,
  message: ['runtime_credential_owner_mismatch', 'runtime_credential_access_denied'].includes(code) ? '当前账号无权使用该邮箱认证。' : '服务认证暂不可用，请联系管理员检查。',
  category: 'credential', retryable: false, recovery: 'contact_admin',
};

export function mailboxFailure(error: unknown, trace: MailboxTrace): { status: number; detail: Json; diagnostic: Json } {
  let code = runtimeErrorCode(error);
  if (error instanceof HttpFail && error.detail === 'authentication required') code = 'authentication_required';
  if (error instanceof RemoteToolFailure) code = 'starry_mailbox_business_rejected';
  if (!failures[code]) code = 'starry_mailbox_unavailable';
  const spec = failures[code];
  const detail: Json = {
    schema_version: 'settings-error.v1', code, message: spec.message, category: spec.category,
    stage: trace.phase, retryable: spec.retryable, recovery: spec.recovery,
    request_id: trace.requestId, occurred_at: trace.occurredAt, upstream_attempted: trace.upstreamAttempted,
  };
  const diagnostic: Json = { ...detail, http_status: spec.status };
  if (error && typeof error === 'object') {
    const meta = error as { remoteStatus?: unknown; remoteRetryAfterMs?: unknown; upstreamCode?: unknown };
    if (typeof meta.remoteStatus === 'number' && Number.isInteger(meta.remoteStatus) && meta.remoteStatus >= 100 && meta.remoteStatus <= 599) diagnostic.upstream_status = meta.remoteStatus;
    if (typeof meta.upstreamCode === 'string' && (/^\d{1,20}$/.test(meta.upstreamCode) || ['starrykol_login_required', 'starrykol_api_key_required'].includes(meta.upstreamCode))) diagnostic.upstream_code = meta.upstreamCode;
    if (code === 'runtime_remote_rate_limited' && typeof meta.remoteRetryAfterMs === 'number' && Number.isFinite(meta.remoteRetryAfterMs) && meta.remoteRetryAfterMs >= 0 && meta.remoteRetryAfterMs <= 86400000) {
      detail.retry_after_ms = meta.remoteRetryAfterMs;
      diagnostic.retry_after_ms = meta.remoteRetryAfterMs;
    }
  }
  return { status: spec.status, detail, diagnostic };
}

/** Diagnostics contain only our DTO + explicitly allowed metadata, never provider headers/text/config. */
export function publicMailboxDiagnostic(value: Json): Json {
  const allowed = ['schema_version', 'request_id', 'occurred_at', 'code', 'message', 'category', 'stage', 'retryable', 'recovery',
    'upstream_attempted', 'http_status', 'upstream_status', 'upstream_code', 'retry_after_ms', 'config_version', 'duration_ms',
    'status', 'mailbox_count', 'connector_enabled', 'verification_status', 'last_error', 'last_verified_at'];
  return Object.fromEntries(allowed.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));
}
