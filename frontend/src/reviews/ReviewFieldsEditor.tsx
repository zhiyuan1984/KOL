import { useEffect, useRef, useState } from "react";
import type { ReviewDefinition, ReviewField } from "../../../shared/review";
import { randomUuid } from "../uuid";
import { ReviewForm } from "./ReviewForm";
const types: [ReviewField["type"], string][] = [["text","短文本"],["textarea","长文本"],["number","数值"],["decimal","精确十进制"],["money","货币金额"],["date","日期"],["select","单选"],["multiselect","多选"],["attachment","附件"]];
export function ReviewFieldsEditor({ definition: d, onChange }: { definition: ReviewDefinition; onChange: (d: ReviewDefinition) => void }) {
  const [focusId, setFocusId] = useState(""), [preview, setPreview] = useState<Record<string, unknown>>({});
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => { if (focusId) { container.current?.querySelector<HTMLInputElement>(`[data-field-id="${focusId}"]`)?.focus(); setFocusId(""); } }, [focusId]);
  const locked = d.subjectType === "knowledge_publication";
  const systemField = (f: ReviewField) => locked && ["knowledge_request", "publication_note"].includes(f.id);
  const field = (index: number, patch: Partial<ReviewField>) => onChange({ ...d, fields: d.fields.map((f,i) => i === index ? { ...f, ...patch } : f) });
  function move(index: number, offset: number) { const fields = [...d.fields]; [fields[index],fields[index+offset]] = [fields[index+offset],fields[index]]; onChange({ ...d, fields }); }
  return <div ref={container}>
    <div className="review-section-head"><p>{locked ? "系统资料引用和发布说明保留；可连续添加自定义字段，提交知识审批时填写。" : "可连续添加字段，也可用上移、下移调整填写顺序。"}</p>
      <button className="review-quiet" disabled={d.fields.length >= 100} onClick={() => { const id = `field_${randomUuid().slice(0,8)}`; onChange({ ...d, fields: [...d.fields, { id, label: "新字段", type: "text", required: false }] }); setFocusId(id); }}>添加字段</button>
    </div>
    <div className="review-field-list">
      {d.fields.map((f,i) => <fieldset key={f.id} className="review-field-row" disabled={systemField(f)}>
        <legend>字段 {i+1}</legend>
        <div className="review-field-core">
          <label>字段名称<input data-field-id={f.id} value={f.label} maxLength={120} onChange={e => field(i,{label:e.target.value})} /></label>
          <label>字段类型<select value={f.type} onChange={e => field(i, { type:e.target.value as ReviewField["type"], options:[], numeric:["decimal","money"].includes(e.target.value) ? {precision:18,scale:2} : undefined, currencies:e.target.value === "money" ? [] : undefined, currencySource:e.target.value === "money" ? "" : undefined })}>{types.map(([type,label]) => <option key={type} value={type}>{label}</option>)}</select></label>
          <label className="review-check"><input type="checkbox" checked={f.required} onChange={e => field(i,{required:e.target.checked})} />必填</label>
          <div className="review-toolbar"><button aria-label={`字段 ${i+1} 上移`} disabled={i===0} onClick={() => move(i,-1)}>↑</button><button aria-label={`字段 ${i+1} 下移`} disabled={i===d.fields.length-1} onClick={() => move(i,1)}>↓</button><button onClick={() => onChange({...d,fields:d.fields.filter((_,index) => index!==i)})}>删除字段</button></div>
        </div>
        {["select","multiselect","decimal","money"].includes(f.type) && <details className="review-field-options" open><summary>字段规则</summary><div className="review-form">
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
    <details className="review-preview"><summary>填写效果预览</summary><fieldset disabled aria-label="填写效果预览"><ReviewForm fields={d.fields} values={preview} onChange={setPreview} /></fieldset></details>
  </div>;
}
