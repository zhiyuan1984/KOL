import type { ReactNode } from "react";

export type SafeResultValue = string | number | boolean | null | SafeResultValue[] | { [key: string]: SafeResultValue };
export type ResultRenderer = (value: SafeResultValue) => ReactNode;

const renderers = new Map<string, ResultRenderer>();

export function registerResultRenderer(resultType: string, renderer: ResultRenderer): () => void {
  renderers.set(resultType, renderer);
  return () => { if (renderers.get(resultType) === renderer) renderers.delete(resultType); };
}

function safeFallback(value: SafeResultValue): ReactNode {
  if (value == null || typeof value === "boolean") return String(value ?? "");
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return <ul className="result-fallback-list">{value.map((item, index) =>
    <li key={index}>{safeFallback(item)}</li>)}</ul>;
  return <dl className="result-fallback-fields">{Object.entries(value).map(([key, item]) => <div key={key}>
    <dt>{key}</dt><dd>{safeFallback(item)}</dd>
  </div>)}</dl>;
}

export default function ResultRendererRegistry({ resultType, value }: { resultType: string; value: SafeResultValue }) {
  const renderer = renderers.get(resultType);
  return <div className="result-renderer" data-result-renderer={renderer ? resultType : "safe-fallback"}>
    {renderer ? renderer(value) : safeFallback(value)}
  </div>;
}
