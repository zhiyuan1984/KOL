import type { AgentRunStatus } from "../api";

const STATUS_LABEL: Record<NonNullable<AgentRunStatus>, string> = {
  listening: "待命",
  running: "执行中",
  waiting_approval: "等你确认",
  queued: "已入队，等待 Codex",
};

export default function RunHud({
  status = "listening",
  phase,
  taskTitle,
  remoteLabel,
}: {
  status?: AgentRunStatus;
  phase?: string;
  taskTitle?: string;
  remoteLabel?: string;
}) {
  const label = STATUS_LABEL[status || "listening"] || "待命";
  return (
    <div className="run-hud" data-run-status={status || "listening"} role="status">
      <span className="run-hud-dot" aria-hidden />
      <div className="run-hud-copy">
        <strong>{label}</strong>
        {phase && <span className="run-hud-phase">{phase}</span>}
        {!phase && taskTitle && <span className="run-hud-phase">{taskTitle}</span>}
      </div>
      {remoteLabel && <span className="run-hud-remote">{remoteLabel}</span>}
      <span className="run-hud-hint">刷新页面不会取消后台执行</span>
    </div>
  );
}
