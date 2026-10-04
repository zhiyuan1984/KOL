import type {
  ReviewCondition,
  ReviewField,
  ReviewPredicate,
} from "../../../shared/review";

export function ConditionEditor({
  condition,
  fields,
  onChange,
  depth = 1,
}: {
  condition?: ReviewCondition;
  fields: ReviewField[];
  onChange: (c: ReviewCondition) => void;
  depth?: number;
}) {
  const initialValue = (f?: ReviewField): ReviewPredicate["value"] =>
    f?.type === "money"
      ? { amount: "", currency: "" }
      : f?.type === "number"
        ? 0
        : f?.options?.[0] || "";
  const leaf = (): ReviewPredicate => ({
    field: fields[0]?.id || "",
    op: "eq",
    value: initialValue(fields[0]),
  });
  const c = condition || leaf();
  const group = c.op === "all" || c.op === "any",
    kind = group ? c.op : c.op === "not" ? "not" : "field";
  return (
    <fieldset className="review-form">
      <legend>条件（第 {depth} 层）</legend>
      <label>
        组合方式
        <select
          value={kind}
          onChange={(e) => {
            const k = e.target.value;
            onChange(
              k === "field"
                ? leaf()
                : k === "not"
                  ? { op: "not", condition: leaf() }
                  : { op: k as "all" | "any", conditions: [leaf()] },
            );
          }}
        >
          <option value="field">字段比较</option>
          {depth < 6 && (
            <>
              <option value="all">全部满足</option>
              <option value="any">任一满足</option>
              <option value="not">取反</option>
            </>
          )}
        </select>
      </label>
      {c.op === "not" ? (
        <ConditionEditor
          condition={c.condition}
          fields={fields}
          depth={depth + 1}
          onChange={(child) => onChange({ op: "not", condition: child })}
        />
      ) : c.op === "all" || c.op === "any" ? (
        <>
          {c.conditions.map((child, index) => (
            <div key={index}>
              <ConditionEditor
                condition={child}
                fields={fields}
                depth={depth + 1}
                onChange={(next) =>
                  onChange({
                    ...c,
                    conditions: c.conditions.map((v, i) =>
                      i === index ? next : v,
                    ),
                  })
                }
              />
              <button
                type="button"
                disabled={c.conditions.length === 1}
                onClick={() =>
                  onChange({
                    ...c,
                    conditions: c.conditions.filter((_, i) => i !== index),
                  })
                }
              >
                删除条件 {index + 1}
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={c.conditions.length >= 20}
            onClick={() =>
              onChange({ ...c, conditions: [...c.conditions, leaf()] })
            }
          >
            添加条件
          </button>
        </>
      ) : (
        <>
          <label>
            条件字段
            <select
              value={c.field}
              onChange={(e) => {
                const f = fields.find((f) => f.id === e.target.value);
                onChange({
                  field: e.target.value,
                  op: f?.type === "multiselect" ? "contains" : "eq",
                  value: initialValue(f),
                });
              }}
            >
              <option value="">请选择</option>
              {fields.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            运算符
            <select
              value={c.op}
              onChange={(e) =>
                onChange({ ...c, op: e.target.value as ReviewPredicate["op"] })
              }
            >
              {[
                ["eq", "等于"],
                ["ne", "不等于"],
                ["gt", "大于"],
                ["gte", "大于等于"],
                ["lt", "小于"],
                ["lte", "小于等于"],
                ["contains", "包含"],
              ].map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            比较值
            <input
              type={
                fields.find((f) => f.id === c.field)?.type === "number"
                  ? "number"
                  : "text"
              }
              value={typeof c.value === "object" ? c.value.amount : c.value}
              onChange={(e) =>
                onChange({
                  ...c,
                  value:
                    typeof c.value === "object"
                      ? { ...c.value, amount: e.target.value }
                      : fields.find((f) => f.id === c.field)?.type === "number"
                        ? Number(e.target.value)
                        : e.target.value,
                })
              }
            />
          </label>
          {typeof c.value === "object" && (
            <label>
              比较币种
              <select
                value={c.value.currency}
                onChange={(e) =>
                  onChange({
                    ...c,
                    value: {
                      amount: typeof c.value === "object" ? c.value.amount : "",
                      currency: e.target.value,
                    },
                  })
                }
              >
                <option value="">请选择币种</option>
                {fields
                  .find((f) => f.id === c.field)
                  ?.currencies?.map((currency) => (
                    <option key={currency} value={currency}>
                      {currency}
                    </option>
                  ))}
              </select>
            </label>
          )}
        </>
      )}
    </fieldset>
  );
}
