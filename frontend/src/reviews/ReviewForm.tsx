import { AttachmentInput } from "./ReviewAttachments";
import type { ReviewField, ReviewMoney } from "../../../shared/review";
export function ReviewForm({
  fields,
  values,
  onChange,
  disabled = false,
  onUploadBusy,
  preview = false,
}: {
  fields: ReviewField[];
  values: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  disabled?: boolean;
  onUploadBusy?: (busy: boolean) => void;
  /** Authoring previews must never upload or read formal attachments. */
  preview?: boolean;
}) {
  const set = (id: string, value: unknown) =>
    onChange({ ...values, [id]: value });
  return (
    <div className="review-form review-dynamic-fields">
      {fields.map((f) => (
        <label key={f.id} data-review-field={f.id} className={["textarea", "attachment"].includes(f.type) ? "review-field-long" : undefined}>
          {f.label}
          {f.required ? " *" : ""}
          {f.type === "money" ? (
            <span className="review-money-input">
              <input
                aria-label={`${f.label}金额`}
                required={f.required}
                disabled={disabled}
                type="text"
                inputMode="decimal"
                value={(values[f.id] as ReviewMoney)?.amount || ""}
                onChange={(e) => {
                  const current = values[f.id] as ReviewMoney | undefined;
                  set(
                    f.id,
                    !e.target.value && !current?.currency
                      ? ""
                      : {
                          amount: e.target.value,
                          currency: current?.currency || "",
                        },
                  );
                }}
              />
              <select
                aria-label={`${f.label}币种`}
                required={f.required}
                disabled={disabled}
                value={(values[f.id] as ReviewMoney)?.currency || ""}
                onChange={(e) => {
                  const current = values[f.id] as ReviewMoney | undefined;
                  set(
                    f.id,
                    !e.target.value && !current?.amount
                      ? ""
                      : {
                          amount: current?.amount || "",
                          currency: e.target.value,
                        },
                  );
                }}
              >
                <option value="">请选择币种</option>
                {f.currencies?.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </span>
          ) : f.type === "attachment" ? (
            preview ? <span className="review-muted">附件上传区域（预览和路径试运行不上传文件）</span> :
            <AttachmentInput
              ids={
                Array.isArray(values[f.id]) ? (values[f.id] as string[]) : []
              }
              disabled={disabled}
              onBusy={onUploadBusy}
              onChange={(ids) => set(f.id, ids)}
            />
          ) : f.type === "textarea" ? (
            <textarea
              required={f.required}
              disabled={disabled}
              value={String(values[f.id] ?? "")}
              onChange={(e) => set(f.id, e.target.value)}
            />
          ) : f.type === "select" || f.type === "multiselect" ? (
            <select
              required={f.required}
              disabled={disabled}
              multiple={f.type === "multiselect"}
              value={
                f.type === "multiselect"
                  ? Array.isArray(values[f.id])
                    ? (values[f.id] as string[])
                    : []
                  : String(values[f.id] ?? "")
              }
              onChange={(e) =>
                set(
                  f.id,
                  f.type === "multiselect"
                    ? Array.from(e.target.selectedOptions).map((o) => o.value)
                    : e.target.value,
                )
              }
            >
              {f.type === "select" && <option value="">请选择</option>}
              {f.options?.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : (
            <input
              required={f.required}
              disabled={disabled}
              type={
                f.type === "number"
                  ? "number"
                  : f.type === "date"
                    ? "date"
                    : "text"
              }
              inputMode={f.type === "decimal" ? "decimal" : undefined}
              step={f.type === "number" ? "any" : undefined}
              value={String(values[f.id] ?? "")}
              onChange={(e) =>
                set(
                  f.id,
                  f.type === "number" && e.target.value !== ""
                    ? Number(e.target.value)
                    : e.target.value,
                )
              }
            />
          )}
          {f.numeric && (
            <small>
              整数最多 {f.numeric.precision - f.numeric.scale} 位，小数最多{" "}
              {f.numeric.scale} 位
              {f.numeric.min !== undefined ? `；下限 ${f.numeric.min}` : ""}
              {f.numeric.max !== undefined ? `；上限 ${f.numeric.max}` : ""}
              。请勿使用千分位分隔符或科学计数法。
            </small>
          )}
          {f.type === "money" && (
            <small>规则来源：{f.currencySource}；不自动换汇。</small>
          )}
        </label>
      ))}
    </div>
  );
}
