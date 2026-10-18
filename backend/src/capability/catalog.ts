import { postgresConnection } from '../postgres/pool.js';
import { HttpFail } from '../host/errors.js';
import { loadOperationContracts, validateOperationCatalog, type ContractCatalog, type OperationContract } from './contracts.js';

export type OperationDocument = {id:string;version:number;revision:number;draft:OperationContract|null;published:OperationContract|null;disabled:boolean;updated_at:string};
export type OperationDb = Pick<ReturnType<typeof postgresConnection>,'query'>;

/** PostgreSQL is authoritative after governance. Drafts never execute; disabled baselines never return. */
export async function publishedOperationCatalog(db:OperationDb=postgresConnection()):Promise<ContractCatalog> {
  const baseline=loadOperationContracts();
  let rows:OperationDocument[];
  try{rows=(await db.query<OperationDocument>('SELECT id,version,published,disabled FROM capability_operation_documents')).rows;}
  catch(error){if((error as {code?:string}).code==='42P01')throw new HttpFail(503,{code:'capability_schema_required',message:'能力治理数据表尚未初始化，请运行 PostgreSQL schema 迁移'});throw error;}
  const operations=new Map(baseline.operations.map(operation=>[`${operation.id}@${operation.version}`,operation]));
  for(const row of rows){const key=`${row.id}@${row.version}`;if(row.disabled)operations.delete(key);else if(row.published)operations.set(key,row.published);}
  const catalog={version:1,operations:[...operations.values()]};validateOperationCatalog(catalog);return catalog;
}
