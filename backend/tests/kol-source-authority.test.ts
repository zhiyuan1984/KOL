import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetConn } from "../src/db.js";
import {
  claimFollow,
  ingestFormalProfile,
  memoryCompanyId,
  releaseFollow,
} from "../src/host/kol-memory.js";
import { matchesVerifiedMailbox } from "../src/host/starry-mailbox-match.js";
import {
  persistStarryOwnership,
  repairSriphyFollowIdentity,
  verifyExistingStarryBindings,
} from "../src/postgres/kol-source-authority.js";
import { readFollowingAuthority } from "../src/postgres/following-authority.js";
import { postgresPool } from "../src/postgres/pool.js";
import { readPublicPoolPage } from "../src/postgres/public-pool.js";
import { freshTestDatabase } from "./support/pg.js";

const NOW = "2026-10-09T00:00:00.000Z";
const COMPANY_ID = memoryCompanyId();
type FollowActor = { id: string; name: string; brands: string[] };
function requireLocalTestDatabase(): void {
  const url=new URL(String(process.env.TEST_DATABASE_URL||''));
  if(!['127.0.0.1','localhost'].includes(url.hostname)) throw new Error('source authority tests require local PostgreSQL');
}

async function seedUser(id: string, username = id, name = id): Promise<void> {
  await postgresPool().query(
    `INSERT INTO users (id,username,name,password_hash,roles,brands,active,created_at,updated_at)
     VALUES ($1,$2,$3,'test','["employee"]','["LT"]',1,$4,$4)`,
    [id, username, name, NOW],
  );
}

function seedProfile(kolUid: string, extra: {
  handle?: string;
  displayName?: string;
  platform?: string;
  platformCreatorId?: string;
  ingestSource?: string;
} = {}) {
  return ingestFormalProfile({
    kol_uid: kolUid,
    handle: extra.handle || kolUid,
    display_name: extra.displayName || kolUid,
    platform: extra.platform || "youtube",
    platform_creator_id: extra.platformCreatorId || `${kolUid}-creator`,
    homepage_url: `https://www.youtube.com/@${kolUid}`,
    followers: "120000",
    avg_plays: "8000",
    engagement: "0.04",
    direction: "review",
    region: "US",
    style: "tech",
    public_stage: "INITIAL_CONTACT",
    ingest_source: extra.ingestSource || "test",
    pool_status: "open",
  });
}

async function seedStarryCollaboration(input: {
  id: string;
  kolUid: string;
  displayName?: string;
  ownerMailbox?: string;
  stageCode?: string;
  ownerName?: string;
}): Promise<void> {
  await postgresPool().query(
    `INSERT INTO collaborations
       (id,handle,display_name,brand,platform,email,mailbox_from,lifecycle_id,conversation_id,
        stage_code,kol_uid,source,owner_mailbox,owner_name)
     VALUES ($1,$2,$3,'LT','youtube','kol@creator.test','', $4,$5,$6,$7,'starry',$8,$9)`,
    [
      input.id,
      input.kolUid,
      input.displayName || input.kolUid,
      `life-${input.id}`,
      `conversation-${input.id}`,
      input.stageCode || "INITIAL_CONTACT",
      input.kolUid,
      input.ownerMailbox || "",
      input.ownerName || "",
    ],
  );
}

async function seedFollow(input: {
  id: string;
  kolUid: string;
  employeeId: string;
  status?: "active" | "released";
  collaborationId?: string;
}): Promise<void> {
  const status = input.status || "active";
  await postgresPool().query(
    `INSERT INTO kol_follow_index
       (id,company_id,kol_uid,scope_brand,employee_id,employee_name,status,claimed_at,
        released_at,release_reason,collaboration_id,data_version,created_at,updated_at)
     VALUES ($1,$2,$3,'LT',$4,$4,$5,$6,$7,$8,$9,1,$6,$6)`,
    [
      input.id,
      COMPANY_ID,
      input.kolUid,
      input.employeeId,
      status,
      NOW,
      status === "released" ? NOW : null,
      status === "released" ? "manual_release" : null,
      input.collaborationId || null,
    ],
  );
}

