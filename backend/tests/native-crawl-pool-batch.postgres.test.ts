import { beforeEach,afterEach,describe,expect,it } from 'vitest';
import { getConn,resetConn } from '../src/db.js';
import { postgresTransaction } from '../src/postgres/pool.js';
import { dedupeSightings,recordPoolSightings } from '../src/crawl/dedup.js';
import { freshTestDatabase } from './support/pg.js';
beforeEach(async()=>{await freshTestDatabase({empty:true});});
afterEach(async()=>{await resetConn();});
describe('native crawl pool batches and ownership',()=>{
 it('preserves sequential same-key count, first external ID, last nonempty labels and last snapshot',async()=>{
  await postgresTransaction(async client=>recordPoolSightings(client,[
   {platform:'YouTube',platform_creator_id:' AbC ',handle:'@first',display_name:'First',profile_snapshot:{version:1}},
   {platform:'youtube',platform_creator_id:'abc',handle:null,display_name:'Second',profile_snapshot:{version:2}},
   {platform:'YOUTUBE',platform_creator_id:'ABC',handle:'@last',display_name:null,profile_snapshot:{version:3}},
  ]));
  const before=(await getConn().query("SELECT * FROM kol_creator_pool WHERE platform='youtube' AND normalized_creator_id='abc'")).rows[0];
  expect(before).toMatchObject({platform_creator_id:'AbC',seen_count:3,handle:'@last',display_name:'Second',profile_snapshot:{version:3}});
  await postgresTransaction(async client=>recordPoolSightings(client,[{platform:'youtube',platform_creator_id:'abc',profile_snapshot:{version:4}}]));
  const after=(await getConn().query("SELECT * FROM kol_creator_pool WHERE id=$1",[before.id])).rows[0];
  expect(after).toMatchObject({id:before.id,platform_creator_id:'AbC',seen_count:4,handle:'@last',display_name:'Second',profile_snapshot:{version:4},first_seen_at:before.first_seen_at});
 });
 it('rolls back all prior 250-row batches when a later row fails, without leaving partial pool facts',async()=>{
  await getConn().query("CREATE FUNCTION owned_pool_batch_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.platform_creator_id='blocked' THEN RAISE EXCEPTION 'owned pool batch failure'; END IF; RETURN NEW; END $$");
  await getConn().query('CREATE TRIGGER owned_pool_batch_failure BEFORE INSERT ON kol_creator_pool FOR EACH ROW EXECUTE FUNCTION owned_pool_batch_failure()');
  const sightings=Array.from({length:250},(_,index)=>({platform:'youtube',platform_creator_id:`owned-${index}`}));
  sightings.push({platform:'youtube',platform_creator_id:'blocked'});
  await expect(dedupeSightings(sightings)).rejects.toThrow('owned pool batch failure');
  expect(Number((await getConn().query('SELECT count(*) AS n FROM kol_creator_pool')).rows[0].n)).toBe(0);
 });
});
