import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Collapse, Empty, Input, Modal, Spin, Table, Tag, message } from "antd";

/**
 * 管理端 · 本体业务域地图（2026-10-12，Phase 2 域统一视图）。
 * 每个域一页：确认区 + 六构件分组（对象 / 属性 / 关系 / 事件 / 规则 / 动作），
 * 不再按构件切 Tabs——用户一次看完一个域，不用在六个 Tabs 间拼图。
 * 全部数据来自 GET /api/admin/business-domains（真实注册表组装），空白如实标注。
 * 域确认是轻量标记（绑定展示内容 digest），不是审批；变更仍走 ontology_change 审批。
 */

type ComponentItem = Record<string, string | number>;
type ComponentBlock = { items: ComponentItem[]; total: number; truncated?: boolean; missing?: string[] };
type Confirmation = {
  confirmed_by: string;
  confirmed_by_name: string;
  confirmed_at: string;
  map_digest: string;
  note: string;
  current: boolean;
};
type DomainView = {
  code: string;
  name: string;
  owner: string;
  owner_title: string;
  pilot: boolean;
  description: string;
  master_data_kinds: string[];
  confirmation: Confirmation | null;
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
type OntologyMap = {
  version: number;
  generated_at: string;
  domains: DomainView[];
  relations: Relation[];
  confirmation_unavailable?: boolean;
};

const COMPONENT_SECTIONS = [
  { key: "objects", label: "对象" },
  { key: "properties", label: "属性" },
  { key: "relations", label: "关系" },
  { key: "events", label: "事件" },
  { key: "rules", label: "规则" },
  { key: "actions", label: "动作" },
] as const;

/** 域在 SVG 中的固定布局（紧凑，v1 固定坐标；仅展示，不作选择器）。 */
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
  const ey = by - (dy / len) * (CARD_W / 2 + 10);
  const mx = (sx + ex) / 2;
  return `M${sx},${sy} Q${mx},${(sy + ey) / 2} ${ex},${ey}`;
}

const RISK_COLOR: Record<string, string> = { R1: "green", R2: "orange", R3: "red" };

function rowMatches(row: ComponentItem, q: string): boolean {
  if (!q) return true;
  return Object.values(row).some((v) =>
    String(Array.isArray(v) ? v.join("、") : v ?? "").toLowerCase().includes(q),
  );
}

