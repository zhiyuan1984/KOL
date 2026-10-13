import { afterEach, describe, expect, it, vi } from 'vitest';
import { settingsClient, settingsError, settingsFailure } from './settingsClient';
const requestId = '123e4567-e89b-42d3-a456-426614174000';
const structured = (code: string, extra: Record<string, unknown> = {}) => ({payload:{detail:{schema_version:'settings-error.v1',code,...extra}}});
describe('settings business error projection',()=>{
  it('maps reviewed business errors',()=>{
    expect(settingsError(new Error('authentication required'))).toBe('登录已失效，请重新登录。');
    expect(settingsError(new Error('{"code":"settings_mailbox_brand_mismatch"}'))).toBe('邮箱与所选品牌不匹配，请重新选择。');
  });
  it('distinguishes test-failed disablement, explicit disablement and missing config',()=>{
    const failure=settingsFailure(structured('starry_connector_verification_failed',{request_id:requestId}));
    expect(failure).toMatchObject({summary:'业务邮箱服务暂不可用。',recover:'contact_admin',requestId});
    expect(failure.description).toContain('上次检查失败后暂停');
    expect(settingsFailure(structured('runtime_connector_disabled')).summary).toBe('业务邮箱服务已暂停使用。');
    expect(settingsFailure(structured('runtime_connector_not_configured')).summary).toBe('业务邮箱服务尚未配置。');
    expect(settingsFailure(structured('starrykol_not_configured')).summary).toBe('邮箱服务尚未准备好。');
  });
  it('never treats a remote 401 as application login expiration',()=>{
    const failure=settingsFailure({status:401,...structured('runtime_remote_unauthorized')});
    expect(failure).toMatchObject({summary:'邮箱服务拒绝认证。',recover:'contact_admin'});
  });
  it.each([
    ['runtime_remote_rejected','邮箱服务拒绝本次请求。','contact_admin'],
    ['starry_mock_runtime_forbidden','业务邮箱服务配置不可用。','contact_admin'],
    ['runtime_remote_forbidden','当前账号无权读取这些邮箱。','contact_admin'],
    ['runtime_remote_rate_limited','邮箱服务访问频率受限。','retry'],
    ['runtime_remote_timeout','读取邮箱超时。','retry'],
    ['runtime_remote_unreachable','邮箱服务未返回可用响应。','retry'],
    ['starrykol_login_required','业务邮箱认证已失效。','contact_admin'],
    ['starrykol_api_key_required','业务邮箱服务认证配置不可用。','contact_admin'],
    ['starry_mailbox_business_rejected','邮箱服务未接受本次读取。','contact_admin'],
    ['starrykol_bad_gateway','邮箱服务返回无效响应。','contact_admin'],
  ])('projects %s distinctly',(code,summary,recover)=>expect(settingsFailure(structured(code))).toMatchObject({summary,recover}));
  it('accepts nested payloads and bounded JSON compatibility, not provider messages',()=>{
    expect(settingsFailure(structured('starry_mailbox_empty',{request_id:requestId}))).toMatchObject({kind:'info',requestId});
    expect(settingsFailure(new Error(`{"detail":{"code":"runtime_credential_decryption_failed","request_id":"${requestId}"}}`))).toMatchObject({summary:'邮箱服务需要管理员处理。',requestId});
  });
  it('never echoes raw exceptions, unknown messages, secrets or malformed IDs',()=>{
    for (const value of ['Authorization: Bearer secret','/srv/app/private.key','postgres schema stack trace','<img src=x onerror=alert("secret")>']) expect(settingsError(new Error(value),'安全兜底。')).toBe('安全兜底。');
    expect(settingsFailure(structured('unknown_code',{message:'<b>secret=TOP-SECRET</b>',request_id:'not-a-uuid'}),'安全兜底。')).toEqual({kind:'error',summary:'安全兜底。',recover:'retry',retryable:true});
  });
});
describe('settings client reads',()=>{
  afterEach(()=>vi.unstubAllGlobals());
  it('retains parsed payload and status on non-success',async()=>{
    const payload={detail:{code:'starry_connector_verification_failed',message:'Authorization: Bearer SECRET'}};
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,status:503,text:async()=>JSON.stringify(payload)}));
    await expect(settingsClient.context()).rejects.toMatchObject({status:503,payload});
  });
});
