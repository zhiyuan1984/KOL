type SparklineProps = {
  values?: number[];
  label?: string;
  className?: string;
};

export function Sparkline({ values = [], label = "趋势", className = "" }: SparklineProps) {
  const safe = values.length ? values.map((value) => Number.isFinite(value) ? value : 0) : [0, 0];
  const min = Math.min(...safe);
  const max = Math.max(...safe);
  const span = max - min || 1;
  const points = safe.map((value, index) => {
    const x = safe.length === 1 ? 24 : (index / (safe.length - 1)) * 48;
    const y = 15 - ((value - min) / span) * 14;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  return <svg className={`task-sparkline ${className}`.trim()} viewBox="0 0 48 16" role="img" aria-label={label} preserveAspectRatio="none">
    <polyline points={points} fill="none" vectorEffect="non-scaling-stroke" />
  </svg>;
}
