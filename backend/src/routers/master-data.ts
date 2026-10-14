import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { requireAdmin } from "../auth.js";
import { HttpFail } from "../host/errors.js";
import { nid } from "../ids.js";
import { postgresPool } from "../postgres/pool.js";

/**
 * 主数据 Excel 导入链路（C1 Phase 1，2026-10-12）。
 * 企业级业务本体 Track C：主数据权威源 = Excel（qiyou 2026-10-12 决策）。
 * 链路：下载模板 → 上传 → 解析 → 校验 → 预览 → 确认导入 → 写入 PG master_data_records。
 * 为避免新增 xlsx 解析依赖，v1 用 CSV（Excel 可直接另存/打开）；.xlsx 直传后续版本支持。
 * 导入是 R3 动作：preview 与 commit 分开，commit 需二次确认并返回回执。
 */

export const masterDataRouter = new Hono();

type MasterDataField = {
  key: string;
  label: string;
  required: boolean;
  example: string;
};

type MasterDataKind = {
  kind: string;
  label: string;
  domain: string;
  owner: string;
  codeKey: string;
  fields: MasterDataField[];
};

const MASTER_DATA_KINDS: MasterDataKind[] = [
  {
    kind: "brand",
    label: "品牌",
    domain: "品牌域",
    owner: "张慧玲",
    codeKey: "brand_code",
    fields: [
      { key: "brand_code", label: "品牌编码", required: true, example: "LT" },
      { key: "name", label: "品牌名", required: true, example: "LiTime" },
      { key: "positioning", label: "品牌定位", required: false, example: "磷酸铁锂电池 DTC 出海" },
      { key: "regions", label: "适用区域", required: false, example: "北美/欧洲" },
      { key: "status", label: "状态", required: false, example: "在用" },
    ],
  },
  {
    kind: "person",
    label: "人员",
    domain: "HR 域",
    owner: "赵海龙",
    codeKey: "employee_id",
    fields: [
      { key: "employee_id", label: "工号", required: true, example: "A0001" },
      { key: "name", label: "姓名", required: true, example: "张三" },
      { key: "dept", label: "部门", required: true, example: "独立站营销中心" },
      { key: "title", label: "职位", required: false, example: "运营经理" },
      { key: "email", label: "邮箱", required: false, example: "zhangsan@amperetime.com" },
      { key: "status", label: "状态", required: false, example: "在职" },
    ],
  },
  {
    kind: "org_unit",
    label: "组织单元",
    domain: "HR 域",
    owner: "赵海龙",
    codeKey: "org_code",
    fields: [
      { key: "org_code", label: "部门编码", required: true, example: "ORG-LT-MKT" },
      { key: "name", label: "部门名", required: true, example: "独立站营销中心" },
      { key: "parent_code", label: "上级编码", required: false, example: "ORG-ROOT" },
      { key: "brand_attr", label: "品牌属性", required: false, example: "LT" },
      { key: "region_attr", label: "区域属性", required: false, example: "日加澳" },
      { key: "leader", label: "负责人", required: false, example: "张三" },
    ],
  },
  {
    kind: "site",
    label: "站点",
    domain: "独立站域",
    owner: "邢海龚",
    codeKey: "site_code",
    fields: [
      { key: "site_code", label: "站点编码", required: true, example: "LT-US" },
      { key: "name", label: "站点名", required: true, example: "LiTime 美国站" },
      { key: "brand_code", label: "归属品牌编码", required: true, example: "LT" },
      { key: "region", label: "区域", required: false, example: "北美" },
      { key: "url", label: "URL", required: false, example: "https://www.litime.com" },
      { key: "status", label: "状态", required: false, example: "在营" },
    ],
  },
  {
    kind: "account",
    label: "会计科目",
    domain: "财务域",
    owner: "彭学知",
    codeKey: "subject_code",
    fields: [
      { key: "subject_code", label: "科目编码", required: true, example: "6001" },
      { key: "name", label: "科目名", required: true, example: "主营业务收入" },
      { key: "type", label: "科目类型", required: false, example: "损益" },
      { key: "status", label: "状态", required: false, example: "启用" },
    ],
  },
  {
    kind: "cost_center",
    label: "成本中心",
    domain: "财务域",
    owner: "彭学知",
    codeKey: "cc_code",
    fields: [
      { key: "cc_code", label: "成本中心编码", required: true, example: "CC-001" },
      { key: "name", label: "成本中心名", required: true, example: "独立站营销中心" },
      { key: "org_code", label: "归属部门编码", required: false, example: "ORG-LT-MKT" },
    ],
  },
  {
    kind: "sku",
    label: "SKU",
    domain: "供应链域",
    owner: "晏琼瑶",
    codeKey: "sku_code",
    fields: [
      { key: "sku_code", label: "SKU 编码", required: true, example: "LT-12V100AH" },
      { key: "name", label: "品名", required: true, example: "12V 100Ah 磷酸铁锂电池" },
      { key: "brand_code", label: "归属品牌编码", required: true, example: "LT" },
      { key: "spec", label: "规格", required: false, example: "12V 100Ah" },
      { key: "barcode", label: "条码", required: false, example: "6971234567890" },
      { key: "status", label: "状态", required: false, example: "在售" },
    ],
  },
  {
    kind: "warehouse",
    label: "仓库",
    domain: "供应链域",
    owner: "晏琼瑶",
    codeKey: "warehouse_code",
    fields: [
      { key: "warehouse_code", label: "仓库编码", required: true, example: "WH-US-CA" },
      { key: "name", label: "仓库名", required: true, example: "美国加州仓" },
      { key: "type", label: "仓库类型", required: false, example: "海外仓" },
      { key: "region", label: "区域", required: false, example: "北美" },
      { key: "status", label: "状态", required: false, example: "启用" },
    ],
  },
];

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 5000;

