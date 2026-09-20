/**
 * Repair 中文翻译 rows that were stored as a raw model JSON envelope (`{"zh":"…"}`).
 *
 * Rows that unwrap into usable Chinese are rewritten as plain text; rows with nothing
 * usable are cleared back to `translation_source='pending'` so the next thread open
 * translates them again. Dry-run by default.
 *
 *   cd backend && npx tsx scripts/repair-mail-translations.ts            # report only
 *   cd backend && npx tsx scripts/repair-mail-translations.ts --apply    # write
 */
import { getConn, nowIso } from "../src/db.js";
import { repairStoredZh } from "../src/starrykol/translate-zh.js";

const apply = process.argv.includes("--apply");

type Row = { id: string; body_text: string | null; translation_zh: string | null };

const rows = getConn()
  .prepare(
    `SELECT id, body_text, translation_zh FROM kol_mail_items
     WHERE IFNULL(translation_zh,'') <> '' AND translation_zh LIKE '{%'`,
  )
  .all() as Row[];

let repaired = 0;
let reset = 0;
const samples: string[] = [];

for (const row of rows) {
  const stored = String(row.translation_zh || "");
  const next = repairStoredZh(stored, String(row.body_text || ""));
  if (next && next !== stored) {
    repaired += 1;
    if (samples.length < 3) samples.push(`  fixed  ${stored.slice(0, 46)} -> ${next.replace(/\s+/g, " ").slice(0, 46)}`);
    if (apply) {
      getConn().prepare("UPDATE kol_mail_items SET translation_zh=?, translation_source=? WHERE id=?")
        .run(next, "repaired_json_envelope", row.id);
    }
    continue;
  }
  if (!next) {
    reset += 1;
    if (samples.length < 3) samples.push(`  reset  ${stored.slice(0, 46)} -> (translate again)`);
    if (apply) {
      getConn().prepare("UPDATE kol_mail_items SET translation_zh=NULL, translation_source='pending' WHERE id=?")
        .run(row.id);
    }
  }
}

console.log(`${apply ? "applied" : "dry-run"}: candidates=${rows.length} rewritten=${repaired} reset_to_pending=${reset} ${nowIso()}`);
for (const line of samples) console.log(line);
if (!apply && (repaired || reset)) console.log("re-run with --apply to write these changes");