export default function AdminBusinessDomains() {
  const [data, setData] = useState<OntologyMap | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string>("brand");
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [manualKeys, setManualKeys] = useState<string[]>(["objects"]);

  const load = () => {
    fetch("/api/admin/business-domains", { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`加载失败（${r.status}）`);
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
  }, []);

  const domain = useMemo(() => data?.domains.find((d) => d.code === selected) ?? null, [data, selected]);
  const q = query.trim().toLowerCase();

  // 搜索时展开所有有匹配的分组；无搜索时用用户手动展开的分组。
  const openKeys = useMemo(() => {
    if (!domain) return manualKeys;
    if (!q) return manualKeys;
    return COMPONENT_SECTIONS.filter((s) => {
      const block = domain.components[s.key];
      return block && block.items.some((row) => rowMatches(row, q));
    }).map((s) => s.key);
  }, [domain, q, manualKeys]);

  if (error) return <Alert type="error" message={error} style={{ margin: 16 }} />;
  if (!data) return <Spin style={{ margin: 32 }} />;

  const confirmation = domain?.confirmation ?? null;
  const confirmationUnavailable = !!data.confirmation_unavailable;

  const confirmDomain = () => {
    if (!domain || confirming) return;
    Modal.confirm({
      title: `确认「${domain.name}」域地图？`,
      content: `确认当前展示的域地图内容正确。确认绑定当前内容，注册表变化后确认即过期，需重新确认。确认不是审批；变更仍需走本体变更审批。${note.trim() ? `备注：${note.trim()}` : ""}`,
      okText: "确认",
      cancelText: "取消",
      onOk: async () => {
        setConfirming(true);
        try {
          const r = await fetch(`/api/admin/business-domains/${domain.code}/confirm`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ note: note.trim() }),
          });
          if (!r.ok) {
            const body = await r.json().catch(() => ({}));
            throw new Error(body.message || `确认失败（${r.status}）`);
          }
          message.success(`「${domain.name}」已确认`);
          setNote("");
          load();
        } catch (e) {
          message.error(e instanceof Error ? e.message : "确认失败");
        } finally {
          setConfirming(false);
        }
      },
    });
  };

  return (
    <div style={{ padding: 16, maxWidth: 1280 }}>
      <h2 style={{ marginBottom: 4 }}>业务域地图</h2>
      <p style={{ color: "#666", marginBottom: 12 }}>
        企业级业务本体 · 每个域一页：确认区 + 六构件分组（对象 / 属性 / 关系 / 事件 / 规则 / 动作）。数据来自真实注册表，空白如实标注。
      </p>

      {/* 域选择（唯一选择器） */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {data.domains.map((d) => (
          <Card
            key={d.code}
            size="small"
            hoverable
            tabIndex={0}
            role="button"
            aria-pressed={selected === d.code}
            aria-label={`选择${d.name}域`}
            onClick={() => setSelected(d.code)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setSelected(d.code);
              }
            }}
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
            <div style={{ fontSize: 11, marginTop: 2 }}>
              {d.confirmation ? (
                d.confirmation.current ? (
                  <Tag color="green">已确认</Tag>
                ) : (
                  <Tag color="orange">待更新</Tag>
                )
              ) : (
                <Tag>未确认</Tag>
              )}
            </div>
          </Card>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {/* 域间关系图（全宽，仅展示） */}
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
              // SVG 仅展示，不作选择器（选择器唯一是上方域卡片，避免两套控件）。
              return (
                <g key={d.code}>
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
            <span style={{ marginLeft: 12 }}>上方域卡片切换下方域视图</span>
          </div>
        </Card>

        {/* 域统一视图 */}
        {domain && (
          <Card
            title={`${domain.name} · 域视图`}
            size="small"
            bodyStyle={{ padding: 8 }}
            extra={
              <Input
                size="small"
                allowClear
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索本域全部内容（编码/名称/说明）"
                aria-label="搜索本域全部内容"
                style={{ width: 240 }}
              />
            }
          >
            <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
              域主：{domain.owner}{domain.owner_title ? `（${domain.owner_title}）` : ""} · {domain.description}
              {domain.master_data_kinds.length > 0 && (
                <span style={{ marginLeft: 8 }}>
                  主数据：{domain.master_data_kinds.map((k) => <Tag key={k} style={{ fontSize: 11 }}>{k}</Tag>)}
                </span>
              )}
            </div>

            {/* 确认区 */}
            {confirmationUnavailable ? (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 8 }}
                message="确认状态暂时不可读（确认表不可用），页面内容仍可浏览；确认按钮不可用。"
              />
            ) : confirmation ? (
              <Alert
                type={confirmation.current ? "success" : "warning"}
                showIcon
                style={{ marginBottom: 8 }}
                message={
                  confirmation.current
                    ? `已确认 · ${confirmation.confirmed_by_name} · ${new Date(confirmation.confirmed_at).toLocaleString()}${confirmation.note ? ` · 备注：${confirmation.note}` : ""}`
                    : `待更新 · 上次确认 ${confirmation.confirmed_by_name} · ${new Date(confirmation.confirmed_at).toLocaleString()}（注册表已变化，需重新确认）`
                }
                action={
                  <Button size="small" onClick={confirmDomain} loading={confirming}>
                    重新确认
                  </Button>
                }
              />
            ) : (
              <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
                <Tag>未确认</Tag>
                <Input
                  size="small"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="确认备注（可选，如：已核对对象清单）"
                  style={{ flex: 1 }}
                />
                <Button type="primary" size="small" onClick={confirmDomain} loading={confirming}>
                  确认本域
                </Button>
              </div>
            )}

            {/* 六构件分组（同一页内展开/收起，不再切 Tabs） */}
            <Collapse
              activeKey={openKeys}
              onChange={(keys) => setManualKeys(Array.isArray(keys) ? keys.map(String) : [String(keys)])}
            >
              {COMPONENT_SECTIONS.map((s) => {
                const block = domain.components[s.key];
                const items = block ? block.items.filter((row) => rowMatches(row, q)) : [];
                return (
                  <Collapse.Panel
                    key={s.key}
                    header={`${s.label}（${block?.total ?? 0}）${q && items.length !== (block?.total ?? 0) ? ` · 匹配 ${items.length}` : ""}`}
                  >
                    {renderSection(s.key, block, items)}
                  </Collapse.Panel>
                );
              })}
            </Collapse>
          </Card>
        )}
      </div>
    </div>
  );

  function renderSection(key: string, block: ComponentBlock | undefined, items: ComponentItem[]) {
    if (!block || block.total === 0) {
      return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`${COMPONENT_SECTIONS.find((t) => t.key === key)?.label ?? ""}暂无数据（空白如实标注，待建设）`} />;
    }
    if (items.length === 0) {
      return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`没有匹配“${query.trim()}”的条目`} />;
    }
    const columns = columnsFor(items);
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
          dataSource={items}
          pagination={items.length > 12 ? { pageSize: 12 } : false}
        />
        {block.truncated && <div style={{ fontSize: 11, color: "#999" }}>仅显示前 100 条。</div>}
      </>
    );
  }
}

function columnsFor(items: ComponentItem[]) {
  if (items.length === 0) return [];
  const keys = Object.keys(items[0]);
  return keys.map((k) => ({
    title: columnTitle(k),
    dataIndex: k,
    key: k,
    render: (v: unknown, row: ComponentItem) => renderCell(k, v, row),
  }));
}

function columnTitle(key: string): string {
  const map: Record<string, string> = {
    code: "编码", name: "名称", name_en: "英文名", group: "分组", implementation_status: "实现状态",
    property_count: "属性数", object_code: "对象", object_name: "对象名", kind: "种类", biz_type: "业务类型",
    from_name: "起点", to_name: "终点", label: "关系", direction: "方向",
    category: "分类", object_type: "对象类型", status: "状态",
    type: "类型", detail: "说明", action: "动作", risk: "风险", note: "说明",
    // 常见扩展字段：映射不到时不再暴露原始英文 key。
    description: "描述", source_ref: "来源", authority_source: "权威源",
    authority_source_status: "权威源状态", stable_id: "稳定标识", carrier: "载体",
    clauses: "条款", lineage: "血缘", rule: "规则", gap: "缺口",
    layer: "分层", scope: "范围", change_kind: "变更类型", approver_role: "审批角色",
    from: "起点域", to: "终点域", version: "版本", base_version: "基线版本",
    target_digest: "目标摘要", change_ref: "变更引用", approval_id: "审批 ID",
  };
  if (map[key]) return map[key];
  // 兜底：snake_case 转可读分隔（不暴露原始 key）。
  return key.replace(/_/g, " · ");
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
  // 数组 / 对象不再用 String() 出 [object Object]：数组用顿号连接，对象用 JSON 展开。
  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v ?? ""))).join("、") || "—";
  }
  if (value !== null && typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "—";
    }
  }
  return String(value ?? "") || "—";
}