function followingIds(rows: Record<string, unknown>[]): string[] {
  return rows.map((row) => String(row.kol_uid));
}

function poolIds(page: { items: Record<string, unknown>[] }): string[] {
  return page.items.map((row) => String(row.kol_uid));
}

beforeEach(async () => {
  requireLocalTestDatabase();
  await freshTestDatabase();
  resetConn();
});

afterEach(() => {
  resetConn();
});

describe.sequential("KOL source authority (local PostgreSQL)", () => {
  it("requires an exact non-placeholder verified mailbox, never a name, local-part, or legacy extras match", () => {
    const legacyExtrasMatcher = matchesVerifiedMailbox as unknown as (
      kol: { owner_mailbox?: unknown; owner_name?: unknown },
      scope: { mailbox_email: string; owner_name?: string },
      extras: string[],
    ) => boolean;

    expect(matchesVerifiedMailbox(
      { owner_mailbox: "owner@example.com" },
      { mailbox_email: "OWNER@example.com" },
    )).toBe(false);
    expect(matchesVerifiedMailbox(
      { owner_name: "Same Owner" },
      { mailbox_email: "owner@verified.test", owner_name: "Same Owner" },
    )).toBe(false);
    expect(matchesVerifiedMailbox(
      { owner_mailbox: "owner@vendor.test" },
      { mailbox_email: "owner@verified.test" },
    )).toBe(false);
    expect(legacyExtrasMatcher(
      { owner_name: "Same Owner" },
      { mailbox_email: "owner@verified.test", owner_name: "Same Owner" },
      ["owner@verified.test"],
    )).toBe(false);
    expect(matchesVerifiedMailbox(
      { owner_mailbox: "Owner@verified.test" },
      { mailbox_email: "owner@verified.test" },
    )).toBe(true);
  });

  it("returns only stable-ID-authorized Starry history after binding verification, without re-adding active or released follows", async () => {
    const employee = "employee-source";
    const remoteOwner = "starry-owner-1";
    await seedUser(employee, "employee-source", "Same Owner");
    await postgresPool().query(
      `INSERT INTO user_starry_bindings
         (user_id,mailbox_email,mailbox_id,owner_name,status,updated_at)
       VALUES ($1,'owner@verified.test','mailbox-source','Same Owner','connected',$2)`,
      [employee, NOW],
    );

    for (const kolUid of ["KOL_MATCH", "KOL_SAME_NAME", "KOL_OTHER_ACTIVE", "KOL_MINE_RELEASED"]) {
      seedProfile(kolUid, { displayName: "Same Name" });
      await seedStarryCollaboration({ id: `col-${kolUid}`, kolUid, displayName: "Same Name" });
    }
    await persistStarryOwnership([
      { kolUid: "KOL_MATCH", ownerOpenId: remoteOwner },
      { kolUid: "KOL_SAME_NAME", ownerOpenId: "starry-owner-same-name" },
      { kolUid: "KOL_OTHER_ACTIVE", ownerOpenId: remoteOwner },
      { kolUid: "KOL_MINE_RELEASED", ownerOpenId: remoteOwner },
    ], COMPANY_ID, "test-source-v1", true);

    // A connected mailbox by itself is insufficient until the exact source owner is verified.
    expect(followingIds(await readFollowingAuthority(employee) as Record<string, unknown>[])).toEqual([]);
    expect(await verifyExistingStarryBindings(employee, [
      { mailboxEmail: "OWNER@verified.test", id: "mailbox-source", ownerOpenId: remoteOwner },
    ])).toBe(1);
    await seedFollow({ id: "follow-other", kolUid: "KOL_OTHER_ACTIVE", employeeId: "employee-other" });
    await seedFollow({ id: "follow-released", kolUid: "KOL_MINE_RELEASED", employeeId: employee, status: "released" });

    const history = await readFollowingAuthority(employee) as Record<string, unknown>[];
    expect(followingIds(history)).toEqual(["KOL_MATCH"]);
    expect(history[0]).toMatchObject({ source_kind: "starry_binding", status: "active", employee_id: employee });
    const verified = await postgresPool().query<{ owner_open_id: string; owner_verified_at: string | null }>(
      "SELECT owner_open_id,owner_verified_at FROM user_starry_bindings WHERE user_id=$1 AND mailbox_email='owner@verified.test'",
      [employee],
    );
    expect(verified.rows[0]).toMatchObject({ owner_open_id: remoteOwner });
    expect(verified.rows[0]?.owner_verified_at).toBeTruthy();
  });

  it("keeps an active local discovery follow readable even without any mailbox binding", async () => {
    const actor: FollowActor = { id: "employee-local", name: "Local Employee", brands: ["LT"] };
    await seedUser(actor.id, actor.id, actor.name);
    seedProfile("KOL_LOCAL_DISCOVERY", { ingestSource: "discovery" });
    claimFollow({ kolUid: "KOL_LOCAL_DISCOVERY", scopeBrand: "LT", confirm: true, actor });

    const following = await readFollowingAuthority(actor.id) as Record<string, unknown>[];
    expect(followingIds(following)).toEqual(["KOL_LOCAL_DISCOVERY"]);
    expect(following[0]).toMatchObject({ source_kind: "local_follow", status: "active", employee_id: actor.id });
  });

  it("hides open profiles with ownership evidence from the public pool until an explicit release", async () => {
    const actor: FollowActor = { id: "employee-release", name: "Release Employee", brands: ["LT"] };
    await seedUser(actor.id, actor.id, actor.name);
    seedProfile("KOL_OPEN_UNOWNED");
    seedProfile("KOL_OWNER_EVIDENCE");
    await persistStarryOwnership([
      { kolUid: "KOL_OWNER_EVIDENCE", ownerOpenId: "starry-owner-public" },
    ], COMPANY_ID, "test-pool-v1", true);

    await postgresPool().query(`INSERT INTO user_starry_bindings(user_id,mailbox_email,owner_open_id,owner_verified_at,status,updated_at)
      VALUES($1,'release@verified.test','starry-owner-public',$2,'connected',$2)`,[actor.id,NOW]);
    const options = { query: "", filter: "all" as const, sort: "default" as const, offset: 0, limit: 50 };
    const beforeRelease = await readPublicPoolPage(options, COMPANY_ID);
    expect(poolIds(beforeRelease)).toContain("KOL_OPEN_UNOWNED");
    expect(poolIds(beforeRelease)).not.toContain("KOL_OWNER_EVIDENCE");

    const claimed = claimFollow({ kolUid: "KOL_OWNER_EVIDENCE", scopeBrand: "LT", confirm: true, actor });
    const followId = String((claimed.follow as { follow_id: string }).follow_id);
    expect(releaseFollow({ followId, confirm: true, actor, reason: "manual_release" })).toMatchObject({ ok: true, action: "release" });

    const afterRelease = await readPublicPoolPage(options, COMPANY_ID);
    expect(poolIds(afterRelease)).toContain("KOL_OWNER_EVIDENCE");
  });

  it("never authorizes from a legacy collaboration send mailbox and rejects malformed full snapshots", async () => {
    await seedUser('employee-legacy');
    await postgresPool().query(`INSERT INTO user_starry_bindings(user_id,mailbox_email,owner_open_id,owner_verified_at,status,updated_at)
      VALUES('employee-legacy','owner@verified.test','real-owner',$1,'connected',$1)`,[NOW]);
    seedProfile('KOL_LEGACY_BOX');
    await seedStarryCollaboration({id:'col-legacy-box',kolUid:'KOL_LEGACY_BOX',ownerMailbox:'owner@verified.test'});
    expect(await readFollowingAuthority('employee-legacy')).toEqual([]);
    await persistStarryOwnership([{kolUid:'KOL_LEGACY_BOX',ownerOpenId:'real-owner'}],COMPANY_ID,'healthy-v1',true);
    expect(followingIds(await readFollowingAuthority('employee-legacy') as Record<string,unknown>[])).toEqual(['KOL_LEGACY_BOX']);
    await expect(persistStarryOwnership([{kolUid:'KOL_LEGACY_BOX'}],COMPANY_ID,'malformed-v2',true)).rejects.toThrow('owner_capability_missing');
    expect((await postgresPool().query("SELECT owner_open_id FROM starry_profile_ownership WHERE kol_uid='KOL_LEGACY_BOX'")).rows[0].owner_open_id).toBe('real-owner');
    await postgresPool().query("UPDATE starry_ownership_sync_state SET state='failed' WHERE company_id=$1",[COMPANY_ID]);
    expect(await readFollowingAuthority('employee-legacy')).toEqual([]);
    await expect(readPublicPoolPage({query:'',filter:'all',sort:'default',offset:0,limit:50},COMPANY_ID)).rejects.toThrow('不能据此判断公海为空');
    await postgresPool().query("UPDATE user_starry_bindings SET status='expired' WHERE user_id='employee-legacy'");
    expect(poolIds(await readPublicPoolPage({query:'',filter:'all',sort:'default',offset:0,limit:50},COMPANY_ID))).toContain('KOL_LEGACY_BOX');
  });

  it("repairs only the canonical active sriphy identity and leaves the follow relationship, stage, and remote owner intact", async () => {
    await seedUser("sriphy", "sriphy", "Canonical Sriphy");
    seedProfile("KOL_SRIPHY", { platformCreatorId: "sriphy-creator" });
    await seedStarryCollaboration({
      id: "col-sriphy",
      kolUid: "KOL_SRIPHY",
      stageCode: "NEGOTIATING",
      ownerName: "Remote Owner",
    });
    await persistStarryOwnership([
      { kolUid: "KOL_SRIPHY", ownerOpenId: "remote-owner-open-id" },
    ], COMPANY_ID, "test-repair-v1", true);
    await seedFollow({
      id: "follow-sriphy",
      kolUid: "KOL_SRIPHY",
      employeeId: "usr_sriphy",
      collaborationId: "col-sriphy",
    });

    const legacyBefore = await postgresPool().query("SELECT id FROM users WHERE id='usr_sriphy'");
    expect(legacyBefore.rowCount).toBe(0);
    expect(await repairSriphyFollowIdentity("test-actor")).toEqual({ repaired: 1, follow_ids: ["follow-sriphy"] });
    expect(await repairSriphyFollowIdentity("test-actor")).toEqual({ repaired: 0, follow_ids: [] });

    const repaired = await postgresPool().query<{
      employee_id: string;
      collaboration_id: string | null;
      status: string;
      stage_code: string;
      owner_name: string;
      owner_open_id: string;
    }>(`
      SELECT f.employee_id,f.collaboration_id,f.status,c.stage_code,c.owner_name,o.owner_open_id
        FROM kol_follow_index f
        JOIN collaborations c ON c.id=f.collaboration_id
        JOIN starry_profile_ownership o ON o.company_id=f.company_id AND o.kol_uid=f.kol_uid
       WHERE f.id='follow-sriphy'`,
    );
    expect(repaired.rows).toEqual([{
      employee_id: "sriphy",
      collaboration_id: "col-sriphy",
      status: "active",
      stage_code: "NEGOTIATING",
      owner_name: "Remote Owner",
      owner_open_id: "remote-owner-open-id",
    }]);
    const audit = await postgresPool().query<{ count: string }>(
      "SELECT count(*)::text AS count FROM kol_identity_repairs WHERE legacy_user_id='usr_sriphy' AND canonical_user_id='sriphy'",
    );
    expect(audit.rows[0]?.count).toBe("1");
  });
});
