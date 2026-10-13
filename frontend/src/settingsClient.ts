export type SettingsContext = {
  profile: { name: string; email: string; phone: string; employee_no: string; position: string; company_name: string; organization_path: string[]; manager_name: string; managed: boolean };
  brands: Array<{ id: string; label: string }>;
  mailboxes: Array<{ id: string; email: string; brand: string; status: string; is_default: boolean }>;
  preferences: Record<string, unknown>;
  editable_fields: string[];
};
export type SettingsSession = { id: string; title: string; archived_at: string | null };

export type SettingsRecovery = 'retry' | 'contact_admin' | 'relogin' | 'none';
export type SettingsFailure = {
  kind: 'error' | 'info';
  summary: string;
  description?: string;
  recover: SettingsRecovery;
  retryable: boolean;
  requestId?: string;
};
export type SettingsRequestError = Error & { status?: number; payload?: unknown };

type FailureDefinition = Omit<SettingsFailure, 'requestId'>;

const messages: Record<string, string> = {
  'authentication required': '登录已失效，请重新登录。',
  'invalid email': '请填写有效邮箱。',
  'email already used': '这个邮箱已用于其他账号。',
  '请填写有效邮箱': '请填写有效邮箱。',
  '请填写有效手机号': '请填写有效手机号。',
  'current password incorrect': '当前密码不正确。',
  'incorrect current password': '当前密码不正确。',
  'current password is incorrect': '当前密码不正确。',
  'password too short': '新密码至少需要10个字符。',
  'memory owner required': '你没有修改这条记忆的权限。',
  'profile_managed': '企业身份由管理员维护，不能在这里修改。',
  'settings_brand_not_allowed': '该品牌不可用，请重新选择。',
  'settings_mailbox_not_allowed': '该邮箱不可用，请重新选择。',
  'settings_mailbox_brand_mismatch': '邮箱与所选品牌不匹配，请重新选择。',
  'starrykol_login_required': '业务邮箱连接已失效，请联系管理员恢复连接后重试。',
};

const failures: Record<string, FailureDefinition> = {
  authentication_required: { kind: 'error', summary: '登录已失效，请重新登录。', description: '请重新登录后再试。', recover: 'relogin', retryable: false },
  starry_connector_verification_failed: { kind: 'error', summary: '业务邮箱服务暂不可用。', description: '组织邮箱服务在上次检查失败后暂停使用，本次未读取邮箱列表。请联系管理员检查并恢复服务。', recover: 'contact_admin', retryable: false },
  runtime_connector_disabled: { kind: 'error', summary: '业务邮箱服务已暂停使用。', description: '请联系管理员核对服务停用状态，重新读取不会自动恢复服务。', recover: 'contact_admin', retryable: false },
  runtime_connector_not_configured: { kind: 'error', summary: '业务邮箱服务尚未配置。', description: '暂时不能读取可用邮箱，请联系管理员开通服务后再试。', recover: 'contact_admin', retryable: false },
  starrykol_not_configured: { kind: 'error', summary: '邮箱服务尚未准备好。', description: '暂时不能读取可用邮箱，请联系管理员完成服务准备后再试。', recover: 'contact_admin', retryable: false },
  starry_mock_runtime_forbidden: { kind: 'error', summary: '业务邮箱服务配置不可用。', description: '当前服务未使用真实连接，请联系管理员恢复；未读取真实邮箱。', recover: 'contact_admin', retryable: false },
  runtime_remote_unauthorized: { kind: 'error', summary: '邮箱服务拒绝认证。', description: '请联系管理员核对连接凭据；此错误不表示本平台登录失效。', recover: 'contact_admin', retryable: false },
  runtime_remote_forbidden: { kind: 'error', summary: '当前账号无权读取这些邮箱。', description: '请联系管理员核对邮箱访问权限。', recover: 'contact_admin', retryable: false },
  runtime_remote_not_found: { kind: 'error', summary: '邮箱服务暂时无法访问。', description: '所需服务暂时无法访问，请联系管理员处理后再试。', recover: 'contact_admin', retryable: false },
  runtime_remote_rejected: { kind: 'error', summary: '邮箱服务拒绝本次请求。', description: '请联系管理员核对服务连接与请求格式，不要修改个人邮箱密码。', recover: 'contact_admin', retryable: false },
  runtime_remote_rate_limited: { kind: 'error', summary: '邮箱服务访问频率受限。', description: '请稍后重新读取可用邮箱。', recover: 'retry', retryable: true },
  runtime_remote_unavailable: { kind: 'error', summary: '邮箱服务暂时不可用。', description: '请稍后重新读取可用邮箱，持续失败请联系管理员。', recover: 'retry', retryable: true },
  runtime_remote_timeout: { kind: 'error', summary: '读取邮箱超时。', description: '读取未在预期时间内完成，请稍后重新读取可用邮箱。', recover: 'retry', retryable: true },
  runtime_remote_unreachable: { kind: 'error', summary: '邮箱服务未返回可用响应。', description: '暂时无法连接服务，请稍后重新读取可用邮箱。', recover: 'retry', retryable: true },
  runtime_remote_failed: { kind: 'error', summary: '邮箱服务暂时不可用。', description: '请稍后重新读取可用邮箱，持续失败请联系管理员。', recover: 'retry', retryable: true },
  starrykol_login_required: { kind: 'error', summary: '业务邮箱认证已失效。', description: '请恢复业务邮箱连接后再重新读取；如无法恢复，请联系管理员。', recover: 'contact_admin', retryable: false },
  starrykol_api_key_required: { kind: 'error', summary: '业务邮箱服务认证配置不可用。', description: '请联系管理员检查服务认证配置；无需修改个人邮箱密码。', recover: 'contact_admin', retryable: false },
  starrykol_bad_gateway: { kind: 'error', summary: '邮箱服务返回无效响应。', description: '请联系管理员核对服务响应。', recover: 'contact_admin', retryable: false },
  starry_mailbox_business_rejected: { kind: 'error', summary: '邮箱服务未接受本次读取。', description: '请联系管理员核对服务返回说明。', recover: 'contact_admin', retryable: false },
  starry_mailbox_unavailable: { kind: 'error', summary: '读取邮箱未完成，原因尚未确认。', description: '请稍后重试或联系管理员。', recover: 'retry', retryable: true },
  starry_credential_migration_required: { kind: 'error', summary: '邮箱服务需要管理员处理。', description: '请联系管理员处理服务认证后再重新读取。', recover: 'contact_admin', retryable: false },
  starry_mailbox_empty: { kind: 'info', summary: '当前没有可连接的邮箱。', description: '已读取当前可用邮箱，但没有可连接的邮箱。请联系管理员核对账号。', recover: 'none', retryable: false },
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function parseObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string' || value.length > 8_192) return null;
  try { return asRecord(JSON.parse(value)); } catch { return null; }
}

