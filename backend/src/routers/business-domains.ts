import { Hono } from "hono";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireAdmin } from "../auth.js";

/**
 * 本体六构件业务域地图（2026-10-12）。
 * 企业级业务本体 Track A 的产品化：每个业务域按六构件呈现——
 * 对象 / 属性 / 关系 / 事件 / 规则 / 动作（口径见 docs/ontop/本体六构件-定义与实例.md）。
 * 全部数据来自真实注册表，空白如实标注（CONST-10：不用文档冒充能力）。
 *
 * 数据源：
 * - 域定义：config/domain-registry.yaml（域主/试点/主数据/对象映射/域间关系）
 * - 对象/属性：config/objects-registry.yaml
 * - 事件：config/event-catalog.yaml（按 object_type 归属到域）
 * - 规则：config/stage-transitions.json（阶段转移规则）+ 域级规则说明
 * - 动作：按对象派生的标准动作（R1/R2/R3 分级）
 */

export const businessDomainsRouter = new Hono();

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

type YamlJson = { version?: number; domains?: DomainDef[]; relations?: DomainRelation[]; objects?: RegistryObject[]; events?: CatalogEvent[] };
type DomainDef = {
  code: string; name: string; owner: string; owner_title: string; pilot: boolean;
  master_data_kinds: string[]; object_codes: string[]; description: string;
};
type DomainRelation = { from: string; to: string; label: string; kind: string };
type RegistryObject = { code: string; name: string; name_en?: string; group: string; layer: string; implementation_status: string; properties?: RegistryProp[]; source_ref?: string };
type RegistryProp = { name: string; kind: string; biz_type: string };
type CatalogEvent = { code: string; name: string; category: string; object_type: string; status: string };

function readJsonYaml(rel: string): YamlJson {
  const raw = fs.readFileSync(path.join(REPO_ROOT, rel), "utf-8");
  return JSON.parse(raw) as YamlJson;
}

let cache: { at: number; data: unknown } | null = null;
const CACHE_TTL_MS = 60_000;

function buildMap() {
  const domains = readJsonYaml("config/domain-registry.yaml");
  const objectsReg = readJsonYaml("config/objects-registry.yaml");
  const eventCatalog = readJsonYaml("config/event-catalog.yaml");

  const objectsByCode = new Map<string, RegistryObject>();
  for (const o of objectsReg.objects ?? []) objectsByCode.set(o.code, o);

  const eventsByObjectType = new Map<string, CatalogEvent[]>();
  for (const e of eventCatalog.events ?? []) {
    const list = eventsByObjectType.get(e.object_type) ?? [];
    list.push(e);
    eventsByObjectType.set(e.object_type, list);
  }

  const domainNameByCode = new Map((domains.domains ?? []).map((d) => [d.code, d.name]));

  const domainViews = (domains.domains ?? []).map((d) => {
    // 1. 对象：注册表对象
    const objects = (d.object_codes ?? [])
      .map((code) => objectsByCode.get(code))
      .filter((o): o is RegistryObject => !!o)
      .map((o) => ({
        code: o.code,
        name: o.name,
        name_en: o.name_en ?? "",
        group: o.group,
        implementation_status: o.implementation_status,
        property_count: (o.properties ?? []).length,
      }));
    const missingObjects = (d.object_codes ?? []).filter((code) => !objectsByCode.has(code));

    // 2. 属性：对象属性展平
    const properties = (d.object_codes ?? []).flatMap((code) => {
      const o = objectsByCode.get(code);
      return (o?.properties ?? []).map((p) => ({
        object_code: code,
        object_name: o?.name ?? code,
        name: p.name,
        kind: p.kind,
        biz_type: p.biz_type,
      }));
    });

    // 3. 关系：域间关系（本域为起点或终点）
    const relations = (domains.relations ?? [])
      .filter((r) => r.from === d.code || r.to === d.code)
      .map((r) => ({
        from: r.from,
        from_name: domainNameByCode.get(r.from) ?? r.from,
        to: r.to,
        to_name: domainNameByCode.get(r.to) ?? r.to,
        label: r.label,
        kind: r.kind,
        direction: r.from === d.code ? "out" : "in",
      }));

    // 4. 事件：object_type 归属本域对象的事件
    const events = (d.object_codes ?? []).flatMap((code) =>
      (eventsByObjectType.get(code) ?? []).map((e) => ({
        code: e.code,
        name: e.name,
        category: e.category,
        object_type: e.object_type,
        status: e.status,
      })),
    );

    // 5. 规则：阶段转移规则（对象级）+ 域级规则说明
    const rules = buildRulesForDomain(d, objectsByCode);

    // 6. 动作：按对象派生的标准动作（R1/R2/R3）
    const actions = buildActionsForDomain(d, objects);

    return {
      code: d.code,
      name: d.name,
      owner: d.owner,
      owner_title: d.owner_title,
      pilot: d.pilot,
      description: d.description,
      master_data_kinds: d.master_data_kinds ?? [],
      components: {
        objects: { items: objects, missing: missingObjects, total: objects.length },
        properties: { items: properties.slice(0, 100), total: properties.length, truncated: properties.length > 100 },
        relations: { items: relations, total: relations.length },
        events: { items: events.slice(0, 100), total: events.length, truncated: events.length > 100 },
        rules: { items: rules, total: rules.length },
        actions: { items: actions, total: actions.length },
      },
    };
  });

  return {
    version: domains.version ?? 1,
    generated_at: new Date().toISOString(),
    domains: domainViews,
    relations: (domains.relations ?? []).map((r) => ({
      from: r.from,
      from_name: domainNameByCode.get(r.from) ?? r.from,
      to: r.to,
      to_name: domainNameByCode.get(r.to) ?? r.to,
      label: r.label,
      kind: r.kind,
    })),
  };
}

