import { describe, expect, it } from 'vitest';
import { settingsError } from './settingsClient';
describe('settings business error projection', () => {
  it('maps reviewed business errors', () => {
    expect(settingsError(new Error('authentication required'))).toBe('登录已失效，请重新登录。');
    expect(settingsError(new Error('{"code":"settings_mailbox_brand_mismatch"}'))).toBe('邮箱与所选品牌不匹配，请重新选择。');
  });
  it('does not display raw internal exception details or secrets', () => {
    for (const value of ['Authorization: Bearer secret', '/srv/app/private.key', 'postgres schema stack trace', 'MCP tool failed token=secret']) {
      expect(settingsError(new Error(value), '保存失败，请重试。')).toBe('保存失败，请重试。');
    }
  });
});
