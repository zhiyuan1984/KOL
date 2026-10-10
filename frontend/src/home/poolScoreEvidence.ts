import type { PoolJevAssessment } from "./kolContract";

const potentialChoices = ["high_potential", "watch", "insufficient"] as const;
const labels = { high_potential: "高潜", watch: "待观察", insufficient: "资料不足" };
const weights = { high_potential: 100, watch: 50, insufficient: 0 };
const percent = (value: number) => `${Number((value * 100).toFixed(2))}%`;

/** Explain persisted Jev evidence only. Never recompute or overwrite a business score. */
export function poolScoreEvidence(assessment: PoolJevAssessment) {
  const raw = assessment.potential_probabilities;
  const entries = raw && Object.entries(raw);
  const valid = entries && entries.length > 0 && entries.every(([key, value]) =>
    potentialChoices.includes(key as typeof potentialChoices[number]) && Number.isFinite(value) && value >= 0 && value <= 1)
    && Math.abs(entries.reduce((sum, [, value]) => sum + value, 0) - 1) < 0.000001;
  const probabilities = valid ? Object.fromEntries(potentialChoices.map((key) => [key, raw?.[key] ?? 0])) : null;
  const insufficient = probabilities != null && probabilities.insufficient > probabilities.high_potential
    && probabilities.insufficient > probabilities.watch;
  const distribution = probabilities ? potentialChoices.map((key) => `${labels[key]} ${percent(probabilities[key])}`).join(" · ") : null;
  const weighted = probabilities ? potentialChoices.reduce((sum, key) => sum + probabilities[key] * weights[key], 0) : null;
  // Old choice-only responses used 85 for high_potential. Do not force those,
  // unknown versions or inconsistent records through the probability formula.
  const calculation = probabilities && weighted != null && assessment.version === "jev-kol-v1"
    && Math.round(weighted) === assessment.potential_score
    ? `${potentialChoices.map((key) => `${weights[key]} × ${percent(probabilities[key])}`).join(" + ")} = ${Number(weighted.toFixed(4))}，四舍五入为 ${assessment.potential_score}/100`
    : null;
  const confidence = assessment.potential_confidence;
  const confidenceLabel = confidence != null && Number.isFinite(confidence) && confidence >= 0 && confidence <= 1
    ? `模型置信度 ${percent(confidence)}` : "模型置信度未提供";
  return { insufficient, distribution, calculation, confidenceLabel };
}
