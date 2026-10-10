import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  homeFollowing: vi.fn(),
}));

vi.mock("../api", () => ({ api: mocks }));

const { loadHomeFollowing } = await import("./kolSurfaceApi");
const { isActiveFollowRow } = await import("./kolContract");

const legacyBoard = {
  kols: [{
    kol_uid: "board-only-kol",
    handle: "不应混入",
    follow_id: "board-follow",
    status: "active",
  }],
};
const loadWithLegacyBoard = loadHomeFollowing as unknown as (
  board: typeof legacyBoard,
) => ReturnType<typeof loadHomeFollowing>;

describe("unified /api/home/following authority", () => {
  beforeEach(() => {
    mocks.homeFollowing.mockReset();
  });

  it("treats a successful empty response as complete and never mixes a board projection", async () => {
    mocks.homeFollowing.mockResolvedValue({
      items: [],
      authority: "kol_follow_index+verified_starry_binding",
      completeness: "complete",
    });

    const loaded = await loadWithLegacyBoard(legacyBoard);

    expect(loaded).toMatchObject({
      items: [],
      raw: [],
      source: "following",
      authority: "kol_follow_index+verified_starry_binding",
      completeness: "complete",
    });
    expect(loaded.down).toBeUndefined();
  });

  it("reports a following read failure without a board or profile fallback", async () => {
    mocks.homeFollowing.mockRejectedValue(new Error("following unavailable"));

    const loaded = await loadWithLegacyBoard(legacyBoard);

    expect(loaded).toMatchObject({
      items: [],
      raw: [],
      source: "following",
      down: true,
      error: "following unavailable",
    });
  });

  it("keeps locally authorized rows but marks a failed Starry source incomplete",async()=>{
    mocks.homeFollowing.mockResolvedValue({authority:"kol_follow_index+verified_starry_binding",completeness:"incomplete-source",
      kols:[{kol_uid:"KOL_LOCAL",handle:"Local",follow_id:"f-local",source_kind:"local_follow",status:"active"}]});
    const result=await loadHomeFollowing();
    expect(result).toMatchObject({down:true,partial:true});
    expect(result.items).toHaveLength(1);
    expect(result.items[0].kol_uid).toBe("KOL_LOCAL");
  });
  it("shows a terminal timeout reason while preserving authorized local rows", async () => {
    mocks.homeFollowing.mockResolvedValue({authority:"kol_follow_index+verified_starry_binding",completeness:"incomplete-source",
      source_error_code:"starry_authorization_timeout",
      kols:[{kol_uid:"KOL_LOCAL",handle:"Local",follow_id:"f-local",source_kind:"local_follow",status:"active"}]});
    const result = await loadHomeFollowing();
    expect(result).toMatchObject({down:true,partial:true});
    expect(result.error).toContain("本次读取已结束");
    expect(result.items).toHaveLength(1);
  });

  it("does not treat an unknown status plus an ID as an active follow", () => {
    expect(isActiveFollowRow({ id: "stale-profile", kol_uid: "kol-stale", status: "unknown" })).toBe(false);
    expect(isActiveFollowRow({ follow_id: "stale-follow", kol_uid: "kol-stale-follow", status: "unknown" })).toBe(false);
    expect(isActiveFollowRow({ id: "missing-status", kol_uid: "kol-missing" })).toBe(false);
    expect(isActiveFollowRow({
      kol_uid: "discovery-follow",
      follow_id: "local-follow",
      source_kind: "discovery_candidate",
      status: "active",
    })).toBe(true);
  });

  it("renders a service-authorized Starry historical row that has no local follow ID", async () => {
    mocks.homeFollowing.mockResolvedValue({
      items: [{
        kol_uid: "starry-history-1",
        handle: "历史红人",
        platform: "youtube",
        source_kind: "starry_binding",
        creator_status: "active",
        status: "active",
        stage_code: "INTERESTED",
        stage_label: "已回复-有兴趣",
      }],
      authority: "kol_follow_index+verified_starry_binding",
      completeness: "complete",
    });

    const loaded = await loadHomeFollowing();

    expect(loaded.raw).toHaveLength(1);
    expect(loaded.items).toHaveLength(1);
    expect(loaded.items[0]).toMatchObject({
      kol_uid: "starry-history-1",
      follow_id: undefined,
      source_kind: "starry_binding",
      identity: { display: "@历史红人", platform: "youtube" },
    });
  });
});
