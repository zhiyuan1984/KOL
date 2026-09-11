import { useEffect, useMemo, useState } from "react";
import {
  buildJourneyGuide,
  SOP_PHASES,
  sopPhaseByStage,
  readJourney,
  rememberJourney,
  subscribeJourney,
  type JourneyGuideModel,
} from "../journey";

type KolLike = {
  handle: string;
  stage_code?: string;
  stage_label?: string;
  unbound?: boolean;
  exception?: boolean;
  days_in_stage?: number;
  suggested_stage?: string;
};

type TaskLike = {
  title?: string;
  skill?: string;
  skill_id?: string;
  task_type?: string;
  kol_name?: string;
  status?: string;
  priority?: string;
};

export default function JourneyGuide({
  variant = "home",
  kols,
  tasks,
  definitions,
  onPrefill,
}: {
  variant?: "home" | "compact";
  kols?: KolLike[];
  tasks?: TaskLike[];
  definitions?: { id: string; title?: string; granted?: boolean; in_market?: boolean }[];
  onPrefill?: (prompt: string, intent?: string, label?: string) => void;
}) {
  const [event, setEvent] = useState(readJourney);
  useEffect(() => subscribeJourney(() => setEvent(readJourney())), []);
  useEffect(() => {
    if (variant === "home" && !readJourney()) rememberJourney({ kind: "enter" });
  }, [variant]);

  const model: JourneyGuideModel = useMemo(
    () => buildJourneyGuide({ event, kols, tasks, definitions }),
    [event, kols, tasks, definitions],
  );

  const onNext = () => {
    if (!model.nextPrompt) return;
    rememberJourney({
      kind: "skill",
      skillId: model.nextIntent,
      skillLabel: model.nextLabel,
      handle: event?.handle || kols?.[0]?.handle,
      stageCode: model.stageCode,
    });
    onPrefill?.(model.nextPrompt, model.nextIntent, model.nextLabel);
  };

  return (
    <section className={"journey-guide" + (variant === "compact" ? " is-compact" : "")} data-journey-guide data-journey-funnel={model.funnelId}>
      <ol className="journey-strip" aria-label="合作之旅八个阶段">
        {SOP_PHASES.map((phase) => (
          <li
            key={phase.id}
            data-journey-phase={phase.id}
            className={sopPhaseByStage(model.stageCode)?.id === phase.id ? "is-current" : ""}
          >
            <span>{phase.label}</span>
          </li>
        ))}
      </ol>
      <div className="journey-copy">
        <strong data-journey-title>{model.title}</strong>
        <p data-journey-body>{model.body}</p>
        <p className="journey-mode">{model.stageLabel ? `${model.stageLabel} · ${model.mode}` : model.mode} · 发送 ≠ 推进阶段</p>
      </div>
      {model.nextPrompt && (
        <button type="button" className="journey-next" data-journey-next={model.nextIntent || ""} onClick={onNext}>
          下一步：{model.nextLabel} →
        </button>
      )}
      {variant === "home" && model.gaps.length ? (
        <p className="journey-gaps" data-journey-gaps>
          还缺技能：{model.gaps.map((gap) => `${gap.title}（${gap.reason}）`).join("；")}
        </p>
      ) : null}
    </section>
  );
}
