import { ConditionEditor } from "./ConditionEditor";
import { useState } from "react";
import { randomUuid } from "../uuid";
import { OperationEditor } from "./OperationEditor";
import type { ReviewDefinition, ReviewNode } from "../../../shared/review";
import type { ReviewContext } from "./api";
const modes = {
  single: "单人评审",
  all: "会签：全部同意",
  any: "或签：任一同意",
  sequential: "依次评审",
};
/** All canvas and property changes update the same parent definition/history. */
export function FlowDesigner({
  definition,
  onChange,
  people,
}: {
  definition: ReviewDefinition;
  onChange: (d: ReviewDefinition) => void;
  people: ReviewContext["people"];
}) {
  const [selected, setSelected] = useState("start"),
    [dragged, setDragged] = useState<string | null>(null);
  const nodes = definition.nodes,
    n = nodes.find((n) => n.id === selected);
  const linear =
    nodes.every((node) =>
      ["start", "review", "cc", "consult", "handler", "end"].includes(
        node.type,
      ),
    ) &&
    nodes.filter((node) => node.type === "start").length === 1 &&
    nodes.filter((node) => node.type === "end").length === 1;
  const update = (patch: Partial<ReviewNode>) =>
    onChange({
      ...definition,
      nodes: nodes.map((x) => (x.id === selected ? { ...x, ...patch } : x)),
    });
  function move(id: string, index: number) {
    const rest = nodes.filter((x) => x.id !== id),
      node = nodes.find((x) => x.id === id);
    if (!node) return;
    if (linear) {
      if (["start", "end"].includes(node.type)) return;
      const ordered = [
        nodes.find((x) => x.type === "start")!,
        ...rest.filter((x) => !["start", "end"].includes(x.type)),
        nodes.find((x) => x.type === "end")!,
      ];
      ordered.splice(Math.max(1, Math.min(index, ordered.length - 1)), 0, node);
      onChange({
        ...definition,
        nodes: ordered.map((x, i) => ({ ...x, next: ordered[i + 1]?.id })),
      });
      return;
    }
    rest.splice(Math.max(0, Math.min(index, rest.length)), 0, node);
    onChange({ ...definition, nodes: rest });
  }
  function add(type: "review" | "condition" | "cc" | "consult" | "handler") {
    const id = `node_${randomUuid().slice(0, 8)}`,
      after =
        n && n.type !== "end" ? n : nodes.find((x) => x.type === "start")!;
    const next = after.next || nodes.find((x) => x.type === "end")?.id;
    const node: ReviewNode = {
      id,
      name: {
        review: "新评审节点",
        condition: "条件分支",
        cc: "抄送",
        consult: "征询意见",
        handler: "办理事项",
      }[type],
      type,
      next,
      ...(type !== "condition"
        ? {
            assignee: { kind: "manager" } as const,
            mode: type === "cc" ? ("all" as const) : ("single" as const),
            reject: "any_reject" as const,
          }
        : {
            otherwise: next,
            condition: {
              field: definition.fields[0]?.id || "",
              op: "eq" as const,
              value: "",
            },
          }),
    };
    const list = nodes.map((x) => (x.id === after.id ? { ...x, next: id } : x));
    list.splice(list.findIndex((x) => x.id === after.id) + 1, 0, node);
    onChange({ ...definition, nodes: list });
    setSelected(id);
  }
  const targets = nodes.filter((x) => x.id !== n?.id && x.type !== "start");
  return (
    <div className="review-designer">
      <section aria-label="流程画布">
        <p className="review-muted">
          {linear
            ? "拖动节点调整实际执行顺序，连线会同步更新。也可用上移、下移操作。"
            : "分支流程：拖动调整画布顺序；执行连线在节点配置中修改。也可用上移、下移操作。"}
        </p>
        <div className="review-toolbar">
          <button type="button" onClick={() => add("review")}>
            添加评审节点
          </button>
          <button type="button" onClick={() => add("condition")}>
            添加条件分支
          </button>
          <button type="button" onClick={() => add("cc")}>
            添加抄送
          </button>
          <button type="button" onClick={() => add("consult")}>
            添加征询
          </button>
          <button type="button" onClick={() => add("handler")}>
            添加办理
          </button>
        </div>
        <ol className="review-canvas">
          {nodes.map((node, index) => (
            <li
              key={node.id}
              className={selected === node.id ? "is-selected" : ""}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragged) move(dragged, index);
                setDragged(null);
              }}
            >
              <button
                type="button"
                draggable={!linear || !["start", "end"].includes(node.type)}
                onDragStart={() => setDragged(node.id)}
                onDragEnd={() => setDragged(null)}
                onClick={() => setSelected(node.id)}
                aria-pressed={selected === node.id}
                className="review-node"
              >
                <strong>{node.name}</strong>
                <span>
                  {node.type === "review"
                    ? modes[node.mode || "single"]
                    : node.type === "cc"
                      ? "抄送（无需决定）"
                      : node.type === "consult"
                        ? "征询意见"
                        : node.type === "handler"
                          ? "办理事项"
                          : node.type === "condition"
                            ? "条件分支"
                            : node.type === "start"
                              ? "发起"
                              : "结束"}
                </span>
              </button>
              <div className="review-toolbar">
                <button
                  type="button"
                  disabled={
                    linear
                      ? ["start", "end"].includes(node.type) || index <= 1
                      : index === 0
                  }
                  aria-label={`${node.name}上移`}
                  onClick={() => move(node.id, index - 1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={
                    linear
                      ? ["start", "end"].includes(node.type) ||
                        index >= nodes.length - 2
                      : index === nodes.length - 1
                  }
                  aria-label={`${node.name}下移`}
                  onClick={() => move(node.id, index + 1)}
                >
                  ↓
                </button>
              </div>
              {node.next && (
                <small>
                  → {node.type === "condition" ? "满足：" : ""}
                  {nodes.find((x) => x.id === node.next)?.name || "目标已删除"}
                </small>
              )}
              {node.otherwise && (
                <small>
                  ↳ 不满足：
                  {nodes.find((x) => x.id === node.otherwise)?.name ||
                    "目标已删除"}
                </small>
              )}
            </li>
          ))}
        </ol>
      </section>
      <section aria-label="节点属性" className="review-form">
        {n ? (
          <>
            <h3>节点配置</h3>
            <label>
              节点名称
              <input
                value={n.name}
                onChange={(e) => update({ name: e.target.value })}
              />
            </label>
            {["review", "cc", "consult", "handler"].includes(n.type) && (
              <>
                <label>
                  {n.type === "review" ? "评审方式" : "处理方式"}
                  <select
                    value={n.mode}
                    onChange={(e) =>
                      update({
                        mode: e.target.value as ReviewNode["mode"],
                        operations: n.operations
                          ? {
                              ...n.operations,
                              countersign: ["all", "sequential"].includes(
                                e.target.value,
                              )
                                ? n.operations.countersign
                                : undefined,
                            }
                          : undefined,
                        reject: "any_reject",
                      })
                    }
                  >
                    {Object.entries(modes).map(([id, label]) => (
                      <option value={id} key={id}>
                        {n.type === "review"
                          ? label
                          : label
                              .replaceAll("评审", "处理")
                              .replaceAll("同意", "完成")}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  人员来源
                  <select
                    value={n.assignee?.kind}
                    onChange={(e) =>
                      update({
                        assignee:
                          e.target.value === "manager"
                            ? { kind: "manager" }
                            : e.target.value === "role"
                              ? { kind: "role", role: "" }
                              : { kind: "named", userIds: [] },
                      })
                    }
                  >
                    <option value="manager">发起人所在组织负责人</option>
                    <option value="named">指定组织人员</option>
                    <option value="role">已授权评审角色</option>
                  </select>
                </label>
                {n.assignee?.kind === "role" && (
                  <label>
                    评审角色
                    <select
                      value={n.assignee.role}
                      onChange={(e) =>
                        update({
                          assignee: { kind: "role", role: e.target.value },
                        })
                      }
                    >
                      <option value="">请选择</option>
                      {[...new Set(people.flatMap((p) => p.roles || []))]
                        .sort()
                        .map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                {n.assignee?.kind === "named" && (
                  <fieldset>
                    <legend>选择人员</legend>
                    {people.map((p) => (
                      <label className="review-check" key={p.id}>
                        <input
                          type="checkbox"
                          checked={
                            n.assignee?.kind === "named" &&
                            n.assignee.userIds.includes(p.id)
                          }
                          onChange={(e) => {
                            if (n.assignee?.kind === "named")
                              update({
                                assignee: {
                                  kind: "named",
                                  userIds: e.target.checked
                                    ? [...n.assignee.userIds, p.id]
                                    : n.assignee.userIds.filter(
                                        (id) => id !== p.id,
                                      ),
                                },
                              });
                          }}
                        />
                        {p.name}
                      </label>
                    ))}
                  </fieldset>
                )}
                {n.type === "review" && (
                  <label>
                    拒绝规则
                    <select
                      value={n.reject}
                      onChange={(e) =>
                        update({
                          reject: e.target.value as ReviewNode["reject"],
                        })
                      }
                    >
                      <option value="any_reject">任一拒绝即终止</option>
                      {n.mode === "any" && (
                        <option value="all_reject">全部拒绝才终止</option>
                      )}
                    </select>
                  </label>
                )}
                <label>
                  期望处理时限（小时，可选）
                  <input
                    type="number"
                    min="1"
                    max="8760"
                    value={n.timeoutHours ?? ""}
                    onChange={(e) =>
                      update({
                        timeoutHours: e.target.value
                          ? Number(e.target.value)
                          : undefined,
                      })
                    }
                  />
                </label>
                <small>
                  默认只显示超时；启用下方策略后由持久作业执行，不会自动通过。
                </small>
                {n.type === "review" && (
                  <OperationEditor
                    node={n}
                    fields={definition.fields}
                    people={people}
                    onChange={(operations) => update({ operations })}
                  />
                )}
              </>
            )}
            {n.type === "condition" && (
              <ConditionEditor
                condition={n.condition}
                fields={definition.fields}
                onChange={(condition) => update({ condition })}
              />
            )}
            {n.type !== "end" && (
              <label>
                {n.type === "condition" ? "条件满足时" : "下一节点"}
                <select
                  value={n.next || ""}
                  onChange={(e) => update({ next: e.target.value })}
                >
                  <option value="">请选择</option>
                  {targets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {n.type === "condition" && (
              <label>
                条件不满足时
                <select
                  value={n.otherwise || ""}
                  onChange={(e) => update({ otherwise: e.target.value })}
                >
                  <option value="">请选择</option>
                  {targets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!["start", "end"].includes(n.type) && (
              <button
                type="button"
                onClick={() => {
                  onChange({
                    ...definition,
                    nodes: nodes.filter((x) => x.id !== n.id),
                  });
                  setSelected("start");
                }}
              >
                删除节点（发布前须修复连线）
              </button>
            )}
          </>
        ) : (
          <p>选择节点以编辑。</p>
        )}
      </section>
    </div>
  );
}
