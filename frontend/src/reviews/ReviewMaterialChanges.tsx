import type { InstanceView } from "./api";
import { formatReviewValue } from "./formatReviewValue";
import { AttachmentLinks } from "./ReviewAttachments";

export function ReviewMaterialChanges({ instance: i }: { instance: InstanceView }) {
  const previous = [...(i.revisions || [])].filter(r => r.round < (i.round || 1)).sort((a, b) => b.round - a.round)[0];
  if (!previous) return null;
  const changed = i.definition.fields.filter(f => JSON.stringify(previous.values[f.id]) !== JSON.stringify(i.values[f.id]));
  return <section aria-label="本轮材料变化"><h3>本轮材料变化 · 第 {previous.round} → {i.round || 1} 轮</h3>
    {!changed.length ? <p>本轮申请材料与上一轮一致。</p> : <dl className="review-values">{changed.map(f => <div key={f.id} className="review-field-long"><dt>{f.label}</dt><dd>
      <details><summary>上一轮材料</summary>{f.type === "attachment" ? <AttachmentLinks ids={Array.isArray(previous.values[f.id]) ? previous.values[f.id] as string[] : []} instanceId={i.id} /> : formatReviewValue(previous.values[f.id])}</details>
      <strong>本轮：</strong>{f.type === "attachment" ? <AttachmentLinks ids={Array.isArray(i.values[f.id]) ? i.values[f.id] as string[] : []} instanceId={i.id} /> : formatReviewValue(i.values[f.id])}
    </dd></div>)}</dl>}<p className="review-muted">旧轮次的同意不覆盖本轮修改。</p>
  </section>;
}
