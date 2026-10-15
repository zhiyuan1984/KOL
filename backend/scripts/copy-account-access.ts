/**
 * 账号访问资产复制 CLI。默认只输出 dry-run 计划；只有 --apply 才会进入
 * 原生 PostgreSQL 事务。不得在生产环境以外的审批、邮件或远端授权副作用替代此脚本。
 */
import { copyAccountAccess } from "../src/runtime/account-access.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");

function flag(name: string, fallback: string): string {
  const index = args.indexOf(name);
  const raw = index >= 0 ? String(args[index + 1] || "").trim() : "";
  return raw || fallback;
}

const from = flag("--from", "sriphy");
const to = flag("--to", "usr_org_huang_qiyou");
const report = await copyAccountAccess({ from, to, apply });
console.log(`来源：${report.from.name}（${report.from.id} / ${report.from.username}）`);
console.log(`目标：${report.to.name}（${report.to.id} / ${report.to.username}）`);
console.log(`人员锚点：来源 ${report.from_person || "（未找到）"} → 目标 ${report.to_person || "（未找到）"}`);
for (const action of report.actions) {
  const tag = action.action === "copy" ? "复制" : "跳过";
  const detail = action.detail ? `（${action.detail}）` : "";
  console.log(`  ${tag} ${action.section} ${action.key}${detail}`);
}
const planned = report.actions.filter((action) => action.action === "copy").length;
const skipped = report.actions.filter((action) => action.action === "skip").length;
if (!apply) {
  console.log("");
  console.log(`dry-run：待复制 ${planned} 项、跳过 ${skipped} 项；本次未写库。确认清单后重跑并加 --apply。`);
  process.exit(0);
}
console.log("");
console.log(`已在单个 PostgreSQL 事务内写入并记审计 account_access.copied（本次处理 ${planned} 项，跳过 ${skipped} 项）。`);
