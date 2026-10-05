import { useEffect, useRef, useState } from "react";
import type { ReviewDefinition, ReviewField, ReviewIssue } from "../../../shared/review";
import { randomUuid } from "../uuid";
import { ReviewForm } from "./ReviewForm";
const types: [ReviewField["type"], string][] = [["text","短文本"],["textarea","长文本"],["number","数值"],["decimal","精确十进制"],["money","货币金额"],["date","日期"],["select","单选"],["multiselect","多选"],["attachment","附件"]];
export function ReviewFieldsEditor({ definition: d, onChange, target }: { definition: ReviewDefinition; onChange: (d: ReviewDefinition) => void; target?: ReviewIssue }) {
  const [focusId, setFocusId] = useState(""), [preview, setPreview] = useState<Record<string, unknown>>({});
  const [selected, setSelected] = useState(d.fields[0]?.id || ""), [dragged, setDragged] = useState(""), [notice, setNotice] = useState("");
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => { if (focusId) { container.current?.querySelector<HTMLInputElement>(`[data-field-id="${focusId}"]`)?.focus(); setFocusId(""); } }, [focusId]);
  useEffect(() => {
    if (target?.target?.id) { setSelected(target.target.id); setFocusId(target.target.id); }
  }, [target]);
  const locked = d.subjectType === "knowledge_publication";
  const systemField = (f: ReviewField) => locked && ["knowledge_request", "publication_note"].includes(f.id);
  const field = (index: number, patch: Partial<ReviewField>) => onChange({ ...d, fields: d.fields.map((f,i) => i === index ? { ...f, ...patch } : f) });
  function reorder(index: number, to: number) {
    if (to < 0 || to >= d.fields.length || systemField(d.fields[index]) || systemField(d.fields[to])) return;
    const fields = [...d.fields]; const [item] = fields.splice(index, 1); fields.splice(to, 0, item); onChange({ ...d, fields });
  }
  function move(index: number, offset: number) { reorder(index, index + offset); }
  function remove(f: ReviewField) {
    const referenced = d.nodes.filter(n => JSON.stringify(n.condition || {}).includes(`"${f.id}"`) || n.operations?.amendment?.fields.includes(f.id));
    onChange({ ...d, fields: d.fields.filter(x => x.id !== f.id) });
    setNotice(`已删除「${f.label}」，可在顶部撤销。${referenced.length ? `以下步骤引用此字段，需重新配置：${referenced.map(n => n.name).join("、")}` : ""}`);
    setPreview(v => Object.fromEntries(Object.entries(v).filter(([id]) => id !== f.id)));
  }
  return <div ref={container} className="review-fields-workspace"><section aria-label="字段编辑">
    <div className="review-section-head"><h2>表单字段 · {d.fields.length}</h2>
      <button className="review-quiet" disabled={d.fields.length >= 100} onClick={() => { const id = `field_${randomUuid().slice(0,8)}`; onChange({ ...d, fields: [...d.fields, { id, label: "新字段", type: "text", required: false }] }); setSelected(id); setFocusId(id); }}>添加字段</button>
    </div>
    <p className="review-muted">{locked ? "系统字段保留；可添加自定义字段。" : "设置员工发起时填写的内容，可拖动或上下移动排序。"}</p>
    {notice && <p role="status">{notice}</p>}
    {!d.fields.length && <p>无需填写字段；也可添加需要员工提供的信息。</p>}
    <div className="review-field-list">
      {d.fields.map((f,i) => <fieldset key={f.id} className={`review-field-row${selected === f.id ? " is-selected" : ""}`} disabled={systemField(f)} onFocus={() => setSelected(f.id)} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const id = e.dataTransfer.getData("text/plain") || dragged; const from = d.fields.findIndex(x => x.id === id); if (from >= 0) reorder(from, i); setDragged(""); }}>
        <legend className="review-sr-only">字段 {i+1}</legend>
        <div className="review-field-core">
          <button type="button" className="review-field-grip" draggable={!systemField(f)} aria-label={`拖动字段 ${i+1} 排序`} title="拖动排序，也可使用上下移动" onDragStart={e => { e.dataTransfer.setData("text/plain", f.id); setDragged(f.id); }} onDragEnd={() => setDragged("")}>⠿</button>
          <label>字段名称<input data-field-id={f.id} value={f.label} maxLength={120} onChange={e => field(i,{label:e.target.value})} /></label>
          <label>字段类型<select value={f.type} onChange={e => { setPreview(v => Object.fromEntries(Object.entries(v).filter(([id]) => id !== f.id))); field(i, { type:e.target.value as ReviewField["type"], options:[], numeric:["decimal","money"].includes(e.target.value) ? {precision:18,scale:2} : undefined, currencies:e.target.value === "money" ? [] : undefined, currencySource:e.target.value === "money" ? "" : undefined }); }}>{types.map(([type,label]) => <option key={type} value={type}>{label}</option>)}</select></label>
          <label className="review-check"><input type="checkbox" checked={f.required} onChange={e => field(i,{required:e.target.checked})} />必填</label>
          <div className="review-toolbar"><button aria-label={`字段 ${i+1} 上移`} disabled={i===0 || systemField(d.fields[i-1])} onClick={() => move(i,-1)}>↑</button><button aria-label={`字段 ${i+1} 下移`} disabled={i===d.fields.length-1 || systemField(d.fields[i+1])} onClick={() => move(i,1)}>↓</button><button aria-label={`删除字段 ${i+1}`} title="删除字段（可撤销）" onClick={() => remove(f)}>×</button></div>
        </div>
        {selected === f.id && ["select","multiselect","decimal","money"].includes(f.type) && <details className="review-field-options" open><summary>字段规则</summary><div className="review-form">
          {["select","multiselect"].includes(f.type) && <label>选项，每行一个<textarea value={f.options?.join("\n") || ""} onChange={e => field(i,{options:e.target.value.split("\n")})} /></label>}
          {["decimal","money"].includes(f.type) && <>
            <label>总精度（位）<input type="number" min={1} max={38} value={f.numeric?.precision ?? ""} onChange={e => field(i,{numeric:{...f.numeric!,precision:Number(e.target.value)}})} /></label>
            <label>小数位<input type="number" min={0} max={18} value={f.numeric?.scale ?? ""} onChange={e => field(i,{numeric:{...f.numeric!,scale:Number(e.target.value)}})} /></label>
            <label>下限（可选）<input inputMode="decimal" value={f.numeric?.min ?? ""} onChange={e => field(i,{numeric:{...f.numeric!,min:e.target.value || undefined}})} /></label>
            <label>上限（可选）<input inputMode="decimal" value={f.numeric?.max ?? ""} onChange={e => field(i,{numeric:{...f.numeric!,max:e.target.value || undefined}})} /></label>
            <p>精确保存原始数值，不四舍五入。整数位最多为总精度减小数位。</p>
          </>}
          {f.type === "money" && <><label>允许币种，每行一个代码<textarea value={f.currencies?.join("\n") || ""} onChange={e => field(i,{currencies:e.target.value.split("\n")})} /></label><label>币种及金额规则来源与版本<input value={f.currencySource || ""} onChange={e => field(i,{currencySource:e.target.value})} /></label><p>不自动换汇，跨币种比较由服务端阻断。</p></>}
        </div></details>}
      </fieldset>)}
    </div>
    </section><section className="review-preview" aria-label="员工填写预览"><h2>员工填写预览</h2><p className="review-muted">随编辑即时更新；预览填写不会保存为申请。</p><ReviewForm fields={d.fields} values={preview} onChange={setPreview} preview /></section>
  </div>;
}
