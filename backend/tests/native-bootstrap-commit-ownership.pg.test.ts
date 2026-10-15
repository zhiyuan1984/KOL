import { beforeEach,afterEach,describe,expect,it } from 'vitest';
import { getConn,resetConn } from '../src/db.js';
import { postgresTransaction } from '../src/postgres/pool.js';
import { ensureManagedAgents } from '../src/runtime/managed-agents.js';
import { ensureOrganizationTree } from '../src/runtime/organization-tree.js';
import { ensureRuntimeSchema } from '../src/runtime/store.js';
import { freshTestDatabase } from './support/pg.js';
beforeEach(async()=>{await freshTestDatabase({empty:true});});
afterEach(async()=>{await resetConn();});
const cases=[
 {name:'managed Agent',initialize:ensureManagedAgents,table:'managed_agents',sql:"SELECT count(*)::int AS n FROM managed_agents WHERE id='agent:kol'"},
 {name:'organization',initialize:ensureOrganizationTree,table:'app_state',sql:"SELECT count(*)::int AS n FROM app_state WHERE key='org_registry_v1'"},
 {name:'Runtime',initialize:ensureRuntimeSchema,table:'runtime_bootstrap_migrations',sql:"SELECT count(*)::int AS n FROM runtime_bootstrap_migrations WHERE id='runtime.workspace-planner.v1'"},
] as const;
async function count(sql:string){return Number((await getConn().query<{n:number}>(sql)).rows[0]?.n);}
describe('native bootstrap completion belongs to the outer committed transaction',()=>{
 for(const item of cases){
  it(`${item.name}: outer rollback leaves no cached completion and a subsequent call really initializes`,async()=>{
   expect(await count(item.sql)).toBe(0);
   await expect(postgresTransaction(async()=>{
    await item.initialize();
    expect(await count(item.sql)).toBe(1);
    throw new Error('owned outer rollback');
   },{isolation:'SERIALIZABLE'})).rejects.toThrow('owned outer rollback');
   expect(await count(item.sql)).toBe(0);
   await item.initialize();
   expect(await count(item.sql)).toBe(1);
  });
  it(`${item.name}: deferred COMMIT failure is not cached as initialized`,async()=>{
   expect(await count(item.sql)).toBe(0);
   await getConn().query("CREATE FUNCTION owned_bootstrap_commit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'owned deferred commit failure'; END $$");
   // Identifiers come exclusively from the closed fixture list above.
   await getConn().query(`CREATE CONSTRAINT TRIGGER owned_bootstrap_commit_failure AFTER INSERT ON ${item.table} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION owned_bootstrap_commit_failure()`);
   await expect(item.initialize()).rejects.toThrow('owned deferred commit failure');
   expect(await count(item.sql)).toBe(0);
   await getConn().query(`DROP TRIGGER owned_bootstrap_commit_failure ON ${item.table}`);
   await getConn().query('DROP FUNCTION owned_bootstrap_commit_failure()');
   await item.initialize();
   expect(await count(item.sql)).toBe(1);
  });
 }
});