function findKind(kind: string): MasterDataKind {
  const def = MASTER_DATA_KINDS.find((k) => k.kind === kind);
  if (!def) throw new HttpFail(404, { code: "master_data_kind_unknown", kind });
  return def;
}

/** 最小 CSV 解析器：处理引号包裹、逗号、换行；返回行数组（每行是 string[]）。 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;
  // BOM 去掉
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        cell += ch;
        i++;
      }
    } else if (ch === '"') {
      inQuotes = true;
      i++;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
      i++;
    } else if (ch === "\r") {
      i++;
    } else if (ch === "\n") {
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
      i++;
    } else {
      cell += ch;
      i++;
    }
  }
  row.push(cell);
  // 末尾空行丢弃
  if (!(row.length === 1 && row[0] === "")) rows.push(row);
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

type PreviewRow = {
  line: number;
  code: string;
  name: string;
  valid: boolean;
  errors: string[];
  data: Record<string, string>;
};

function validateRows(def: MasterDataKind, rows: string[][]): { header: string[]; preview: PreviewRow[]; errors: string[] } {
  const errors: string[] = [];
  if (rows.length === 0) return { header: [], preview: [], errors: ["文件为空"] };
  const header = rows[0].map((h) => h.trim());
  const missingRequired = def.fields.filter((f) => f.required && !header.includes(f.key));
  if (missingRequired.length > 0) {
    return { header, preview: [], errors: [`缺少必填列：${missingRequired.map((f) => f.label).join("、")}`] };
  }
  const codeIdx = header.indexOf(def.codeKey);
  const nameIdx = header.indexOf("name");
  const preview: PreviewRow[] = [];
  const seenCodes = new Set<string>();
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const data: Record<string, string> = {};
    header.forEach((h, idx) => {
      data[h] = (cells[idx] ?? "").trim();
    });
    const rowErrors: string[] = [];
    const code = data[def.codeKey] ?? "";
    const name = data["name"] ?? "";
    if (!code) rowErrors.push(`${def.fields.find((f) => f.key === def.codeKey)?.label ?? def.codeKey}不能为空`);
    if (!name) rowErrors.push("名称不能为空");
    if (code && seenCodes.has(code)) rowErrors.push(`编码重复：${code}`);
    if (code) seenCodes.add(code);
    for (const f of def.fields) {
      if (f.required && !data[f.key]) rowErrors.push(`${f.label}不能为空`);
    }
    preview.push({ line: r + 1, code, name, valid: rowErrors.length === 0, errors: rowErrors, data });
  }
  return { header, preview, errors };
}

masterDataRouter.get("/admin/master-data/kinds", (c) => {
  requireAdmin();
  return c.json({
    kinds: MASTER_DATA_KINDS.map((k) => ({
      kind: k.kind,
      label: k.label,
      domain: k.domain,
      owner: k.owner,
      code_key: k.codeKey,
      fields: k.fields,
    })),
  });
});

masterDataRouter.get("/admin/master-data/template/:kind", (c) => {
  requireAdmin();
  const def = findKind(c.req.param("kind"));
  const header = def.fields.map((f) => f.key).join(",");
  const example = def.fields.map((f) => `"${f.example}"`).join(",");
  const csv = `${header}\n${example}\n`;
  const filename = `master-data-${def.kind}-template.csv`;
  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="${filename}"`);
  return c.body(`\uFEFF${csv}`);
});

masterDataRouter.post(
  "/admin/master-data/preview",
  bodyLimit({ maxSize: MAX_FILE_BYTES, onError: (c) => c.json({ error: "文件过大（上限 5MB）" }, 413) }),
  async (c) => {
    requireAdmin();
    const form = await c.req.formData();
    const kind = String(form.get("kind") ?? "");
    const file = form.get("file");
    if (!kind) throw new HttpFail(422, { code: "master_data_kind_required" });
    const def = findKind(kind);
    if (!(file instanceof File)) throw new HttpFail(422, { code: "master_data_file_required" });
    const text = await file.text();
    const rows = parseCsv(text);
    if (rows.length - 1 > MAX_ROWS) {
      throw new HttpFail(422, { code: "master_data_too_many_rows", max: MAX_ROWS });
    }
    const { header, preview, errors } = validateRows(def, rows);
    const validCount = preview.filter((p) => p.valid).length;
    return c.json({
      kind: def.kind,
      label: def.label,
      header,
      total: preview.length,
      valid: validCount,
      invalid: preview.length - validCount,
      errors,
      rows: preview.slice(0, 200),
      truncated: preview.length > 200,
    });
  },
);

masterDataRouter.post("/admin/master-data/commit", async (c) => {
  const admin = requireAdmin();
  const body = await c.req.json().catch(() => ({}));
  const kind = String(body.kind ?? "");
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!kind) throw new HttpFail(422, { code: "master_data_kind_required" });
  const def = findKind(kind);
  if (rows.length === 0) throw new HttpFail(422, { code: "master_data_rows_required" });
  if (rows.length > MAX_ROWS) throw new HttpFail(422, { code: "master_data_too_many_rows", max: MAX_ROWS });

  // 服务端二次校验：只写 valid 行
  const pool = postgresPool();
  const batchId = nid("mdb");
  let inserted = 0;
  let updated = 0;
  const skipped: Array<{ line: number; reason: string }> = [];
  const nowIso = new Date().toISOString();

  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx] as { data?: Record<string, string>; valid?: boolean; line?: number };
    if (!row?.data || row.valid === false) {
      skipped.push({ line: row?.line ?? idx + 2, reason: "校验未通过" });
      continue;
    }
    const data = row.data;
    const code = String(data[def.codeKey] ?? "").trim();
    const name = String(data["name"] ?? "").trim();
    if (!code || !name) {
      skipped.push({ line: row?.line ?? idx + 2, reason: "编码或名称为空" });
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const f of def.fields) {
      if (f.key === def.codeKey || f.key === "name") continue;
      const v = String(data[f.key] ?? "").trim();
      if (v) attrs[f.key] = v;
    }
    const result = await pool.query(
      `INSERT INTO master_data_records (id, kind, code, name, attrs, source, batch_id, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'excel_import', $6, $7, $8, $8)
       ON CONFLICT (kind, code) DO UPDATE SET
         name = EXCLUDED.name,
         attrs = EXCLUDED.attrs,
         batch_id = EXCLUDED.batch_id,
         updated_at = EXCLUDED.updated_at
       RETURNING (xmax = 0) AS was_inserted`,
      [nid("mdr"), def.kind, code, name, JSON.stringify(attrs), batchId, admin.id ?? admin.email ?? "admin", nowIso],
    );
    if (result.rows[0]?.was_inserted) inserted++;
    else updated++;
  }

  // 写业务事件（PG business_events）
  const eventId = nid("evt");
  await pool.query(
    `INSERT INTO business_events
       (id, event_type, object_type, object_id, occurred_at, received_at, source, actor_type, actor_id, payload, idempotency_key, created_at)
     VALUES ($1, 'masterdata.imported', 'master_data_batch', $2, $3, $3, 'master-data-import', 'human', $4, $5, $6, $3)
     ON CONFLICT DO NOTHING`,
    [
      eventId,
      batchId,
      nowIso,
      admin.id ?? admin.email ?? "admin",
      JSON.stringify({ kind: def.kind, label: def.label, inserted, updated, skipped: skipped.length }),
      `mdimport:${batchId}`,
    ],
  );

  return c.json({
    ok: true,
    batch_id: batchId,
    kind: def.kind,
    inserted,
    updated,
    skipped,
    event_id: eventId,
  });
});

masterDataRouter.get("/admin/master-data/records", async (c) => {
  requireAdmin();
  const kind = c.req.query("kind") ?? "";
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") ?? "100", 10) || 100, 1), 500);
  const pool = postgresPool();
  const params: unknown[] = [];
  let where = "";
  if (kind) {
    findKind(kind);
    where = "WHERE kind = $1";
    params.push(kind);
  }
  params.push(limit);
  const { rows } = await pool.query(
    `SELECT kind, code, name, attrs, status, source, batch_id, created_by, created_at, updated_at
     FROM master_data_records ${where}
     ORDER BY updated_at DESC LIMIT $${params.length}`,
    params,
  );
  return c.json({ records: rows });
});
