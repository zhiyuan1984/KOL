import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { getConn, resetConn } from '../src/db.js';
import { HttpFail } from '../src/host/errors.js';
import { mapUser, withScopedUser } from '../src/auth.js';
import { misc } from '../src/routers/misc.js';
import { setConnectorConfig } from '../src/runtime/store.js';
import { createCredential } from '../src/runtime/credentials.js';
import { setStarryKolClientFactory } from '../src/starrykol/service.js';
import { starryKolConnectionHealth } from '../src/starrykol/connection.js';
import { RemoteToolFailure, explicitRemoteRejection } from '../src/mcp/tool-failure.js';
import { mailboxFailure, newMailboxTrace } from '../src/starrykol/probe-diagnostics.js';
import { normalizeMcpContent } from '../src/mcp/remote.js';
import { freshTestDatabase } from './support/pg.js';
import type { Json } from '../src/types.js';
let tmp = '';
let app: Hono;
let user: ReturnType<typeof mapUser>;
const previous = { AUTH_MODE: process.env.AUTH_MODE, CODEX_MODE: process.env.CODEX_MODE, LINGONG_DATA: process.env.LINGONG_DATA, RUNTIME_CREDENTIAL_MASTER_KEY: process.env.RUNTIME_CREDENTIAL_MASTER_KEY };
beforeEach(async () => {
  await freshTestDatabase();
  setStarryKolClientFactory(undefined);
  process.env.RUNTIME_CREDENTIAL_MASTER_KEY = '71'.repeat(32);
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mailbox-diagnostic-'));
  process.env.LINGONG_DATA = tmp;
  process.env.AUTH_MODE = 'enabled';
  process.env.CODEX_MODE = 'real';
  resetConn();
  const db = getConn();
  for (const [id, roles] of [['diag-admin', ['admin', 'employee']], ['diag-other', ['admin']], ['diag-employee', ['employee']]] as const) {
    db.prepare(`INSERT INTO users(id,username,name,password_hash,roles,brands,site,active,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id, id, id, 'not-for-login', JSON.stringify(roles), '[]', '', 1, 'now', 'now');
  }
  user = mapUser(db.prepare('SELECT * FROM users WHERE id=?').get('diag-admin') as never);
  app = new Hono();
  app.onError((error,c) => error instanceof HttpFail ? c.json({detail:error.detail}, error.status as 400|401|403|404|503) : c.json({detail:'unexpected'},500));
  app.route('/api', misc);
});
afterEach(() => {
  setStarryKolClientFactory(undefined);
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const [key,value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
function request(method: string, url: string, body?: unknown, actor = user) {
  return withScopedUser(actor, () => app.request(url, {method, headers:{'Content-Type':'application/json'}, ...(body === undefined ? {} : {body:JSON.stringify(body)})}));
}
function configure(enabled = false, status = 'verification_failed') {
  const db = getConn();
  if (!db.prepare("SELECT id FROM connectors WHERE id='starrykol'").get()) db.prepare("INSERT INTO connectors(id,label,enabled,status,updated_at) VALUES('starrykol','Starry',0,'draft','now')").run();
  const credential = createCredential({type:'organization_secret',label:'Diagnostic fixture',secret:'local-fixture-only'}, user.id);
  setConnectorConfig('starrykol', {url:'https://fixture.example/mcp', bearer_secret_ref:credential.id}, 0);
  db.prepare("UPDATE connectors SET enabled=?,status=?,last_error='runtime_remote_unavailable',last_verified_at='2026-10-12T06:35:31.553Z' WHERE id='starrykol'").run(enabled?1:0,status);
}
function failRemote(error: Error) {
  setStarryKolClientFactory(() => ({async callTool(){throw error;},async close(){}}));
}
const root = '/api/me/starry-binding/probe';
describe('mailbox error contract and PostgreSQL diagnosis', () => {
  it.each([
    ['missing','runtime_connector_not_configured'], ['disabled','runtime_connector_disabled'],
    ['verification_failed','starry_connector_verification_failed'], ['enabled','starry_mock_runtime_forbidden'],
  ])('never returns mock mailboxes when a non-test runtime is %s', async (state,code) => {
    if (state !== 'missing') configure(state === 'enabled', state);
    const previousVitest = process.env.VITEST;
    const previousNode = process.env.NODE_ENV;
    delete process.env.VITEST;
    process.env.NODE_ENV = 'production';
    process.env.CODEX_MODE = 'stub';
    try {
      const response = await request('POST',root,{});
      const data = await response.json();
      expect(response.status).toBe(503);
      expect(data.detail).toMatchObject({code,upstream_attempted:false});
      expect(data.mailboxes).toBeUndefined();
    } finally {
      if (previousVitest === undefined) delete process.env.VITEST; else process.env.VITEST = previousVitest;
      if (previousNode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNode;
    }
  });
  it('distinguishes present-but-failed-and-disabled from absent configuration without dispatch', async () => {
    configure();
    expect(starryKolConnectionHealth()).toMatchObject({config_present:true, enabled:false, ready:false, verification_status:'verification_failed',config_version:1});
    const response = await request('POST',root,{});
    expect(response.status).toBe(503);
    const data = await response.json();
    expect(data.detail).toMatchObject({schema_version:'settings-error.v1',code:'starry_connector_verification_failed',stage:'preflight',upstream_attempted:false,retryable:false,recovery:'contact_admin'});
    expect(response.headers.get('X-Request-ID')).toBe(data.detail.request_id);
    const diagnosis = await request('GET',`/api/admin/starry-binding/diagnostics/${data.detail.request_id}`);
    expect(diagnosis.status).toBe(200);
    expect(await diagnosis.json()).toMatchObject({code:'starry_connector_verification_failed',config_version:1,connector_enabled:false,last_error:'runtime_remote_unavailable'});
    expect(getConn().prepare("SELECT enabled,status FROM connectors WHERE id='starrykol'").get()).toMatchObject({enabled:0,status:'verification_failed'});
  });
  it('reports genuinely missing config separately', async () => {
    const response = await request('POST',root,{});
    expect(response.status).toBe(503);
    expect((await response.json()).detail).toMatchObject({code:'runtime_connector_not_configured',upstream_attempted:false});
  });
  it('respects explicit disablement instead of recommending user authentication repair', async () => {
    configure(false,'disabled');
    const response = await request('POST',root,{});
    expect((await response.json()).detail).toMatchObject({code:'runtime_connector_disabled',retryable:false,recovery:'contact_admin'});
  });
  it.each([
    [401,'runtime_remote_unauthorized',502], [403,'runtime_remote_forbidden',403], [404,'runtime_remote_not_found',502],
    [418,'runtime_remote_rejected',502], [429,'runtime_remote_rate_limited',429], [500,'runtime_remote_unavailable',502], [503,'runtime_remote_unavailable',502],
  ])('preserves upstream HTTP %s without copying provider text', async (remoteStatus,code,status) => {
    const secret = 'Authorization Bearer never-copy-me https://private.invalid?token=secret';
    failRemote(Object.assign(new Error(secret),{remoteStatus,remoteRetryAfterMs:2000}));
    const response = await request('POST',root,{});
    expect(response.status).toBe(status);
    const data = await response.json();
    expect(data.detail.code).toBe(code);
    expect(JSON.stringify(data)).not.toContain(secret);
    const diagnosis = await (await request('GET',`/api/admin/starry-binding/diagnostics/${data.detail.request_id}`)).json();
    expect(diagnosis).toMatchObject({upstream_status:remoteStatus,stage:'remote_request',upstream_attempted:true});
    if (remoteStatus === 429) expect(data.detail.retry_after_ms).toBe(2000);
    expect(JSON.stringify(getConn().prepare("SELECT payload FROM audit_events WHERE event_type LIKE 'runtime.mailbox.%'").all())).not.toContain(secret);
  });
  it.each([['timeout','runtime_remote_timeout',504],['unreachable','runtime_remote_unreachable',502]])('reports %s distinctly',async(remoteKind,code,status)=>{
    failRemote(Object.assign(new Error('private-host-and-secret'),{remoteKind}));
    const response=await request('POST',root,{});
    expect(response.status).toBe(status);
    expect((await response.json()).detail.code).toBe(code);
  });
  it('preserves reviewed structured login code but never says only organization Key was sent',async()=>{
    failRemote(new RemoteToolFailure({code:'10141103',message:'登录过期,亲，请先登录呦！'}));
    const response=await request('POST',root,{});
    const data=await response.json();
    expect(response.status).toBe(401);
    expect(data.detail.code).toBe('starrykol_login_required');
    expect(JSON.stringify(data)).not.toContain('只有');
    const diagnosis=await (await request('GET',`/api/admin/starry-binding/diagnostics/${data.detail.request_id}`)).json();
    expect(diagnosis.upstream_code).toBe('10141103');
  });
  it('rejects explicit failure even when data carries a list',async()=>{
    setStarryKolClientFactory(()=>({async callTool(){return {success:false,code:999,data:{list:[{id:6,mailboxEmail:'not-authorized@example.com'}]}};},async close(){}}));
    const response=await request('POST',root,{});
    expect(response.status).toBe(502);
    expect((await response.json()).detail.code).toBe('starry_mailbox_business_rejected');
  });
  it('does not mistake invalid response for successful empty mailboxes',async()=>{
    setStarryKolClientFactory(()=>({async callTool(){return {text:'<html>private gateway</html>'};},async close(){}}));
    const response=await request('POST',root,{});
    expect(response.status).toBe(502);
    expect((await response.json()).detail.code).toBe('starrykol_bad_gateway');
  });
  it('returns genuine empty list as successful info without binding changes',async()=>{
    setStarryKolClientFactory(()=>({async callTool(){return {list:[]};},async close(){}}));
    const response=await request('POST',root,{});
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({mailboxes:[],empty_reason:'starry_mailbox_empty'});
    expect((getConn().prepare('SELECT count(*) AS n FROM user_starry_bindings').get() as Json).n).toBe(0);
  });
  it('denies anonymous, non-admin and other administrator diagnostic reads',async()=>{
    configure();
    const data=await (await request('POST',root,{})).json();
    const url=`/api/admin/starry-binding/diagnostics/${data.detail.request_id}`;
    const employee=mapUser(getConn().prepare("SELECT * FROM users WHERE id='diag-employee'").get() as never);
    const other=mapUser(getConn().prepare("SELECT * FROM users WHERE id='diag-other'").get() as never);
    expect((await app.request(url)).status).toBe(401);
    expect((await request('GET',url,undefined,employee)).status).toBe(403);
    expect((await request('GET',url,undefined,other)).status).toBe(404);
    expect((await request('GET','/api/admin/starry-binding/diagnostics/not-a-uuid')).status).toBe(400);
  });
});

describe('safe business error parsing',()=>{
  it('finds a rejected nested result without treating a successful envelope code as the cause',()=>{
    const response={code:200,data:{success:false,code:10141103,message:'private'}};
    expect(explicitRemoteRejection(response)).toBe(true);
    expect(new RemoteToolFailure(response).upstreamCode).toBe('10141103');
    expect(explicitRemoteRejection({result:'{"success":false,"code":10141103}'})).toBe(true);
    expect(new RemoteToolFailure({content:[{type:'text',text:'说明'},{type:'text',text:'{"code":10141103}'}]}).upstreamCode).toBe('10141103');
  });
  it.each([
    {isError:true,structuredContent:{code:'10141103',message:'private'}},
    {isError:true,content:[{type:'text',text:'{"code":"10141103","message":"private"}'}]},
  ])('keeps code from structured or JSON text MCP responses',raw=>{
    const failure=new RemoteToolFailure(normalizeMcpContent(raw));
    expect(failure.upstreamCode).toBe('10141103');
    expect(failure.message).not.toContain('private');
  });
  it('keeps secrets in unknown code/message out of error and diagnosis',()=>{
    const failure=new RemoteToolFailure({code:'SECRET_SUPER_TOKEN',message:'password=private'});
    const mapped=mailboxFailure(failure,newMailboxTrace());
    expect(failure.upstreamCode).toBeUndefined();
    expect(JSON.stringify(mapped)).not.toContain('SECRET_SUPER_TOKEN');
    expect(JSON.stringify(mapped)).not.toContain('password');
    expect(explicitRemoteRejection({success:false,data:{list:[]}})).toBe(true);
  });
});
