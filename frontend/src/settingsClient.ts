export type SettingsContext = {
  profile: { name: string; email: string; phone: string; employee_no: string; position: string; company_name: string; organization_path: string[]; manager_name: string; managed: boolean };
  brands: Array<{ id: string; label: string }>;
  mailboxes: Array<{ id: string; email: string; brand: string; status: string; is_default: boolean }>;
  preferences: Record<string, unknown>;
  editable_fields: string[];
};
export type SettingsSession = { id: string; title: string; archived_at: string | null };

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

/** Only reviewed business messages reach the settings UI; never raw transport errors. */
export function settingsError(error: unknown, fallback = '操作未完成，请重试。'): string {
  const value = error instanceof Error ? error.message : String(error || '');
  if (messages[value]) return messages[value];
  for (const [code, label] of Object.entries(messages)) {
    if (value.includes(`"code":"${code}"`) || value.includes(`"code": "${code}"`)) return label;
  }
  return fallback;
}

async function read<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new Error(response.status === 401 ? 'authentication required' : 'settings_read_failed');
  return response.json() as Promise<T>;
}
export const settingsClient = {
  context: () => read<SettingsContext>('/api/me/settings-context'),
  sessions: () => read<SettingsSession[]>('/api/me/settings-sessions'),
};
