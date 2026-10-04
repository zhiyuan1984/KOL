import type {
  ReviewNode,
  ReviewOperations,
  ReviewField,
  ReviewAssignee,
} from "../../../shared/review";
import type { ReviewContext } from "./api";
export function OperationEditor({
  node,
  fields,
  people,
  onChange,
}: {
  node: ReviewNode;
  fields: ReviewField[];
  people: ReviewContext["people"];
  onChange: (operations: ReviewOperations) => void;
}) {
  const ops = node.operations || {};
  const set = (patch: Partial<ReviewOperations>) =>
    onChange({ ...ops, ...patch });
  const candidates = (
    value: ReviewAssignee | undefined,
    change: (a: ReviewAssignee) => void,
  ) => (
    <label>
      允许的目标人员
      <select
        multiple
        value={value?.kind === "named" ? value.userIds : []}
        onChange={(e) =>
          change({
            kind: "named",
            userIds: Array.from(e.target.selectedOptions).map((o) => o.value),
          })
        }
      >
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <fieldset className="review-form">
      <legend>后续操作与超时策略</legend>
      <label className="review-check">
        <input
          type="checkbox"
          checked={!!ops.transfer}
          onChange={(e) =>
            set({
              transfer: e.target.checked
                ? {
                    candidates: { kind: "named", userIds: [] },
                    deadline: "preserve",
                  }
                : undefined,
            })
          }
        />
        允许当前评审人转交
      </label>
      {ops.transfer && (
        <>
          {candidates(ops.transfer.candidates, (c) =>
            set({ transfer: { ...ops.transfer!, candidates: c } }),
          )}
          <label>
            转交后的期限
            <select
              value={ops.transfer.deadline}
              onChange={(e) =>
                set({
                  transfer: {
                    ...ops.transfer!,
                    deadline: e.target.value as "preserve" | "reset",
                  },
                })
              }
            >
              <option value="preserve">保留原期限</option>
              <option value="reset">按节点时限重新计时</option>
            </select>
          </label>
        </>
      )}
      <label className="review-check">
        <input
          type="checkbox"
          checked={!!ops.countersign}
          disabled={!["all", "sequential"].includes(node.mode || "")}
          onChange={(e) =>
            set({
              countersign: e.target.checked
                ? { candidates: { kind: "named", userIds: [] } }
                : undefined,
            })
          }
        />
        允许加签（仅会签或依次评审）
      </label>
      {ops.countersign &&
        candidates(ops.countersign.candidates, (c) =>
          set({ countersign: { candidates: c } }),
        )}
      <label className="review-check">
        <input
          type="checkbox"
          checked={!!ops.amendment}
          onChange={(e) =>
            set({
              amendment: e.target.checked
                ? { fields: [], restart: "start" }
                : undefined,
            })
          }
        />
        允许请求补充材料
      </label>
      {ops.amendment && (
        <>
          <label>
            可修改的字段
            <select
              multiple
              value={ops.amendment.fields}
              onChange={(e) =>
                set({
                  amendment: {
                    fields: Array.from(e.target.selectedOptions).map(
                      (o) => o.value,
                    ),
                    restart: "start",
                  },
                })
              }
            >
              {fields.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <small>重新提交后从开始完整重审，旧意见只对应原材料。</small>
        </>
      )}
      <label>
        超时处理
        <select
          value={ops.timeout?.action || "none"}
          onChange={(e) =>
            set({
              timeout:
                e.target.value === "none"
                  ? undefined
                  : e.target.value === "remind"
                    ? { action: "remind" }
                    : {
                        action: "transfer",
                        candidates: { kind: "named", userIds: [] },
                        deadline: "reset",
                      },
            })
          }
        >
          <option value="none">只显示超时</option>
          <option value="remind">发送站内提醒</option>
          <option value="transfer">按授权自动升级转交一次</option>
        </select>
      </label>
      {ops.timeout?.action === "transfer" && (
        <>
          {candidates(ops.timeout.candidates, (c) =>
            set({
              timeout: { action: "transfer", candidates: c, deadline: "reset" },
            }),
          )}
          <small>
            须解析到唯一合格目标；升级后重新计时。无目标或再次超时会提示人工接管，不会自动通过。
          </small>
        </>
      )}
      {ops.timeout && (
        <small>
          须配置节点时限。发布即授权该超时策略，后台执行作业需正常运行。
        </small>
      )}
    </fieldset>
  );
}
