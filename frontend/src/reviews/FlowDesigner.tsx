import { ConditionEditor } from "./ConditionEditor";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { randomUuid } from "../uuid";
import { OperationEditor } from "./OperationEditor";
import type { ReviewDefinition, ReviewIssue, ReviewNode } from "../../../shared/review";
import type { ReviewContext } from "./api";
import { deleteReviewStep, insertReviewStep, moveReviewStep, reviewSequence } from "./reviewGraph";
const modes = { single: "单人评审", all: "会签：全部同意", any: "或签：任一同意", sequential: "依次评审" };
const kinds = [["review", "评审", "指定人员作出评审决定"], ["condition", "条件分支", "根据表单内容进入不同路径"], ["cc", "抄送", "将流程信息通知相关人员"], ["consult", "征询", "向指定人员征求意见，完成后继续"], ["handler", "办理", "交给指定人员执行事项，完成后继续"]] as const;
function continuation(n: ReviewNode) {
  if (n.type === "cc") return "抄送无需决定，成功解析人员后直接继续。";
  const action = n.type === "review" ? "同意" : n.type === "consult" ? "提交意见" : "完成办理";
  return n.mode === "any" ? `任一人${action}后继续。` : n.mode === "all" ? `全部人员${action}后继续。` : n.mode === "sequential" ? `人员依次${action}，全部完成后继续。` : `指定人员${action}后继续。`;
}
export function FlowDesigner({ definition, onChange, people, issues = [], target, onIssue }: { definition: ReviewDefinition; onChange: (d: ReviewDefinition) => void; people: ReviewContext["people"]; issues?: ReviewIssue[]; target?: ReviewIssue; onIssue?: (issue: ReviewIssue) => void }) {
  const [selected, setSelected] = useState(definition.nodes.find(n => n.type === "start")?.id || ""), [notice, setNotice] = useState("");
  const [insertion, setInsertion] = useState<{ source: string; edge: "next" | "otherwise" }>();
  const properties = useRef<HTMLElement>(null);
  const focusedTarget = useRef<ReviewIssue | undefined>(undefined);
  const nodes = definition.nodes, n = nodes.find(n => n.id === selected), sequence = reviewSequence(definition), linear = Boolean(sequence);
  useEffect(() => {
    if (!target?.target?.id || focusedTarget.current === target) return;
    if (selected !== target.target.id) { setSelected(target.target.id); return; }
    const frame = requestAnimationFrame(() => {
      focusedTarget.current = target;
      const property = target.target?.property;
      const root = properties.current;
      if (property?.startsWith("operations")) {
        (root?.querySelector("details[open] summary") as HTMLElement | null)?.focus();
        return;
      }
      const labels = Array.from(root?.querySelectorAll("label") || []);
      const name = property?.startsWith("assignee") ? "人员来源" : property?.startsWith("mode") ? "方式" : property?.startsWith("condition") ? "字段" : "步骤名称";
      const label = labels.find(label => label.textContent?.includes(name));
      (label?.querySelector("input,select,textarea") as HTMLElement | undefined)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [target, selected]);
  const update = (patch: Partial<ReviewNode>) => onChange({ ...definition, nodes: nodes.map(x => x.id === selected ? { ...x, ...patch } : x) });
  function add(type: typeof kinds[number][0]) {
    if (!insertion) return;
    const id = `node_${randomUuid().slice(0, 8)}`;
    const node: ReviewNode = { id, name: kinds.find(k => k[0] === type)![1], type,
      ...(type === "condition" ? { condition: { field: definition.fields[0]?.id || "", op: "eq" as const, value: "" } } : { assignee: { kind: "manager" as const }, mode: type === "cc" ? "all" as const : "single" as const, reject: "any_reject" as const }) };
    onChange(insertReviewStep(definition, insertion.source, insertion.edge, node)); setSelected(id); setInsertion(undefined);
  }
  const targets = nodes.filter(x => x.id !== n?.id && x.type !== "start");
  function assignee(node: ReviewNode) {
    if (!node.assignee) return "人员来源：尚未设置";
    if (node.assignee.kind === "manager") return "处理人：发起人所在组织负责人 · 按发起人解析";
    if (node.assignee.kind === "role") return `处理角色：${node.assignee.role || "尚未设置"}`;
    return `处理人：${node.assignee.userIds.map(id => people.find(p => p.id === id)?.name || id).join("、") || "尚未设置"}`;
  }
  function connector(node: ReviewNode, edge: "next" | "otherwise") {
    const dest = nodes.find(n => n.id === node[edge]);
    return <div className="review-connector" key={edge}>
      <span>{node.type === "condition" ? edge === "next" ? "条件满足" : "条件不满足" : "继续"} → {dest?.name || "尚未连接"}</span>
      <button type="button" aria-label={`在${node.name}${edge === "otherwise" ? "不满足路径" : "之后"}添加步骤`} disabled={nodes.length >= 100} onClick={() => setInsertion({ source: node.id, edge })}>＋</button>
      {insertion?.source === node.id && insertion.edge === edge && <div className="review-insert-menu" aria-label="选择步骤类型">{kinds.map(([type, title, explanation]) => <button type="button" key={type} onClick={() => add(type)}><strong>{title}</strong><small>{explanation}</small></button>)}<button type="button" onClick={() => setInsertion(undefined)}>取消添加</button></div>}
    </div>;
  }
  const seen = new Set<string>();
  function renderNode(id: string | undefined): ReactNode {
    const node = nodes.find(n => n.id === id);
    if (!node) return <li className="review-error">连接目标不存在，请在右侧修复路径。</li>;
    if (seen.has(node.id)) return <li className="review-merge"><button type="button" onClick={() => setSelected(node.id)}>汇合 / 引用：{node.name}</button></li>;
    seen.add(node.id);
    const terminal = ["start", "end"].includes(node.type), index = sequence?.findIndex(n => n.id === node.id) ?? -1;
    const problems = issues.filter(x => x.target?.id === node.id);
    return <li key={node.id} data-node-id={node.id} className={`review-graph-step${selected === node.id ? " is-selected" : ""}${terminal ? " is-terminal" : ""}${node.type === "condition" ? " is-branch" : ""}`}>
      <button type="button" className="review-node" aria-pressed={selected === node.id} draggable={linear && !terminal} onDragStart={e => e.dataTransfer.setData("text/plain", node.id)} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (linear) onChange(moveReviewStep(definition, e.dataTransfer.getData("text/plain"), index)); }} onClick={() => setSelected(node.id)}>
        <strong>{node.name}</strong>{!terminal && <><span>{node.type === "review" ? modes[node.mode || "single"] : kinds.find(k => k[0] === node.type)?.[1]}</span>{node.type !== "condition" && <small>{assignee(node)}</small>}<small>{problems.length ? `待配置：${problems[0].message}` : "配置状态以检查结果为准"}</small></>}
      </button>
      {!!problems.length && <button type="button" onClick={() => { setSelected(node.id); onIssue?.({ ...problems[0] }); }}>定位缺项</button>}
      {linear && !terminal && <div className="review-node-move"><button type="button" disabled={index <= 1} aria-label={`${node.name}上移`} onClick={() => onChange(moveReviewStep(definition, node.id, index - 1))}>↑</button><button type="button" disabled={index >= nodes.length - 2} aria-label={`${node.name}下移`} onClick={() => onChange(moveReviewStep(definition, node.id, index + 1))}>↓</button></div>}
      {node.type === "condition" ? <><p className="review-muted">{node.next === node.otherwise ? "两条路径当前相同，可在各路径添加步骤。" : "按条件选择一条路径。"}</p><div className="review-branches">{(["next", "otherwise"] as const).map(edge => <section key={edge} aria-label={edge === "next" ? "条件满足路径" : "条件不满足路径"}>{connector(node, edge)}<ol>{renderNode(node[edge])}</ol></section>)}</div></> : node.type !== "end" && <>{connector(node, "next")}<ol>{renderNode(node.next)}</ol></>}
    </li>;
  }
  const start = nodes.find(n => n.type === "start");
  const graph = start ? renderNode(start.id) : <li>尚无发起步骤。</li>;
  const unreachable = nodes.filter(n => !seen.has(n.id));
  return (<div className="review-designer"><section aria-label="流程画布"><h2>评审步骤</h2><p className="review-muted">在连接处添加步骤；{linear ? "拖动或上下移动会同步调整执行顺序。" : "分支按实际路径执行，汇合引用同一个步骤。"}</p>{notice && <p role="status">{notice}</p>}<ol className="review-canvas">{graph}</ol>{!!unreachable.length && <section aria-label="未连接步骤"><h3>未连接步骤（需修复）</h3>{unreachable.map(node => <button key={node.id} onClick={() => setSelected(node.id)}>{node.name}</button>)}</section>}</section>
      <section aria-label="步骤配置" className="review-form" ref={properties}>
        {n ? (
          <>
            <h3>步骤信息</h3>
            <label>
              步骤名称
              <input
                value={n.name}
                onChange={(e) => update({ name: e.target.value })}
              />
            </label>
            {["review", "cc", "consult", "handler"].includes(n.type) && (
              <>
                <h3>人员与方式</h3>
                <p className="review-muted">{continuation(n)}</p>
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
                <details open={Boolean(target?.target?.property?.startsWith("operations"))}><summary>处理规则</summary><div className="review-form">
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
                </div></details>
              </>
            )}
            {n.type === "condition" && (
              <ConditionEditor
                condition={n.condition}
                fields={definition.fields}
                onChange={(condition) => update({ condition })}
              />
            )}
            {n.type !== "end" && !linear && (
              <label>
                {n.type === "condition" ? "条件满足时" : "后续步骤（按连线执行）"}
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
            {n.type === "condition" && n.next !== n.otherwise && <p className="review-muted">此分支通往不同路径；删除前请将两条路径汇合至同一步骤，避免丢失路径。</p>}
            {!["start", "end"].includes(n.type) && (
              <button
                type="button"
                disabled={!n.next || (n.type === "condition" && n.next !== n.otherwise)}
                onClick={() => {
                  onChange(deleteReviewStep(definition, n.id));
                  setSelected(nodes.find(x => x.type === "start")?.id || "");
                  setNotice("步骤已删除，前后路径已连接，可在顶部撤销。");
                }}
              >
                删除步骤（自动连接前后路径）
              </button>
            )}
          </>
        ) : (
          <p>选择步骤以配置。</p>
        )}
      </section>
    </div>
  );
}
