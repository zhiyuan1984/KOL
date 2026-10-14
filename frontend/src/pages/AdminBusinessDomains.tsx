import { useEffect, useMemo, useState } from "react";
import { Alert, Card, Empty, Select, Spin, Table, Tabs, Tag } from "antd";

/**
 * 管理端 · 本体六构件业务域地图（2026-10-12）。
 * 企业级业务本体 Track A 的产品化：每个业务域按六构件呈现——
 * 对象 / 属性 / 关系 / 事件 / 规则 / 动作（口径：docs/ontop/本体六构件-定义与实例.md）。
 * 全部数据来自 GET /api/admin/business-domains（真实注册表组装），空白如实标注。
 */

type ComponentItem = Record<string, string | number>;
type ComponentBlock = { items: ComponentItem[]; total: number; truncated?: boolean; missing?: string[] };
type DomainView = {
  code: string;
  name: string;
  owner: string;
  owner_title: string;
  pilot: boolean;
  description: string;
  master_data_kinds: string[];
  components: {
    objects: ComponentBlock;
    properties: ComponentBlock;
    relations: ComponentBlock;
    events: ComponentBlock;
    rules: ComponentBlock;
    actions: ComponentBlock;
  };
};
type Relation = { from: string; from_name: string; to: string; to_name: string; label: string; kind: string };
type OntologyMap = { version: number; generated_at: string; domains: DomainView[]; relations: Relation[] };

const COMPONENT_TABS = [
  { key: "objects", label: "对象" },
  { key: "properties", label: "属性" },
  { key: "relations", label: "关系" },
  { key: "events", label: "事件" },
  { key: "rules", label: "规则" },
  { key: "actions", label: "动作" },
] as const;

/** 域在 SVG 中的固定布局（紧凑，v1 固定坐标）。 */
const DOMAIN_POS: Record<string, { x: number; y: number }> = {
  hr: { x: 390, y: 10 },
  brand: { x: 40, y: 170 },
  marketing: { x: 740, y: 170 },
  site: { x: 390, y: 330 },
  supply: { x: 40, y: 490 },
  finance: { x: 740, y: 490 },
};
const CARD_W = 220;
const CARD_H = 76;
const SVG_VIEWBOX = "0 0 1000 600";

function edgePath(from: string, to: string): string {
  const a = DOMAIN_POS[from];
  const b = DOMAIN_POS[to];
  if (!a || !b) return "";
  const ax = a.x + CARD_W / 2;
  const ay = a.y + CARD_H / 2;
  const bx = b.x + CARD_W / 2;
  const by = b.y + CARD_H / 2;
  // 从源卡片边缘指向目标卡片中心方向，缩短到卡片边缘
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const sx = ax + (dx / len) * (CARD_W / 2 + 4);
  const sy = ay + (dy / len) * (CARD_H / 2 + 4);
  const ex = bx - (dx / len) * (CARD_W / 2 + 10);
  const ey = by - (dy / len) * (CARD_H / 2 + 10);
  const mx = (sx + ex) / 2;
  return `M${sx},${sy} Q${mx},${(sy + ey) / 2} ${ex},${ey}`;
}

const RISK_COLOR: Record<string, string> = { R1: "green", R2: "orange", R3: "red" };

