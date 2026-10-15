import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({query:vi.fn(),enqueue:vi.fn(),status:'running' as string,jobId:'job-existing' as string|null}));
vi.mock('../src/postgres/pool.js',()=>({postgresPool:vi.fn(),postgresTransaction:async(callback:(db:unknown)=>unknown)=>callback({query:mocks.query})}));
vi.mock('../src/knowledge-publication/service.js',()=>({adminDocument:async()=>({tenant:'company'})}));
vi.mock('../src/approval/review-postgres-access.js',()=>({postgresReviewCompanies:vi.fn()}));
vi.mock('../src/execution-jobs/postgres-store.js',()=>({pgEnqueueExecutionJob:mocks.enqueue}));
vi.mock('../src/worker/structured-background.js',()=>({structuredBackground:vi.fn()}));
vi.mock('../src/config.js',()=>({dataDir:()=>'/tmp'}));
vi.mock('node:fs/promises',()=>({default:{readFile:async()=>Buffer.from('original source')}}));
import {saveScope,enqueueScope} from '../src/knowledge/scopes.js';

beforeEach(()=>{
  vi.clearAllMocks();mocks.status='running';mocks.jobId='job-existing';
  mocks.enqueue.mockResolvedValue({job:{id:'job-new'}});
  mocks.query.mockImplementation(async(sql:string)=>{
    if(sql.startsWith('SELECT * FROM knowledge_documents'))return {rows:[{id:'doc',status:'pending_review',source_path:'/tmp/source',artifacts:{}}],rowCount:1};
    if(sql.startsWith('SELECT * FROM knowledge_document_scopes'))return {rows:[{revision:5,explanation:'用途',job_id:mocks.jobId,scope:null}],rowCount:1};
    if(sql.startsWith('SELECT status FROM execution_jobs'))return {rows:[{status:mocks.status}],rowCount:1};
    if(sql.startsWith('SELECT id,status FROM execution_jobs'))return {rows:[{id:mocks.jobId,status:mocks.status}],rowCount:1};
    return {rows:[],rowCount:0};
  });
});
describe('knowledge scope persisted concurrency contract',()=>{
  for(const status of ['queued','running','retrying'])it(`rejects saving explanations while ${status}, without clearing the active job`,async()=>{
    mocks.status=status;
    await expect(saveScope('actor','company','doc',{expectedRevision:5,explanation:'新解释'})).rejects.toThrow('正在提炼');
    expect(mocks.query.mock.calls.some(([sql])=>/^(INSERT|UPDATE|DELETE)\b/.test(sql))).toBe(false);
  });
  it('still rejects an outdated revision before saving',async()=>{
    await expect(saveScope('actor','company','doc',{expectedRevision:4,explanation:'新解释'})).rejects.toThrow('范围已变化');
    expect(mocks.query.mock.calls.some(([sql])=>/^(INSERT|UPDATE|DELETE)\b/.test(sql))).toBe(false);
  });
  it('returns the same active job without another enqueue or revision change',async()=>{
    await expect(enqueueScope('actor','company','doc',5)).resolves.toEqual({jobId:'job-existing'});
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.query.mock.calls.some(([sql])=>/^(INSERT|UPDATE|DELETE)\b/.test(sql))).toBe(false);
  });
  it('advances the persisted revision when a new generation replaces a failed job',async()=>{
    mocks.status='failed';
    await expect(enqueueScope('actor','company','doc',5)).resolves.toEqual({jobId:'job-new'});
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    const insert=mocks.query.mock.calls.find(([sql])=>sql.startsWith('INSERT INTO knowledge_document_scopes'));
    expect(insert?.[0]).toContain('revision=knowledge_document_scopes.revision+1');
  });
});
