import { describe, expect, it } from "vitest";
import { toPoolKol } from "./kolContract";
import { poolScoreEvidence } from "./poolScoreEvidence";

describe("persisted pool score evidence", () => {
  it("retains the stored probabilities/version and explains the reported 1/100 without equating it with quality", () => {
    const card = toPoolKol({ kol_uid: "stored", handle: "South Florida Fishing Channel", potential_score: "1",
      potential_probabilities: '{"watch":0.01,"high_potential":0,"insufficient":0.99}',
      potential_confidence: 0.98, assessment_model: "jev-1.13", assessment_version: "jev-kol-v1" });
    expect(card?.assessment?.potential_probabilities).toEqual({ watch: 0.01, high_potential: 0, insufficient: 0.99 });
    expect(card?.assessment?.version).toBe("jev-kol-v1");
    expect(poolScoreEvidence(card!.assessment!)).toEqual({ insufficient: true,
      distribution: "高潜 0% · 待观察 1% · 资料不足 99%",
      calculation: "100 × 0% + 50 × 1% + 0 × 99% = 0.5，四舍五入为 1/100",
      confidenceLabel: "模型置信度 98%" });
  });
  it("does not fabricate probabilities, confidence or a calculation for incomplete history", () => {
    expect(poolScoreEvidence({ potential_score: 85 })).toEqual({ insufficient: false, distribution: null, calculation: null, confidenceLabel: "模型置信度未提供" });
  });
  it("keeps a real zero confidence instead of treating it as missing", () => {
    expect(poolScoreEvidence({ potential_confidence: 0 }).confidenceLabel).toBe("模型置信度 0%");
  });
  it.each(["unknown", undefined, "jev-kol-v1"])("never presents a formula incompatible with the stored score/version %s", (version) => {
    expect(poolScoreEvidence({ potential_score: 85, version, potential_probabilities: { high_potential: 1 } }).calculation).toBeNull();
  });
  it.each([{ watch: -1, insufficient: 2 }, { watch: 0.1 }, { unknown: 1 }, { insufficient: NaN }])("rejects invalid distributions %j", (probabilities) => {
    expect(poolScoreEvidence({ potential_score: 1, version: "jev-kol-v1", potential_probabilities: probabilities }).distribution).toBeNull();
  });
});
