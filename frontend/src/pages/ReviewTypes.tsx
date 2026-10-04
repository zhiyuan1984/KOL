import { ReviewOrganization } from "../reviews/ReviewOrganization";
import { PublishChanges } from "../reviews/ReviewChanges";
import { useEffect, useReducer, useState } from "react";
import { Link } from "react-router-dom";
import {
  emptyReviewDefinition,
  type ReviewDefinition,
  type ReviewTemplate,
  type ReviewIssue,
  type ReviewField,
} from "../../../shared/review";
import { reviewApi, type ReviewContext } from "../reviews/api";
import { FlowDesigner } from "../reviews/FlowDesigner";
import { ReviewForm } from "../reviews/ReviewForm";
import { useReviewCommand } from "../reviews/useReviewCommand";
import "../reviews/reviews.css";
type History = {
  past: ReviewDefinition[];
  present: ReviewDefinition;
  future: ReviewDefinition[];
};
export function definitionHistory(
  s: History,
  a: { type: "edit" | "reset" | "undo" | "redo"; value?: ReviewDefinition },
): History {
  if (a.type === "reset") return { past: [], present: a.value!, future: [] };
  if (a.type === "edit")
    return {
      past: [...s.past.slice(-49), s.present],
      present: a.value!,
      future: [],
    };
  if (a.type === "undo" && s.past.length)
    return {
      past: s.past.slice(0, -1),
      present: s.past.at(-1)!,
      future: [s.present, ...s.future],
    };
  if (a.type === "redo" && s.future.length)
    return {
      past: [...s.past, s.present],
      present: s.future[0],
      future: s.future.slice(1),
    };
  return s;
}
export default function ReviewTypes() {
  const [context, setContext] = useState<ReviewContext>(),
    [list, setList] = useState<ReviewTemplate[]>([]),
    [active, setActive] = useState<ReviewTemplate>(),
    [editing, setEditing] = useState(false),
    [tab, setTab] = useState("basic"),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [issues, setIssues] = useState<ReviewIssue[]>([]),
    [validation, setValidation] = useState(""),
    [values, setValues] = useState<Record<string, unknown>>({}),
    [simulation, setSimulation] = useState(""),
    [requester, setRequester] = useState("");
  const [history, dispatch] = useReducer(definitionHistory, {
      past: [],
      present: emptyReviewDefinition(),
      future: [],
    }),
    d = history.present;
  const dirty =
    editing &&
    (!active || JSON.stringify(active.definition) !== JSON.stringify(d));
  async function load() {
    const [ctx, rows] = await Promise.all([
      reviewApi<ReviewContext>("/approvals/v2/context"),
      reviewApi<ReviewTemplate[]>("/admin/approval-types/v2/templates"),
    ]);
    setContext(ctx);
    setList(rows);
    return rows;
  }
  const command = useReviewCommand(async () => {
    const rows = await load();
    if (active) setActive(rows.find((t) => t.id === active.id));
  });
  useEffect(() => {
    load()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [dirty]);
  function edit(next: ReviewDefinition) {
    dispatch({ type: "edit", value: next });
    setValidation("");
    setIssues([]);
    setSimulation("");
  }
  function open(t?: ReviewTemplate) {
    setActive(t);
    dispatch({
      type: "reset",
      value: t?.definition || emptyReviewDefinition(),
    });
    setEditing(true);
    setTab("basic");
    setIssues([]);
    setValidation("");
    setSimulation("");
    setValues({});
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      const saved = await reviewApi<ReviewTemplate>(
        active
          ? `/admin/approval-types/v2/templates/${active.id}`
          : "/admin/approval-types/v2/templates",
        { definition: d, expectedVersion: active?.version },
        active ? "PUT" : "POST",
      );
      setActive(saved);
      await load();
      setValidation("草稿已保存");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function validate() {
    setBusy(true);
    try {
      const result = await reviewApi<{ issues: ReviewIssue[] }>(
        "/admin/approval-types/v2/validate",
        { definition: d },
      );
      setIssues(result.issues);
      setValidation(result.issues.length ? "校验未通过" : "结构校验通过");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const field = (index: number, patch: Partial<ReviewField>) =>
    edit({
      ...d,
      fields: d.fields.map((f, i) => (i === index ? { ...f, ...patch } : f)),
    });
  return (
    <main className="review-page">
      <ReviewOrganization />
      <header className="review-toolbar">
        <h1>评审流程管理</h1>
        <Link to="/admin/approval-types/legacy">旧审批类型</Link>
        {!editing && (
          <button
            className="primary"
            disabled={!context?.admin}
            onClick={() => open()}
          >
            新建流程
          </button>
        )}
      </header>
      {(error || command.error) && (
        <p role="alert" className="review-error">
          {error || command.error}{" "}
          <button
            onClick={() => {
              setLoading(true);
              load()
                .catch((e) => setError(e.message))
                .finally(() => setLoading(false));
            }}
          >
            重新加载
          </button>
        </p>
      )}
      {command.receipt && <p role="status">{command.receipt}</p>}
      {loading ? (
        <p role="status">正在加载当前组织的流程…</p>
      ) : !editing ? (
        <>
          <p>创建可复用的表单和评审流程，发布后员工即可发起。</p>
          {!list.length && <p>当前组织还没有评审流程。</p>}
          <ul className="review-list">
            {list.map((t) => (
              <li key={t.id}>
                <button onClick={() => open(t)}>{t.definition.name}</button>
                <span>
                  草稿 v{t.version} ·{" "}
                  {t.publishedVersion
                    ? `${t.enabled === false ? "已停用 · " : ""}已发布 v${t.publishedVersion}`
                    : "未发布"}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <div className="review-toolbar">
            <button disabled={dirty || busy} onClick={() => setEditing(false)}>
              返回列表
            </button>
            <button
              disabled={!history.past.length || busy}
              onClick={() => {
                dispatch({ type: "undo" });
                setValidation("");
                setSimulation("");
              }}
            >
              撤销
            </button>
            <button
              disabled={!history.future.length || busy}
              onClick={() => {
                dispatch({ type: "redo" });
                setValidation("");
                setSimulation("");
              }}
            >
              重做
            </button>
            <span role="status">
              {dirty ? "有未保存修改" : `已保存 v${active?.version || 1}`}
            </span>
            <button
              className={tab === "publish" ? "" : "primary"}
              disabled={busy || !dirty}
              onClick={save}
            >
              保存草稿
            </button>
            {dirty && (
              <button
                onClick={() => {
                  dispatch({
                    type: "reset",
                    value: active?.definition || emptyReviewDefinition(),
                  });
                  if (!active) setEditing(false);
                }}
              >
                放弃未保存修改
              </button>
            )}
          </div>
          <nav className="review-toolbar" aria-label="流程配置步骤">
            {[
              ["basic", "基本信息"],
              ["form", "表单字段"],
              ["flow", "评审流程"],
              ["publish", "校验与发布"],
            ].map(([id, label]) => (
              <button
                key={id}
                aria-current={tab === id ? "step" : undefined}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>
          <fieldset disabled={busy || command.busy} className="review-editor">
            {tab === "basic" && (
              <div className="review-form">
                <label>
                  流程名称
                  <input
                    maxLength={120}
                    value={d.name}
                    onChange={(e) => edit({ ...d, name: e.target.value })}
                  />
                </label>
                <label>
                  发起说明
                  <textarea
                    maxLength={2000}
                    value={d.description}
                    onChange={(e) =>
                      edit({ ...d, description: e.target.value })
                    }
                  />
                </label>
                <p>
                  可用于内容评审、合作方案、资源申请等。金额只是可选字段，流程不会内置费用规则。
                </p>
              </div>
            )}
            {tab === "form" && (
              <>
                <button
                  onClick={() =>
                    edit({
                      ...d,
                      fields: [
                        ...d.fields,
                        {
                          id: `field_${crypto.randomUUID().slice(0, 8)}`,
                          label: "新字段",
                          type: "text",
                          required: false,
                        },
                      ],
                    })
                  }
                >
                  添加字段
                </button>
                <div className="review-fields">
                  {d.fields.map((f, i) => (
                    <fieldset key={f.id}>
                      <legend>字段 {i + 1}</legend>
                      <label>
                        字段名称
                        <input
                          value={f.label}
                          onChange={(e) => field(i, { label: e.target.value })}
                        />
                      </label>
                      <label>
                        字段类型
                        <select
                          value={f.type}
                          onChange={(e) =>
                            field(i, {
                              type: e.target.value as ReviewField["type"],
                              options: [],
                              numeric: ["decimal", "money"].includes(
                                e.target.value,
                              )
                                ? { precision: 18, scale: 2 }
                                : undefined,
                              currencies:
                                e.target.value === "money" ? [] : undefined,
                              currencySource:
                                e.target.value === "money" ? "" : undefined,
                            })
                          }
                        >
                          {[
                            ["text", "短文本"],
                            ["textarea", "长文本"],
                            ["number", "数值"],
                            ["decimal", "精确十进制"],
                            ["money", "货币金额"],
                            ["date", "日期"],
                            ["select", "单选"],
                            ["multiselect", "多选"],
                            ["attachment", "附件"],
                          ].map(([id, l]) => (
                            <option key={id} value={id}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </label>
                      {["decimal", "money"].includes(f.type) && (
                        <>
                          <label>
                            总精度（位）
                            <input
                              type="number"
                              min={1}
                              max={38}
                              value={f.numeric?.precision ?? ""}
                              onChange={(e) =>
                                field(i, {
                                  numeric: {
                                    ...f.numeric!,
                                    precision: Number(e.target.value),
                                  },
                                })
                              }
                            />
                          </label>
                          <label>
                            小数位
                            <input
                              type="number"
                              min={0}
                              max={18}
                              value={f.numeric?.scale ?? ""}
                              onChange={(e) =>
                                field(i, {
                                  numeric: {
                                    ...f.numeric!,
                                    scale: Number(e.target.value),
                                  },
                                })
                              }
                            />
                          </label>
                          <label>
                            下限（可选）
                            <input
                              type="text"
                              inputMode="decimal"
                              value={f.numeric?.min ?? ""}
                              onChange={(e) =>
                                field(i, {
                                  numeric: {
                                    ...f.numeric!,
                                    min: e.target.value || undefined,
                                  },
                                })
                              }
                            />
                          </label>
                          <label>
                            上限（可选）
                            <input
                              type="text"
                              inputMode="decimal"
                              value={f.numeric?.max ?? ""}
                              onChange={(e) =>
                                field(i, {
                                  numeric: {
                                    ...f.numeric!,
                                    max: e.target.value || undefined,
                                  },
                                })
                              }
                            />
                          </label>
                          <p>
                            精确保存原始数值，不四舍五入。整数位最多为总精度减小数位。
                          </p>
                        </>
                      )}
                      {f.type === "money" && (
                        <>
                          <label>
                            允许币种，每行一个代码
                            <textarea
                              value={f.currencies?.join("\n") || ""}
                              onChange={(e) =>
                                field(i, {
                                  currencies: e.target.value.split("\n"),
                                })
                              }
                            />
                          </label>
                          <label>
                            币种及金额规则来源与版本
                            <input
                              value={f.currencySource || ""}
                              onChange={(e) =>
                                field(i, { currencySource: e.target.value })
                              }
                            />
                          </label>
                          <p>
                            不自动换汇。条件比较须使用同一币种，否则流程阻断并提示处理。
                          </p>
                        </>
                      )}
                      <label className="review-check">
                        <input
                          type="checkbox"
                          checked={f.required}
                          onChange={(e) =>
                            field(i, { required: e.target.checked })
                          }
                        />
                        必填
                      </label>
                      {["select", "multiselect"].includes(f.type) && (
                        <label>
                          选项，每行一个
                          <textarea
                            value={f.options?.join("\n") || ""}
                            onChange={(e) =>
                              field(i, { options: e.target.value.split("\n") })
                            }
                          />
                        </label>
                      )}
                      <button
                        onClick={() =>
                          edit({
                            ...d,
                            fields: d.fields.filter((_, index) => index !== i),
                          })
                        }
                      >
                        删除字段
                      </button>
                    </fieldset>
                  ))}
                </div>
              </>
            )}
            {tab === "flow" && (
              <FlowDesigner
                definition={d}
                onChange={edit}
                people={context?.people || []}
              />
            )}
            {tab === "publish" && (
              <>
                <h2>校验与试运行</h2>
                <p>
                  试运行只检查分支与评审人，不创建申请。员工填写的真实材料会在发起时再次校验。
                </p>
                <button onClick={validate}>校验流程</button>
                <p role="status">{validation}</p>
                {issues.length > 0 && (
                  <ul role="alert">
                    {issues.map((x, i) => (
                      <li key={i}>
                        {x.path}：{x.message}
                      </li>
                    ))}
                  </ul>
                )}
                <label>
                  模拟发起人
                  <select
                    value={requester || context?.actor || ""}
                    onChange={(e) => {
                      setRequester(e.target.value);
                      setSimulation("");
                    }}
                  >
                    {context?.people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <ReviewForm
                  fields={d.fields}
                  values={values}
                  onChange={(v) => {
                    setValues(v);
                    setSimulation("");
                  }}
                />
                <button
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const result = await reviewApi<{
                        status: string;
                        blockedReason?: string;
                        issues: ReviewIssue[];
                        tasks: { userId: string; nodeId: string }[];
                      }>("/admin/approval-types/v2/simulate", {
                        definition: d,
                        values,
                        requester: requester || context?.actor,
                      });
                      setSimulation(
                        result.issues.length
                          ? result.issues.map((i) => i.message).join("；")
                          : result.blockedReason ||
                              `可走通。评审节点：${result.tasks.map((t) => `${d.nodes.find((n) => n.id === t.nodeId)?.name} / ${context?.people.find((p) => p.id === t.userId)?.name || t.userId}`).join(" → ")}`,
                      );
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  用样例试运行
                </button>
                <p role="status">{simulation}</p>
                {active && !dirty && (
                  <PublishChanges id={active.id} version={active.version} />
                )}
                <p>
                  当前可用：基础表单、条件分支、四种评审方式。可配置转交、加签、补充材料重审和超时策略。支持抄送、征询与办理。支持权限校验的附件上传与下载，外部执行尚未开放。
                </p>
                <button
                  className={command.busy ? "" : "primary"}
                  disabled={
                    dirty ||
                    !active ||
                    active.publishedVersion === active.version ||
                    command.busy
                  }
                  onClick={() =>
                    active &&
                    command.run({
                      action: "publish",
                      templateId: active.id,
                      expectedVersion: active.version,
                    })
                  }
                >
                  检查并发布 v{active?.version || 1}
                </button>
                {active?.publishedVersion && (
                  <button
                    disabled={dirty || command.busy}
                    onClick={() =>
                      command.run({
                        action: active.enabled === false ? "enable" : "disable",
                        templateId: active.id,
                        expectedVersion: active.version,
                        expectedLifecycleVersion: active.lifecycleVersion || 0,
                      })
                    }
                  >
                    {active.enabled === false ? "启用流程" : "停用流程"}
                  </button>
                )}
                {dirty && <p>请先保存当前草稿，再发布或调整启停状态。</p>}
              </>
            )}
          </fieldset>
        </>
      )}
      {command.dialog}
    </main>
  );
}
