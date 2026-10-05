/**
 * 账号访问资产复制 CLI：把一个账号的邮箱绑定与权限复制给另一个账号（默认 sriphy → usr_org_huang_qiyou）。
 *
 * 用途（2026-10-05，user-confirmed）：登录账户从鄢棽（sriphy）切换为黄启友（usr_org_huang_qiyou），
 * 黄启友获得鄢棽现有的全部邮箱与权限；鄢棽侧保持不动（复制，不迁移）。业务逻辑见
 * `backend/src/runtime/account-access.ts`（同 org-account-import 的结构）。
 *
 *   cd backend && npx tsx scripts/copy-account-access.ts                       # 只报告
 *   cd backend && npx tsx scripts/copy-account-access.ts --apply               # 写库并记审计
 *   cd backend && npx tsx scripts/copy-account-access.ts --from sriphy --to usr_org_huang_qiyou --apply
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

const report = copyAccountAccess({ from, to, apply });

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
console.log(`已写入并记审计 account_access.copied（本次处理 ${planned} 项，跳过 ${skipped} 项）。`);
