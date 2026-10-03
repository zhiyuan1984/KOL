const BASE = "http://127.0.0.1:8765";
let pass = 0, fail = 0;
function ok(name, cond, detail = "") {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name} ${detail}`); }
}
async function api(path, opts = {}) {
  const r = await fetch(BASE + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, json: j };
}

// 1. 创建审批类型
let typeId;
{
  const { json, status } = await api("/api/admin/approval-types", {
    method: "POST",
    body: JSON.stringify({
      code: "TEST-EXP",
      name: "测试费用审批",
      group: "财务",
      owner: "财务负责人",
      form_schema: [
        { id: "f_amount", label: "金额", field_type: "number", required: true },
        { id: "f_purpose", label: "用途", field_type: "text", required: false, required_when: "amount_cny > 5000" },
      ],
      flow: {
        start: "n1",
        nodes: {
          n1: { id: "n1", type: "approval", title: "经理审批", approver: { kind: "manager_chain", levels: 1 }, mode: "single", next: "n_end" },
          n_end: { id: "n_end", type: "end", title: "结束" },
        },
      },
    }),
  });
  typeId = json.id;
  ok("创建审批类型", status === 200 && !!typeId, `status=${status}`);
}
// 2. 试运行
{
  const { json } = await api(`/api/admin/approval-types/${typeId}/test`, {
    method: "POST",
    body: JSON.stringify({ amount: 3000, currency: "CNY", requester_name: "黎玉燕" }),
  });
  ok("试运行通过", json.ok === true, JSON.stringify(json).slice(0, 150));
  ok("试运行路径含CEO", json.steps?.[json.steps.length - 1]?.name === "张总", JSON.stringify(json.steps?.map((s) => s.name)));
}
// 3. 试运行高金额（条件分支）
{
  const { json } = await api(`/api/admin/approval-types/${typeId}/test`, {
    method: "POST",
    body: JSON.stringify({ amount: 8000, currency: "CNY", requester_name: "黎玉燕" }),
  });
  ok("试运行8000", json.ok === true, JSON.stringify(json.steps?.map((s) => s.name)));
}
// 4. 发布
{
  const { json, status } = await api(`/api/admin/approval-types/${typeId}/publish`, {
    method: "POST",
    body: JSON.stringify({ test: { amount: 3000, currency: "CNY", requester_name: "黎玉燕" } }),
  });
  ok("发布成功", status === 200 && json.status === "published", `status=${status} st=${json.status}`);
}
// 5. 加签
let aid, version;
{
  const { json } = await api("/api/approvals", {
    method: "POST",
    body: JSON.stringify({ kind: "expense", amount: 3000, currency: "CNY", requester_name: "黎玉燕" }),
  });
  aid = json.id; version = json.version;
}
{
  const { json, status } = await api(`/api/approvals/${aid}/countersign`, {
    method: "POST",
    body: JSON.stringify({ target_employee_id: "emp_wang", expected_version: version }),
  });
  const names = (json.chain_detail || []).map((s) => s.name);
  ok("加签成功", status === 200 && names.includes("王主管"), `status=${status} ${JSON.stringify(names)}`);
}
console.log(`\n${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
