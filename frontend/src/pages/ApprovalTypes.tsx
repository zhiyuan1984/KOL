/**
 * Phase 2 审批类型管理（方案 §7.2 四件套：基本信息 / 表单设计 / 流程设计 / 版本发布）。
 */
import { useEffect, useState } from "react";
import { api } from "../api";

type FormField = {
  id: string;
  label: string;
  field_type: string;
  required: boolean;
  options?: string[];
  required_when?: string;
};

type FlowNode = Record<string, unknown> & { id: string; type: string };

type ApprovalType = {
  id: string;
  code: string;
  name: string;
  group: string;
  owner: string;
  visibility: string;
  form_schema: FormField[];
  flow: { start: string; nodes: Record<string, FlowNode> };
  version: number;
  status: "draft" | "published";
};

type TestResult = {
  ok: boolean;
  path: string[];
  steps: Array<{ node_id: string; name: string; role: string; mode?: string }>;
  cc: Array<{ node_id: string; name: string }>;
  error?: string;
};

const NODE_TYPES = [
  { id: "approval", label: "审批节点" },
  { id: "condition", label: "条件分支" },
  { id: "cc", label: "抄送节点" },
  { id: "handler", label: "办理人节点" },
  { id: "end", label: "结束" },
];

const APPROVER_KINDS = [
  { id: "manager_chain", label: "上级链" },
  { id: "role", label: "指定审批角色" },
  { id: "named", label: "指定人" },
  { id: "node_approver", label: "节点审批人" },
  { id: "self_selected", label: "申请人自选" },
  { id: "ceo", label: "CEO" },
];

