import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";
import { confirmStarryStage } from "../src/gateway/starry.js";
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

let tmp: string;

function outdoorRow(): Row {
  return getConn().prepare("SELECT * FROM collaborations WHERE kol_uid = ?").get("KOLTEST001") as Row;
}

function stageOfUid(uid = "KOLTEST001"): string {
  return String(outdoorRow().stage_code);
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-library-stage-"));
  process.env.LINGONG_DB = path.join(tmp, "t.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  setStarryKolClientFactory();
  resetConn();
  seedAll();
  seedWorkbenchFixtures();
  resetStarryHomeLibrarySync();
});

afterEach(() => {
  setStarryKolClientFactory();
  resetStarryHomeLibrarySync();
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("Starry library sync preserves confirmed official stage", () => {
  it("keeps 意向 after refresh when Starry list-all is still 初步接触", async () => {
    const first = await syncStarryHomeLibrary();
    expect(first.ok).toBe(true);
    expect(stageOfUid()).toBe("INITIAL_CONTACT");

    const col = outdoorRow();
    confirmStarryStage(String(col.lifecycle_id), "INTERESTED", "host");
    expect(stageOfUid()).toBe("INTERESTED");

    resetStarryHomeLibrarySync();
    const again = await syncStarryHomeLibrary();
    expect(again.ok).toBe(true);
    expect(stageOfUid()).toBe("INTERESTED");

    const journey = journeyPayload(String(outdoorRow().id)) as Json;
    expect(journey.stage_code).toBe("INTERESTED");
    expect((journey.sop as Json).phase_label).toBe("意向");

    const board = buildHomeBoard() as Json;
    const card = (board.kols as Json[]).find((row) => String(row.kol_uid || "") === "KOLTEST001") as Json;
    expect(card.stage_code).toBe("INTERESTED");
    expect(String(card.current_stage || card.stage_label || "")).toMatch(/已回复-有兴趣|意向/);
  });

  it("restores 意向 from the confirm record after a stale 建联 overwrite", async () => {
    await syncStarryHomeLibrary();
    const col = outdoorRow();
    confirmStarryStage(String(col.lifecycle_id), "INTERESTED", "host");
    getConn().prepare("UPDATE collaborations SET stage_code = ? WHERE id = ?").run("INITIAL_CONTACT", col.id);
    expect(stageOfUid()).toBe("INITIAL_CONTACT");

    const restored = restoreOfficialCollaborationStage(
      getConn().prepare("SELECT * FROM collaborations WHERE id = ?").get(col.id) as Row,
    );
    expect(restored).toBe("INTERESTED");
    expect(stageOfUid()).toBe("INTERESTED");
    expect((journeyPayload(String(col.id)) as Json).stage_code).toBe("INTERESTED");
  });

  it("still imports a new Starry profile as 建联", async () => {
    await syncStarryHomeLibrary();
    expect(stageOfUid()).toBe("INITIAL_CONTACT");
    const board = buildHomeBoard() as Json;
    const card = (board.kols as Json[]).find((row) => String(row.kol_uid || "") === "KOLTEST001") as Json;
    expect(card.stage_code).toBe("INITIAL_CONTACT");
    expect(String(card.current_stage || "")).toContain("初步接触");
  });

  it("lets Starry list-all move the official stage forward", async () => {
    await syncStarryHomeLibrary();
    confirmStarryStage(String(outdoorRow().lifecycle_id), "INTERESTED", "host");
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
    expect(stageOfUid()).toBe("EVALUATING");
  });
});
