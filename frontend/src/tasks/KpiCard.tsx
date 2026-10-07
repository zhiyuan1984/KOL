type KpiCardProps = {
  label: string;
  value: string;
  alert?: boolean;
  active?: boolean;
  onClick?: () => void;
};

export function KpiCard({ label, value, alert, active, onClick }: KpiCardProps) {
  const content = <>
    <span className="task-kpi-label">{label}</span>{alert ? <i className="task-kpi-alert" aria-label="存在异常" /> : null}
    <strong>{value}</strong>
  </>;
  return <article className={`task-kpi-card${onClick ? " is-interactive" : ""}${active && onClick ? " is-active" : ""}`}>
    {onClick ? <button type="button" className="task-kpi-button" onClick={onClick} aria-pressed={Boolean(active)}>{content}</button> : <div className="task-kpi-content">{content}</div>}
  </article>;
}
