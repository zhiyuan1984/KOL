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
{
  const { json } = await api("/api/approvals/preview", {
    method: "POST",
    body: JSON.stringify({ kind: "expense", amount: 3000, currency: "CNY", requester_name: "黎玉燕" }),
  });
  const names = (json.steps || []).map((s) => s.name);
  ok("CEO终审：3000链末端为张总", names[names.length - 1] === "张总", JSON.stringify(names));
}
{
  const { json } = await api("/api/approvals/preview", {
    method: "POST",
    body: JSON.stringify({ kind: "expense", amount: 8000, currency: "CNY", requester_name: "黎玉燕", brand: "LT" }),
  });
  const names = (json.steps || []).map((s) => s.name);
  ok("品牌过滤：LT下无林桐", !names.includes("林桐"), JSON.stringify(names));
  ok("品牌过滤：LT下仍有CEO", names[names.length - 1] === "张总", JSON.stringify(names));
}
let aid, version;
{
  const { json } = await api("/api/approvals", {
    method: "POST",
    body: JSON.stringify({ kind: "expense", amount: 3000, currency: "CNY", requester_name: "黎玉燕", brand: "PQ" }),
  });
  aid = json.id; version = json.version;
  ok("创建审批", !!aid);
}
{
  const { json, status } = await api(`/api/approvals/${aid}/transfer`, {
    method: "POST",
    body: JSON.stringify({ target_employee_id: "emp_wang", expected_version: version }),
  });
  ok("转交成功且名字正确", status === 200 && json.chain_detail?.[0]?.name === "王主管",
    `status=${status} ${JSON.stringify(json.chain_detail || {}).slice(0, 120)}`);
  version = json.version;
}
{
  const { json, status } = await api(`/api/approvals/${aid}/withdraw`, {
    method: "POST",
    body: JSON.stringify({ expected_version: version }),
  });
  ok("撤回成功", status === 200 && json.status === "withdrawn", `status=${status}`);
}
{
  const { json } = await api("/api/admin/users/u1/approval-roles", {
    method: "PUT",
    body: JSON.stringify({ grants: [{ role: "manager", valid_from: "2020-01-01", valid_to: "2020-12-31" }] }),
  });
  ok("角色授权grants格式被接受（走到用户校验）", json.detail === "user not found", JSON.stringify(json));
}
console.log(`\n${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
