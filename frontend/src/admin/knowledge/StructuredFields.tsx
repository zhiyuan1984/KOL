import { KB_STRUCTURED_LEAD, kindLabel } from "../../knowledgeCopy";
import { kindFields, kindSpec, listText, type Row } from "./shared";

/**
 * 结构化字段输入：字段表来自 shared.ts 的 kind 单一来源
 * （与 config/knowledge-kinds.yaml 同步；待后端提供 kinds 接口后替换）。
 */
export default function StructuredFields({ kind, defaults,errors=[] }: { kind: string; defaults?: Row;errors?:{path:string;message:string}[] }) {
  const spec = kindSpec(kind);
  const fields = kindFields(kind);
  if (!spec) {
    return <p className="muted">类型「{kindLabel(kind)}」不在前端字段表里：请与 config/knowledge-kinds.yaml 核对。</p>;
  }
  if (!fields.length) {
    return <p className="muted">{spec.summary}（无专有结构化字段，正文即内容。）</p>;
  }
  return (
    <fieldset className="kbadmin-structured">
      <legend>{`${spec.label}的结构化字段`}</legend>
      <p className="muted">{KB_STRUCTURED_LEAD}</p>
      <div className="kbadmin-form-grid">
        {fields.map((field) => {
          const value = defaults ? listText(defaults[field.key]) : "";
          const label = `${field.label}${field.required ? "（必填）" : ""}`;
          return (
            <label className="field" key={field.key}>
              {label}
              {field.type === "longtext" ? (
                <textarea name={`structured:${field.key}`} rows={3} defaultValue={value} />
              ) : (
                <input
                  name={`structured:${field.key}`}
                  defaultValue={value}
                  placeholder={field.type === "string_list" ? "多项用空格或逗号分隔" : undefined}
                />
              )}
              <span className="muted kbadmin-field-hint" data-admin-kb-structured-field={field.key}>
                {field.key} · {field.type === "string_list" ? "字符串列表" : field.type === "longtext" ? "长文本" : "文本"}
              </span>
              {errors.filter(e=>e.path===`structured:${field.key}`).map(e=><span key={e.path} className="error" data-field-error={e.path}>{e.message}</span>)}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