export default function AdminBusinessDomains() {
  const [data, setData] = useState<OntologyMap | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string>("brand");
  const [tab, setTab] = useState<string>("objects");

  useEffect(() => {
    fetch("/api/admin/business-domains", { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`加载失败（${r.status}）`);
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  const domain = useMemo(() => data?.domains.find((d) => d.code === selected) ?? null, [data, selected]);

  if (error) return <Alert type="error" message={error} style={{ margin: 16 }} />;
  if (!data) return <Spin style={{ margin: 32 }} />;

  const comp = domain?.components?.[tab as keyof DomainView["components"]] as ComponentBlock | undefined;

  const columns = useMemo(() => {
    if (!comp || comp.items.length === 0) return [];
    const keys = Object.keys(comp.items[0]);
    return keys.map((k) => ({
      title: columnTitle(k),
      dataIndex: k,
      key: k,
      render: (v: unknown, row: ComponentItem) => renderCell(k, v, row),
    }));
  }, [comp, tab]);

  return (
    <div style={{ padding: 16, maxWidth: 1280 }}>
      <h2 style={{ marginBottom: 4 }}>业务域地图</h2>
      <p style={{ color: "#666", marginBottom: 12 }}>
        企业级业务本体 · 每个域按六构件呈现（对象 / 属性 / 关系 / 事件 / 规则 / 动作）。数据来自真实注册表，空白如实标注。
      </p>

      {/* 域选择 */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {data.domains.map((d) => (
          <Card
            key={d.code}
            size="small"
            hoverable
            onClick={() => setSelected(d.code)}
            style={{
              width: 168,
              cursor: "pointer",
              borderColor: selected === d.code ? "#1890ff" : undefined,
              borderWidth: selected === d.code ? 2 : 1,
            }}
            bodyStyle={{ padding: "8px 10px" }}
          >
            <div style={{ fontWeight: 600, fontSize: 13 }}>
              {d.name}
              {d.pilot && <Tag color="orange" style={{ marginLeft: 6, fontSize: 10 }}>试点</Tag>}
            </div>
            <div style={{ fontSize: 11, color: "#888" }}>{d.owner}{d.owner_title ? ` · ${d.owner_title}` : ""}</div>
          </Card>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {/* 域间关系图（全宽） */}
        <Card title="域间关系" size="small" bodyStyle={{ padding: 8 }}>
          <svg viewBox={SVG_VIEWBOX} style={{ width: "100%", height: "auto", maxHeight: 480 }}>
            <defs>
              <marker id="omap-arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
                <path d="M0,0 L9,4.5 L0,9 z" fill="#1890ff" />
              </marker>
              <marker id="omap-arrow-gray" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
                <path d="M0,0 L9,4.5 L0,9 z" fill="#999" />
              </marker>
            </defs>
            {data.relations
              .filter((r) => r.kind !== "none")
              .map((r, i) => (
                <g key={i}>
                  <path
                    d={edgePath(r.from, r.to)}
                    fill="none"
                    stroke={r.kind === "master_data" ? "#999" : "#1890ff"}
                    strokeWidth={1.5}
                    strokeDasharray={r.kind === "master_data" ? "6 4" : undefined}
                    markerEnd={r.kind === "master_data" ? "url(#omap-arrow-gray)" : "url(#omap-arrow)"}
                    opacity={r.from === selected || r.to === selected ? 1 : 0.35}
                  />
                </g>
              ))}
            {data.domains.map((d) => {
              const p = DOMAIN_POS[d.code];
              if (!p) return null;
              const active = d.code === selected;
              return (
                <g key={d.code} onClick={() => setSelected(d.code)} style={{ cursor: "pointer" }}>
                  <rect
                    x={p.x}
                    y={p.y}
                    width={CARD_W}
                    height={CARD_H}
                    rx={8}
                    fill={active ? "#e6f4ff" : "#fff"}
                    stroke={active ? "#1890ff" : d.pilot ? "#faad14" : "#d9d9d9"}
                    strokeWidth={active ? 2.5 : 1.5}
                  />
                  <text x={p.x + 12} y={p.y + 26} fontSize={14} fontWeight={700} fill="#1a1a1a">{d.name}</text>
                  <text x={p.x + 12} y={p.y + 46} fontSize={11.5} fill="#555">{d.owner}</text>
                  <text x={p.x + 12} y={p.y + 64} fontSize={10.5} fill="#999">
                    {[
                      d.components.objects.total > 0 ? `${d.components.objects.total}对象` : "",
                      d.components.events.total > 0 ? `${d.components.events.total}事件` : "",
                      d.master_data_kinds.length > 0 ? `${d.master_data_kinds.length}主数据` : "",
                    ].filter(Boolean).join(" · ") || "待建设"}
                  </text>
                </g>
              );
            })}
          </svg>
          <div style={{ fontSize: 11, color: "#888", padding: "4px 8px" }}>
            <span style={{ color: "#1890ff" }}>—</span> 业务关系
            <span style={{ color: "#999", marginLeft: 12 }}>┄</span> 主数据供给
            <span style={{ marginLeft: 12 }}>点击域卡片切换下方六构件视图</span>
          </div>
        </Card>

        {/* 六构件（全宽） */}
        <Card
          title={`${domain?.name ?? ""} · 六构件`}
          size="small"
          bodyStyle={{ padding: 8 }}
          extra={
            <Select
              size="small"
              value={tab}
              onChange={setTab}
              options={COMPONENT_TABS.map((t) => ({ value: t.key, label: t.label }))}
              style={{ width: 100 }}
            />
          }
        >
          {domain && (
            <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
              域主：{domain.owner}{domain.owner_title ? `（${domain.owner_title}）` : ""} · {domain.description}
              {domain.master_data_kinds.length > 0 && (
                <span style={{ marginLeft: 8 }}>
                  主数据：{domain.master_data_kinds.map((k) => <Tag key={k} style={{ fontSize: 11 }}>{k}</Tag>)}
                </span>
              )}
            </div>
          )}
          <Tabs
            activeKey={tab}
            onChange={setTab}
            size="small"
            items={COMPONENT_TABS.map((t) => {
              const block = domain?.components?.[t.key as keyof DomainView["components"]] as ComponentBlock | undefined;
              return {
                key: t.key,
                label: `${t.label}（${block?.total ?? 0}）`,
                children: renderComponentTab(t.key, block),
              };
            })}
          />
        </Card>
      </div>
    </div>
  );

  function renderComponentTab(key: string, block: ComponentBlock | undefined) {
    if (!block || block.total === 0) {
      return <Empty description={`${COMPONENT_TABS.find((t) => t.key === key)?.label ?? ""}暂无数据（空白如实标注，待建设）`} />;
    }
    return (
      <>
        {block.missing && block.missing.length > 0 && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 8 }}
            message={`注册表中缺失：${block.missing.join("、")}（待补）`}
          />
        )}
        <Table
          size="small"
          rowKey={(_: ComponentItem, idx?: number) => `${key}-${idx}`}
          columns={columns}
          dataSource={block.items}
          pagination={{ pageSize: 12 }}
        />
        {block.truncated && <div style={{ fontSize: 11, color: "#999" }}>仅显示前 100 条。</div>}
      </>
    );
  }
}

function columnTitle(key: string): string {
  const map: Record<string, string> = {
    code: "编码", name: "名称", name_en: "英文名", group: "分组", implementation_status: "实现状态",
    property_count: "属性数", object_code: "对象", object_name: "对象名", kind: "种类", biz_type: "业务类型",
    from_name: "起点", to_name: "终点", label: "关系", direction: "方向",
    category: "分类", object_type: "对象类型", status: "状态",
    type: "类型", detail: "说明", action: "动作", risk: "风险", note: "说明",
  };
  return map[key] ?? key;
}

function renderCell(key: string, value: unknown, _row: ComponentItem) {
  if (key === "risk" && typeof value === "string") {
    return <Tag color={RISK_COLOR[value] ?? "default"}>{value}</Tag>;
  }
  if (key === "implementation_status" && typeof value === "string") {
    const color = value === "built" ? "green" : value === "partial" ? "orange" : "default";
    const label = value === "built" ? "已建" : value === "partial" ? "部分" : value === "not_built" ? "未建" : value;
    return <Tag color={color}>{label}</Tag>;
  }
  if (key === "direction" && typeof value === "string") {
    return value === "out" ? "→ 流出" : "→ 流入";
  }
  if (key === "type" && typeof value === "string") {
    const label = value === "stage" ? "阶段" : value === "constraint" ? "约束" : value === "derived" ? "派生" : value;
    return <Tag>{label}</Tag>;
  }
  return String(value ?? "");
}