/** 规则：阶段转移（营销域线索/合作）+ 各域规则说明。 */
function buildRulesForDomain(d: DomainDef, objectsByCode: Map<string, RegistryObject>): Array<{ type: string; label: string; detail: string }> {
  const rules: Array<{ type: string; label: string; detail: string }> = [];
  if (d.code === "marketing") {
    rules.push(
      { type: "stage", label: "线索 7 态流转", detail: "待建联→建联中→报价谈判→样品待发→意向待定→已转化；已拒绝为异常终态（config/stage-transitions.json，host 强制）" },
      { type: "stage", label: "合作 15+exception 阶段", detail: "15 个正式主阶段 + exception（PAUSED/DISPUTED/LOST/REJECTED/CANCELLED）" },
      { type: "constraint", label: "发送 ≠ 推进阶段", detail: "发送只新增邮件事实，不写正式阶段" },
    );
  }
  if (d.code === "hr") {
    rules.push(
      { type: "constraint", label: "三级部门 + 双属性", detail: "组织单元必须保留三级结构与品牌/区域双属性（如 独立站营销中心/LT/网站运营小组/日加澳组）" },
      { type: "constraint", label: "离职保留归属", detail: "离职人员历史单据归属保留，待域主确认保留期限" },
    );
  }
  if (d.code === "finance") {
    rules.push(
      { type: "constraint", label: "结算交接", detail: "营销域管到结算中，财务域从结算单接手（待域主确认交接单据）" },
    );
  }
  if (d.code === "supply") {
    rules.push(
      { type: "derived", label: "库存 = SKU × 仓库", detail: "库存主数据口径为 SKU 与仓库的组合（待域主确认批次/效期）" },
    );
  }
  if (d.code === "brand") {
    rules.push(
      { type: "constraint", label: "品牌归属", detail: "站点/ SKU / 合作必须挂品牌编码 brand_code（一对多，待域主确认）" },
    );
  }
  if (d.code === "site") {
    rules.push(
      { type: "constraint", label: "站点清单", detail: "LT/RO/PQ；测试站与地区子站待域主确认是否纳入" },
    );
  }
  return rules;
}

/** 动作：按对象派生标准动作，R1/R2/R3 分级（AGENTS.md §4）。 */
function buildActionsForDomain(
  d: DomainDef,
  objects: Array<{ code: string; name: string; implementation_status: string }>,
): Array<{ object_code: string; object_name: string; action: string; risk: "R1" | "R2" | "R3"; note: string }> {
  const actions: Array<{ object_code: string; object_name: string; action: string; risk: "R1" | "R2" | "R3"; note: string }> = [];
  for (const o of objects) {
    if (o.implementation_status === "not_built") continue;
    actions.push(
      { object_code: o.code, object_name: o.name, action: "查看", risk: "R1", note: "只读，直接执行" },
      { object_code: o.code, object_name: o.name, action: "创建", risk: "R3", note: "正式写入，执行前确认" },
      { object_code: o.code, object_name: o.name, action: "更新", risk: "R3", note: "正式写入，执行前确认" },
    );
  }
  // 主数据导入是跨对象的 R3 动作
  if ((d.master_data_kinds ?? []).length > 0) {
    actions.push({
      object_code: "master_data_batch",
      object_name: "主数据导入批次",
      action: "Excel 导入",
      risk: "R3",
      note: "预览与提交分开，提交前 Modal.confirm（C1 链路已上线）",
    });
  }
  if (d.code === "marketing") {
    actions.push(
      { object_code: "creator_candidate", object_name: "达人", action: "阶段推进", risk: "R3", note: "需确认卡（DESIGN §598）" },
      { object_code: "collaboration", object_name: "合作项目", action: "结算", risk: "R3", note: "跨域：营销→财务" },
    );
  }
  return actions;
}

businessDomainsRouter.get("/admin/business-domains", (c) => {
  requireAdmin();
  const now = Date.now();
  if (!cache || now - cache.at > CACHE_TTL_MS) {
    cache = { at: now, data: buildMap() };
  }
  return c.json(cache.data);
});
