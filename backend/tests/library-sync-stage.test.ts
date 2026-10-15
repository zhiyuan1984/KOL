import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";
import { confirmStarryStage } from "../src/gateway/starry.js";
import { parseFollowStyleTags, writeFollowStyleTags } from "../src/follow-style-tags.js";
import { buildHomeBoard } from "../src/host/home-board.js";
import { journeyPayload } from "../src/host/kol-journey.js";
import { seedAll } from "../src/seed.js";
import { seedWorkbenchFixtures } from "../src/seed-fixtures.js";
import {
  resetStarryHomeLibrarySync,
  restoreOfficialCollaborationStage,
  syncStarryHomeLibrary,
} from "../src/starrykol/library-sync.js";
import { setStarryKolClientFactory } from "../src/starrykol/service.js";
import type { Json, Row } from "../src/types.js";
import { freshTestDatabase } from "./support/pg.js";

let tmp: string;

async function outdoorRow(): Promise<Awaited<Row>> {
  return (await getConn().query("SELECT * FROM collaborations WHERE kol_uid = $1",["KOLTEST001"])).rows[0] as Row;
}

async function stageOfUid(uid = "KOLTEST001"): Promise<Awaited<string>> {
  return String((await outdoorRow()).stage_code);
}

beforeEach(async () => {
  await freshTestDatabase();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-library-stage-"));
  process.env.LINGONG_DB = path.join(tmp, "t.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  setStarryKolClientFactory();
  (await resetConn());
  (await seedAll());
  (await seedWorkbenchFixtures());
  resetStarryHomeLibrarySync();
});

afterEach(async () => {
  setStarryKolClientFactory();
  resetStarryHomeLibrarySync();
  (await resetConn());
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("Starry library sync preserves confirmed official stage", () => {
  it("keeps 意向 after refresh when Starry list-all is still 初步接触", async () => {
    const first = await syncStarryHomeLibrary();
    expect(first.ok).toBe(true);
    expect((await stageOfUid())).toBe("INITIAL_CONTACT");

    const col = (await outdoorRow());
    (await confirmStarryStage(String(col.lifecycle_id), "INTERESTED", "host"));
    expect((await stageOfUid())).toBe("INTERESTED");

    resetStarryHomeLibrarySync();
    const again = await syncStarryHomeLibrary();
    expect(again.ok).toBe(true);
    expect((await stageOfUid())).toBe("INTERESTED");

    const journey = (await journeyPayload(String((await outdoorRow()).id))) as Json;
    expect(journey.stage_code).toBe("INTERESTED");
    expect((journey.sop as Json).phase_label).toBe("意向");

    const board = (await buildHomeBoard()) as Json;
    const card = (board.kols as Json[]).find((row) => String(row.kol_uid || "") === "KOLTEST001") as Json;
    expect(card.stage_code).toBe("INTERESTED");
    expect(String(card.current_stage || card.stage_label || "")).toMatch(/已回复-有兴趣|意向/);
  });

  it("restores 意向 from the confirm record after a stale 建联 overwrite", async () => {
    await syncStarryHomeLibrary();
    const col = (await outdoorRow());
    (await confirmStarryStage(String(col.lifecycle_id), "INTERESTED", "host"));
    (await getConn().query("UPDATE collaborations SET stage_code = $1 WHERE id = $2",["INITIAL_CONTACT",col.id]));
    expect((await stageOfUid())).toBe("INITIAL_CONTACT");

    const restored = (await restoreOfficialCollaborationStage(
      (await getConn().query("SELECT * FROM collaborations WHERE id = $1",[col.id])).rows[0] as Row,
    ));
    expect(restored).toBe("INTERESTED");
    expect((await stageOfUid())).toBe("INTERESTED");
    expect(((await journeyPayload(String(col.id))) as Json).stage_code).toBe("INTERESTED");
  });

  it("still imports a new Starry profile as 建联", async () => {
    await syncStarryHomeLibrary();
    expect((await stageOfUid())).toBe("INITIAL_CONTACT");
    const board = (await buildHomeBoard()) as Json;
    const card = (board.kols as Json[]).find((row) => String(row.kol_uid || "") === "KOLTEST001") as Json;
    expect(card.stage_code).toBe("INITIAL_CONTACT");
    expect(String(card.current_stage || "")).toContain("初步接触");
  });

  it("stores profile lastLifecycleId so confirm_stage can pass it to Starry", async () => {
    setStarryKolClientFactory(() => ({
      async callTool(name: string) {
        if (name === "listAllKolProfiles") {
          return {
            data: {
              total: 1,
              list: [{
                kolUid: "KOL20260901LINGONG",
                kolName: "云端验收达人",
                nickname: "云端验收达人",
                lastLifecycleId: 320,
                lastConversationId: 327,
                cooperationStageCode: "QUOTE_PENDING",
                primaryPlatform: "YouTube",
              }],
            },
          };
        }
        return { data: { list: [] } };
      },
      async close() { /* noop */ },
    }));
    const synced = await syncStarryHomeLibrary();
    expect(synced.ok).toBe(true);
    const row = (await getConn().query("SELECT * FROM collaborations WHERE kol_uid=$1",["KOL20260901LINGONG"])).rows[0] as Row;
    expect(row.last_lifecycle_id).toBe("320");
    expect(row.lifecycle_id).toBe("320");
    expect(row.last_conversation_id).toBe("327");
  });

  it("lets Starry list-all move the official stage forward", async () => {
    await syncStarryHomeLibrary();
    (await confirmStarryStage(String((await outdoorRow()).lifecycle_id), "INTERESTED", "host"));
    setStarryKolClientFactory(() => ({
      async callTool(name: string) {
        if (name === "listAllKolProfiles") {
          return {
            data: {
              total: 1,
              list: [{
                kolUid: "KOLTEST001",
                kolName: "户外电源达人",
                nickname: "户外电源达人",
                cooperationStageName: "合作评估",
                primaryPlatform: "YouTube",
                contactEmail: "outdoor@example.com",
              }],
            },
          };
        }
        return { data: { list: [] } };
      },
      async close() { /* noop */ },
    }));
    resetStarryHomeLibrarySync();
    await syncStarryHomeLibrary();
    expect((await stageOfUid())).toBe("EVALUATING");
  });

  it("keeps locally saved follow-style tags when Starry list-all has none", async () => {
    await syncStarryHomeLibrary();
    (await writeFollowStyleTags(String((await outdoorRow()).id), [{ id: "cautious", label: "犹豫谨慎" }]));
    resetStarryHomeLibrarySync();
    const again = await syncStarryHomeLibrary();
    expect(again.ok).toBe(true);
    expect(parseFollowStyleTags((await outdoorRow()).follow_style_tags).map((tag) => tag.id)).toContain("cautious");
    const board = (await buildHomeBoard()) as Json;
    const card = (board.kols as Json[]).find((row) => String(row.kol_uid || "") === "KOLTEST001") as Json;
    expect((card.follow_style_tags as Json[]).some((tag) => String(tag.id) === "cautious")).toBe(true);
  });
});
