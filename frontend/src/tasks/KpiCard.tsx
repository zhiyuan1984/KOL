import { Sparkline } from "./Sparkline";

type KpiCardProps = {
  label: string;
  value: string;
  delta?: number | null;
  deltaUnit?: "%" | "pp" | "h";
  trend?: number[];
  realtime?: boolean;
  invertedGood?: boolean;
  alert?: boolean;
  active?: boolean;
  flash?: boolean;
  onClick?: () => void;
};

export function KpiCard({ label, value, delta = null, deltaUnit = "%", trend, realtime, invertedGood, alert, active, flash, onClick }: KpiCardProps) {
  const hasDelta = !realtime && delta != null && Number.isFinite(delta);
  const deltaUp = (delta || 0) > 0;
  const good = invertedGood ? !deltaUp : deltaUp;
  const deltaText = !hasDelta ? "—" : `${deltaUp ? "▲" : "▼"} ${Math.abs(delta || 0).toFixed(deltaUnit === "pp" || deltaUnit === "h" ? 1 : 0)}${deltaUnit}`;
  const content = <>
    <span className="task-kpi-label" data-ds-stat-label>{label}</span>{alert ? <i className="task-kpi-alert" aria-label="存在异常" /> : null}
    <strong data-ds-stat-value>{value}</strong>
    <span className={`task-kpi-delta${hasDelta ? (good ? " is-good" : " is-bad") : ""}`} data-ds-stat-delta>{realtime ? "4 秒前更新" : deltaText}</span>
    <Sparkline values={trend} label={`${label}趋势`} />
  </>;
  return <article className={`task-kpi-card${onClick ? " is-interactive" : ""}${active && onClick ? " is-active" : ""}${flash ? " is-flashing" : ""}`}>
    {onClick ? <button type="button" className="task-kpi-button" onClick={onClick} aria-pressed={Boolean(active)}>{content}</button> : <div className="task-kpi-content">{content}</div>}
  </article>;
}