export default function ApprovalTypes() {
  const [list, setList] = useState<ApprovalType[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [editing, setEditing] = useState<ApprovalType | null>(null);
  const [err, setErr] = useState("");
  const [testInput, setTestInput] = useState({ amount: "10000", currency: "CNY", requester_name: "黎玉燕", brand: "", region: "" });
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const data = await api.get("/api/admin/approval-types");
      setList(data as ApprovalType[]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "加载失败");
    }
  };

  useEffect(() => { void load(); }, []);

  const startNew = () => {
    setEditing({
      id: "", code: "", name: "", group: "", owner: "", visibility: "all",
      form_schema: [], flow: { start: "", nodes: {} }, version: 1, status: "draft",
    });
    setSelectedId("");
    setTestResult(null);
  };

  const select = async (id: string) => {
    setSelectedId(id);
    try {
      const data = await api.get(`/api/admin/approval-types/${id}`);
      setEditing(data as ApprovalType);
      setTestResult(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "加载失败");
    }
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setErr("");
    try {
      const body = {
        code: editing.code, name: editing.name, group: editing.group,
        owner: editing.owner, visibility: editing.visibility,
        form_schema: editing.form_schema, flow: editing.flow,
      };
      const saved = editing.id
        ? await api.put(`/api/admin/approval-types/${editing.id}`, body)
        : await api.post("/api/admin/approval-types", body);
      setEditing(saved as ApprovalType);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    if (!editing?.id) { setErr("请先保存"); return; }
    setBusy(true);
    try {
      const result = await api.post(`/api/admin/approval-types/${editing.id}/test`, {
        amount: Number(testInput.amount) || 0,
        currency: testInput.currency,
        requester_name: testInput.requester_name,
        ...(testInput.brand ? { brand: testInput.brand } : {}),
        ...(testInput.region ? { region: testInput.region } : {}),
      });
      setTestResult(result as TestResult);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "试运行失败");
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    if (!editing?.id) return;
    if (!testResult?.ok) { setErr("发布前必须先试运行通过"); return; }
    if (!window.confirm(`发布 ${editing.name} v${editing.version + (editing.status === "published" ? 1 : 0)}？运行中的实例将按旧版本走完。`)) return;
    setBusy(true);
    try {
      const result = await api.post(`/api/admin/approval-types/${editing.id}/publish`, {
        test: {
          amount: Number(testInput.amount) || 0,
          currency: testInput.currency,
          requester_name: testInput.requester_name,
        },
      });
      setEditing(result as ApprovalType);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "发布失败");
    } finally {
      setBusy(false);
    }
  };

  const addNode = (type: string) => {
    if (!editing) return;
    const id = `n_${Date.now().toString(36)}`;
    const base: FlowNode = { id, type, title: "" };
    if (type === "approval") {
      Object.assign(base, {
        approver: { kind: "manager_chain", levels: 1 }, mode: "single",
        fallback: { action: "transfer_to", employee_id: "emp_wang" }, next: "",
      });
    } else if (type === "condition") {
      Object.assign(base, { branches: [{ id: "b1", label: "", when: "", next: "" }], default_next: "" });
    } else if (type === "cc") {
      Object.assign(base, { approvers: [], next: "" });
    } else if (type === "handler") {
      Object.assign(base, { approver: { kind: "manager_chain", levels: 1 }, next: "" });
    }
    const nodes = { ...editing.flow.nodes, [id]: base };
    const start = editing.flow.start || id;
    setEditing({ ...editing, flow: { ...editing.flow, start, nodes } });
  };

  const updateNode = (id: string, patch: Partial<FlowNode>) => {
    if (!editing) return;
    const nodes = { ...editing.flow.nodes, [id]: { ...editing.flow.nodes[id], ...patch } };
    setEditing({ ...editing, flow: { ...editing.flow, nodes } });
  };

  const removeNode = (id: string) => {
    if (!editing) return;
    const nodes = { ...editing.flow.nodes };
    delete nodes[id];
    const start = editing.flow.start === id ? Object.keys(nodes)[0] || "" : editing.flow.start;
    setEditing({ ...editing, flow: { ...editing.flow, start, nodes } });
  };

  const addField = () => {
    if (!editing) return;
    const id = `f_${Date.now().toString(36)}`;
    setEditing({
      ...editing,
      form_schema: [...editing.form_schema, { id, label: "", field_type: "text", required: false }],
    });
  };

  return (
    <div className="page approval-types-page">
      <h1>审批类型管理</h1>
      {err && <p className="error">{err}</p>}
      <div className="two-col">
        <section className="panel">
          <h2>类型列表</h2>
          <button type="button" className="btn primary" onClick={startNew}>新建类型</button>
          <ul className="type-list">
            {list.map((t) => (
              <li key={t.id} className={selectedId === t.id ? "selected" : ""}>
                <button type="button" onClick={() => void select(t.id)}>
                  <strong>{t.name}</strong> <span className="muted">{t.code}</span>
                  <span className={`chip ${t.status}`}>{t.status === "published" ? `已发布 v${t.version}` : "草稿"}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        {editing && (
          <section className="panel">
            <h2>{editing.id ? "编辑" : "新建"}审批类型</h2>

            <h3>一、基本信息</h3>
            <div className="field-row">
              <label className="field">名称<input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label>
              <label className="field">编码<input value={editing.code} disabled={!!editing.id} onChange={(e) => setEditing({ ...editing, code: e.target.value })} placeholder="如 FIN-EXP" /></label>
            </div>
            <div className="field-row">
              <label className="field">分组<input value={editing.group} onChange={(e) => setEditing({ ...editing, group: e.target.value })} /></label>
              <label className="field">流程负责人<input value={editing.owner} onChange={(e) => setEditing({ ...editing, owner: e.target.value })} placeholder="谁有权改这个流程" /></label>
              <label className="field">可见范围
                <select value={editing.visibility} onChange={(e) => setEditing({ ...editing, visibility: e.target.value })}>
                  <option value="all">全部</option>
                  <option value="dept">按部门</option>
                </select>
              </label>
            </div>

            <h3>二、表单字段</h3>
            <button type="button" className="btn" onClick={addField}>添加字段</button>
            {editing.form_schema.map((f, i) => (
              <div key={f.id} className="field-row">
                <label className="field">字段名<input value={f.label} onChange={(e) => {
                  const fs = [...editing.form_schema]; fs[i] = { ...f, label: e.target.value };
                  setEditing({ ...editing, form_schema: fs });
                }} /></label>
                <label className="field">类型
                  <select value={f.field_type} onChange={(e) => {
                    const fs = [...editing.form_schema]; fs[i] = { ...f, field_type: e.target.value };
                    setEditing({ ...editing, form_schema: fs });
                  }}>
                    <option value="text">文本</option>
                    <option value="number">数字</option>
                    <option value="select">下拉</option>
                    <option value="date">日期</option>
                    <option value="file">附件</option>
                    <option value="textarea">长文本</option>
                  </select>
                </label>
                <label className="check"><input type="checkbox" checked={f.required} onChange={(e) => {
                  const fs = [...editing.form_schema]; fs[i] = { ...f, required: e.target.checked };
                  setEditing({ ...editing, form_schema: fs });
                }} />必填</label>
                <label className="field">条件必填<input value={f.required_when || ""} placeholder="如 amount_cny > 5000" onChange={(e) => {
                  const fs = [...editing.form_schema]; fs[i] = { ...f, required_when: e.target.value };
                  setEditing({ ...editing, form_schema: fs });
                }} /></label>
                <button type="button" className="btn danger" onClick={() => {
                  setEditing({ ...editing, form_schema: editing.form_schema.filter((x) => x.id !== f.id) });
                }}>删</button>
              </div>
            ))}

            <h3>三、流程设计</h3>
            <p className="muted">结构化编排：审批节点 / 条件分支 / 抄送 / 办理人 / 结束。结束节点锁定 CEO 终审。</p>
            <div className="field-row">
              <label className="field">起始节点
                <select value={editing.flow.start} onChange={(e) => setEditing({ ...editing, flow: { ...editing.flow, start: e.target.value } })}>
                  <option value="">选择</option>
                  {Object.values(editing.flow.nodes).map((n) => <option key={n.id} value={n.id}>{n.id}（{n.type}）</option>)}
                </select>
              </label>
              <div className="field">添加节点
                <div className="chip-row">
                  {NODE_TYPES.map((t) => <button key={t.id} type="button" className="btn" onClick={() => addNode(t.id)}>{t.label}</button>)}
                </div>
              </div>
            </div>
            {Object.values(editing.flow.nodes).map((n) => (
              <NodeEditor key={n.id} node={n} onChange={(p) => updateNode(n.id, p)} onRemove={() => removeNode(n.id)} allNodes={Object.values(editing.flow.nodes)} />
            ))}

            <h3>四、试运行与发布</h3>
            <div className="field-row">
              <label className="field">金额<input value={testInput.amount} onChange={(e) => setTestInput({ ...testInput, amount: e.target.value })} /></label>
              <label className="field">币种<input value={testInput.currency} onChange={(e) => setTestInput({ ...testInput, currency: e.target.value })} /></label>
              <label className="field">申请人<input value={testInput.requester_name} onChange={(e) => setTestInput({ ...testInput, requester_name: e.target.value })} /></label>
              <label className="field">品牌<input value={testInput.brand} onChange={(e) => setTestInput({ ...testInput, brand: e.target.value })} /></label>
              <label className="field">区域<input value={testInput.region} onChange={(e) => setTestInput({ ...testInput, region: e.target.value })} /></label>
            </div>
            <div className="approval-actions">
              <button type="button" className="btn" disabled={busy} onClick={() => void runTest()}>试运行</button>
              <button type="button" className="btn primary" disabled={busy || !testResult?.ok} onClick={() => void publish()}>
                发布新版本{testResult?.ok ? "" : "（需先试运行通过）"}
              </button>
              <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>保存草稿</button>
            </div>
            {testResult && (
              <div className={testResult.ok ? "test-ok" : "test-fail"}>
                {testResult.ok ? (
                  <>
                    <p><strong>命中路径：</strong>{testResult.path.join(" → ")}</p>
                    <p><strong>审批人：</strong>{testResult.steps.map((s) => s.name).join(" → ")}</p>
                    {testResult.cc.length > 0 && <p><strong>抄送：</strong>{testResult.cc.map((c) => c.name).join("、")}</p>}
                  </>
                ) : (
                  <p className="error">试运行失败：{testResult.error}</p>
                )}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function NodeEditor({ node, onChange, onRemove, allNodes }: {
  node: FlowNode;
  onChange: (p: Partial<FlowNode>) => void;
  onRemove: () => void;
  allNodes: FlowNode[];
}) {
  const nodeOptions = allNodes.filter((n) => n.id !== node.id);
  const approver = (node.approver || {}) as Record<string, string | number>;
  const setApprover = (patch: Record<string, string | number>) =>
    onChange({ approver: { ...approver, ...patch } as FlowNode["approver"] });

  return (
    <div className="panel node-editor">
      <div className="node-head">
        <strong>{node.id}</strong>
        <span className="chip">{node.type}</span>
        <button type="button" className="btn danger" onClick={onRemove}>删除</button>
      </div>
      <label className="field">标题<input value={String(node.title || "")} onChange={(e) => onChange({ title: e.target.value })} /></label>

      {node.type === "approval" && (
        <>
          <div className="field-row">
            <label className="field">审批人规则
              <select value={String(approver.kind || "manager_chain")} onChange={(e) => setApprover({ kind: e.target.value })}>
                {APPROVER_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
              </select>
            </label>
            {approver.kind === "manager_chain" && (
              <label className="field">上级级数<input type="number" min={1} max={5} value={Number(approver.levels || 1)} onChange={(e) => setApprover({ levels: Number(e.target.value) })} /></label>
            )}
            {approver.kind === "role" && (
              <label className="field">角色<input value={String(approver.role || "")} placeholder="如 manager" onChange={(e) => setApprover({ role: e.target.value })} /></label>
            )}
            {approver.kind === "named" && (
              <label className="field">员工ID<input value={String(approver.employee_id || "")} placeholder="如 emp_zhang" onChange={(e) => setApprover({ employee_id: e.target.value })} /></label>
            )}
            {approver.kind === "node_approver" && (
              <label className="field">引用节点
                <select value={String(approver.node_id || "")} onChange={(e) => setApprover({ node_id: e.target.value })}>
                  <option value="">选择</option>
                  {nodeOptions.filter((n) => n.type === "approval").map((n) => <option key={n.id} value={n.id}>{n.id}</option>)}
                </select>
              </label>
            )}
            <label className="field">审批方式
              <select value={String(node.mode || "single")} onChange={(e) => onChange({ mode: e.target.value })}>
                <option value="single">单人审批</option>
                <option value="countersign">会签</option>
                <option value="orsign">或签</option>
                <option value="sequential">依次审批</option>
              </select>
            </label>
          </div>
          <label className="field">异常兜底
            <select value={String((node.fallback as Record<string, string> | undefined)?.action || "")} onChange={(e) => onChange({ fallback: e.target.value ? { action: e.target.value, employee_id: "emp_wang" } : undefined } as Partial<FlowNode>)}>
              <option value="">无（解析失败则报错）</option>
              <option value="transfer_to">转交指定人</option>
              <option value="auto_approve">自动通过</option>
            </select>
          </label>
        </>
      )}

      {node.type === "condition" && (
        <div>
          {((node.branches || []) as Array<Record<string, string>>).map((b, i) => (
            <div key={b.id || i} className="field-row">
              <label className="field">分支名<input value={b.label || ""} onChange={(e) => {
                const branches = [...(node.branches as Array<Record<string, string>>)]; branches[i] = { ...b, label: e.target.value };
                onChange({ branches } as Partial<FlowNode>);
              }} /></label>
              <label className="field">条件<input value={b.when || ""} placeholder="如 amount_cny < 5000" onChange={(e) => {
                const branches = [...(node.branches as Array<Record<string, string>>)]; branches[i] = { ...b, when: e.target.value };
                onChange({ branches } as Partial<FlowNode>);
              }} /></label>
              <label className="field">走向
                <select value={b.next || ""} onChange={(e) => {
                  const branches = [...(node.branches as Array<Record<string, string>>)]; branches[i] = { ...b, next: e.target.value };
                  onChange({ branches } as Partial<FlowNode>);
                }}>
                  <option value="">选择</option>
                  {nodeOptions.map((n) => <option key={n.id} value={n.id}>{n.id}</option>)}
                </select>
              </label>
            </div>
          ))}
          <button type="button" className="btn" onClick={() => {
            const branches = [...((node.branches || []) as Array<Record<string, string>>), { id: `b${Date.now().toString(36)}`, label: "", when: "", next: "" }];
            onChange({ branches } as Partial<FlowNode>);
          }}>添加分支</button>
          <label className="field">默认走向
            <select value={String(node.default_next || "")} onChange={(e) => onChange({ default_next: e.target.value })}>
              <option value="">选择</option>
              {nodeOptions.map((n) => <option key={n.id} value={n.id}>{n.id}</option>)}
            </select>
          </label>
        </div>
      )}

      {(node.type === "cc" || node.type === "handler") && (
        <p className="muted">抄送/办理人节点：审批人规则配置（简化版，复用审批节点逻辑）。</p>
      )}

      {node.type !== "end" && node.type !== "condition" && (
        <label className="field">下一步
          <select value={String(node.next || "")} onChange={(e) => onChange({ next: e.target.value })}>
            <option value="">选择</option>
            {nodeOptions.map((n) => <option key={n.id} value={n.id}>{n.id}（{n.type}）</option>)}
          </select>
        </label>
      )}
    </div>
  );
}