function problemFrom(value: unknown, depth = 0): { code?: string; requestId?: string } {
  if (depth > 3) return {};
  const record = asRecord(value) || parseObject(value);
  if (!record) return {};
  const detail = problemFrom(record.detail, depth + 1);
  if (detail.code) return detail;
  const code = typeof record.code === 'string'
    ? record.code
    : typeof record.error_code === 'string'
      ? record.error_code
      : undefined;
  const requestId = typeof record.request_id === 'string' && uuidPattern.test(record.request_id)
    ? record.request_id
    : undefined;
  return { code, requestId };
}

function legacyMessage(error: unknown): string | undefined {
  if (error instanceof Error && messages[error.message]) return error.message;
  return typeof error === 'string' && messages[error] ? error : undefined;
}

function legacyFailure(message: string): FailureDefinition {
  if (message === 'authentication required') return failures.authentication_required;
  return { kind: 'error', summary: messages[message], recover: 'none', retryable: false };
}

/** Only reviewed local copy and a UUID-shaped diagnostic identifier reach the settings UI. */
export function settingsFailure(error: unknown, fallback = '操作未完成，请重试。'): SettingsFailure {
  const record = asRecord(error);
  const payload = record && 'payload' in record ? record.payload : error;
  const problem = problemFrom(payload);
  const definition = problem.code && (failures[problem.code] || (messages[problem.code] ? legacyFailure(problem.code) : undefined) || (problem.code.startsWith('runtime_credential_')
    ? { kind: 'error', summary: '邮箱服务需要管理员处理。', description: '请联系管理员处理服务认证后再重新读取。', recover: 'contact_admin', retryable: false } satisfies FailureDefinition
    : undefined));
  if (definition) return { ...definition, ...(problem.requestId ? { requestId: problem.requestId } : {}) };

  const message = legacyMessage(error);
  if (message) return legacyFailure(message);

  const messageProblem = error instanceof Error ? problemFrom(error.message) : {};
  const messageDefinition = messageProblem.code && (failures[messageProblem.code] || (messages[messageProblem.code] ? legacyFailure(messageProblem.code) : undefined) || (messageProblem.code.startsWith('runtime_credential_')
    ? { kind: 'error', summary: '邮箱服务需要管理员处理。', description: '请联系管理员处理服务认证后再重新读取。', recover: 'contact_admin', retryable: false } satisfies FailureDefinition
    : undefined));
  if (messageDefinition) return { ...messageDefinition, ...(messageProblem.requestId ? { requestId: messageProblem.requestId } : {}) };

  return { kind: 'error', summary: fallback, recover: 'retry', retryable: true,
    ...(problem.requestId ? { requestId: problem.requestId } : {}) };
}

/** Compatibility wrapper for existing settings surfaces that only render a reviewed summary. */
export function settingsError(error: unknown, fallback = '操作未完成，请重试。'): string {
  return settingsFailure(error, fallback).summary;
}

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return {};
  try { return JSON.parse(text) as unknown; } catch { return undefined; }
}

async function read<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
  const payload = await readPayload(response);
  if (!response.ok) {
    const error = new Error(response.status === 401 ? 'authentication required' : 'settings_read_failed') as SettingsRequestError;
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  if (!payload || typeof payload !== 'object') throw new Error('settings_read_failed');
  return payload as T;
}
export const settingsClient = {
  context: () => read<SettingsContext>('/api/me/settings-context'),
  sessions: () => read<SettingsSession[]>('/api/me/settings-sessions'),
};
