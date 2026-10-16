import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Card, Checkbox, Collapse, Descriptions, Empty, Form, Input, Modal, Select, Spin, Table, Tabs, Tag, message } from "antd";
import { useAdminConfirm } from "../components/ConfirmDialog";

/**
 * 管理端 · 本体（统一页，Phase 3）。
 * 一个产品，四段导航：域地图 → 域详情 → 注册表 → 审批。
 * 域地图/域详情来自业务域地图（真实注册表组装）；注册表/审批来自本体管理。
 * 域确认是轻量标记（绑定展示内容 digest），不是审批；变更仍走 ontology_change 审批（CEO 终审）。
 * 此页面不会写入注册表配置文件；文件变更始终通过 Git 完成。
 */

// ---------- 域地图 / 域详情（原 AdminBusinessDomains） ----------

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

const CARD_W = 220;
const CARD_H = 76;

/**
 * 域布局：数据驱动网格（加域不用改代码）。
 * 列数 = min(3, 域数)，卡片在单元格内居中；viewBox 高度按行数算。
 */
function computeDomainPositions(codes: string[]): { pos: Record<string, { x: number; y: number }>; height: number } {
  const n = Math.max(1, codes.length);
  const cols = Math.min(3, n);
  const rows = Math.ceil(n / cols);
  const cellW = 1000 / cols;
  const cellH = 200;
  const pos: Record<string, { x: number; y: number }> = {};
  codes.forEach((code, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    pos[code] = { x: col * cellW + (cellW - CARD_W) / 2, y: row * cellH + (cellH - CARD_H) / 2 };
  });
  return { pos, height: rows * cellH };
}

function edgePath(from: string, to: string, pos: Record<string, { x: number; y: number }>): string {
  const a = pos[from];
  const b = pos[to];
  if (!a || !b) return "";
  const ax = a.x + CARD_W / 2;
  const ay = a.y + CARD_H / 2;
  const bx = b.x + CARD_W / 2;
  const by = b.y + CARD_H / 2;
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
    description: "描述", source_ref: "来源", authority_source: "权威源",
    authority_source_status: "权威源状态", stable_id: "稳定标识", carrier: "载体",
    clauses: "条款", lineage: "血缘", rule: "规则", gap: "缺口",
    layer: "分层", scope: "范围", change_kind: "变更类型", approver_role: "审批角色",
    from: "起点域", to: "终点域", version: "版本", base_version: "基线版本",
    target_digest: "目标摘要", change_ref: "变更引用", approval_id: "审批 ID",
  };
  if (map[key]) return map[key];
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

// ---------- 注册表 / 审批（原 AdminOntology 本体管理） ----------

type OntologyScope = "objects" | "events" | "tickets" | "rules";

type OntologyRegistry = {
  scope: OntologyScope;
  scope_label?: string;
  base_version?: string;
  target_digest?: string | null;
  data: unknown;
};

type OntologyApproval = {
  approval_id?: string;
  status?: string;
  scope?: OntologyScope;
  base_version?: string;
};

type LatestApprovalResponse = {
  scope?: OntologyScope;
  scope_label?: string;
  base_version?: string;
  latest?: OntologyApproval | null;
};

type RegistryResponse = { registries?: OntologyRegistry[] };
type RegistryEntry = { id: string; collection: string; value: unknown };

type OntologyRef = { ref: string; kind: "branch" | "commit"; subject: string; date: string };
type OntologyDiffChange = {
  section: string;
  change_kind: "added" | "removed" | "changed";
  key: string;
  label: string;
  fields?: Array<{ field: string; from: string; to: string }>;
  from?: string;
  to?: string;
};
type OntologyDiff = {
  scope: OntologyScope;
  base_version: string;
  base_label: string;
  target_label: string;
  target_digest: string | null;
  approvable: boolean;
  changes: OntologyDiffChange[];
  truncated: boolean;
};

/** 未提交的工作区改动：仅预览 diff，不可发起审批。 */
const WORKING_PREVIEW_REF = "__working__";

const TARGET_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/i;

function diffKindLabel(kind: string): string {
  return kind === "added" ? "新增" : kind === "removed" ? "删除" : "变更";
}

const SCOPES: Array<{ id: OntologyScope; label: string; listKeys: string[] }> = [
  { id: "objects", label: "对象", listKeys: ["objects"] },
  { id: "events", label: "事件", listKeys: ["events"] },
  { id: "tickets", label: "票型", listKeys: ["kinds", "tickets"] },
  { id: "rules", label: "规则", listKeys: ["nodes", "rules"] },
];

function isScope(value: unknown): value is OntologyScope {
  return SCOPES.some((scope) => scope.id === value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function textOf(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(textOf).join("、");
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function shortText(value: unknown, limit = 180): string {
  const text = textOf(value);
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function jsonText(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function valueAt(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null && record[key] !== "") return record[key];
  }
  return null;
}

function entryTitle(entry: RegistryEntry): string {
  const record = asRecord(entry.value);
  if (!record) return shortText(entry.value, 80);
  return shortText(valueAt(record, ["name", "label", "title", "code", "id"]) ?? entry.collection, 120);
}

function entryCode(entry: RegistryEntry): string {
  const record = asRecord(entry.value);
  if (!record) return "";
  const code = valueAt(record, ["code", "id", "key"]);
  return code ? shortText(code, 120) : "";
}

function entrySummary(entry: RegistryEntry): string {
  const record = asRecord(entry.value);
  if (!record) return shortText(entry.value);
  const value = valueAt(record, ["desc", "description", "note", "rule", "follow_up", "payload"]);
  return shortText(value ?? "—");
}

function entryCategory(entry: RegistryEntry): string {
  const record = asRecord(entry.value);
  if (!record) return "—";
  return shortText(valueAt(record, ["category", "layer", "kind", "domain", "object_type"]) ?? "—", 80);
}

function entryStatus(entry: RegistryEntry): string {
  const record = asRecord(entry.value);
  if (!record) return "—";
  return shortText(valueAt(record, ["status", "implementation_status", "host_enforced", "live_enforced"]) ?? "—", 80);
}

function entrySource(entry: RegistryEntry): string {
  const record = asRecord(entry.value);
  if (!record) return entry.collection;
  return shortText(valueAt(record, ["source_ref", "carrier", "producer", "authority_source"]) ?? entry.collection, 140);
}

function registryEntries(data: unknown, scope: OntologyScope): RegistryEntry[] {
  if (Array.isArray(data)) return data.map((value, index) => ({ id: String(index), collection: "items", value }));
  const record = asRecord(data);
  if (!record) return [{ id: "root", collection: "config", value: data }];

  const preferred = SCOPES.find((item) => item.id === scope)?.listKeys || [];
  const keys = [...preferred, ...Object.keys(record)];
  for (const key of [...new Set(keys)]) {
    const value = record[key];
    if (Array.isArray(value)) return value.map((item, index) => ({ id: `${key}-${index}`, collection: key, value: item }));
  }
  return Object.entries(record).map(([key, value]) => ({ id: key, collection: key, value }));
}

function approvalTone(status?: string): "pending" | "ok" | "error" | "muted" {
  const value = String(status || "").toLowerCase();
  if (value === "pending") return "pending";
  if (["approved", "consumed", "completed"].includes(value)) return "ok";
  if (["rejected", "cancelled", "failed", "expired"].includes(value)) return "error";
  return "muted";
}

async function ontologyRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  const raw = await response.text();
  let payload: unknown = null;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = raw;
    }
  }
  if (!response.ok) {
    const body = asRecord(payload);
    const message = typeof body?.message === "string"
      ? body.message
      : typeof body?.error === "string"
        ? body.error
        : typeof payload === "string" && payload.trim()
          ? payload
          : `请求失败（${response.status}）`;
    throw new Error(message);
  }
  return payload as T;
}

export default function AdminOntology() {
  const { ask, dialog } = useAdminConfirm();

  // ---------- 域地图 / 域详情 ----------
  const [mapData, setMapData] = useState<OntologyMap | null>(null);
  const [mapError, setMapError] = useState("");
  const [selected, setSelected] = useState<string>("brand");
  const [section, setSection] = useState<string>("map");
  const [detailQuery, setDetailQuery] = useState("");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [manualKeys, setManualKeys] = useState<string[]>(["objects"]);

  const loadMap = useCallback(() => {
    fetch("/api/admin/business-domains", { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`加载失败（${r.status}）`);
        return r.json();
      })
      .then(setMapData)
      .catch((e) => setMapError(e.message));
  }, []);

  useEffect(() => {
    loadMap();
  }, [loadMap]);

  const domain = useMemo(() => mapData?.domains.find((d) => d.code === selected) ?? null, [mapData, selected]);
  const dq = detailQuery.trim().toLowerCase();
  const detailOpenKeys = useMemo(() => {
    if (!domain) return manualKeys;
    if (!dq) return manualKeys;
    return COMPONENT_SECTIONS.filter((s) => {
      const block = domain.components[s.key];
      return block && block.items.some((row) => rowMatches(row, dq));
    }).map((s) => s.key);
  }, [domain, dq, manualKeys]);
  const domainPos = useMemo(
    () => computeDomainPositions((mapData?.domains ?? []).map((d) => d.code)),
    [mapData],
  );

  const confirmDomain = useCallback(() => {
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
          loadMap();
        } catch (e) {
          message.error(e instanceof Error ? e.message : "确认失败");
        } finally {
          setConfirming(false);
        }
      },
    });
  }, [domain, confirming, note, loadMap]);

  // ---------- 注册表 ----------
  const [registries, setRegistries] = useState<Record<OntologyScope, OntologyRegistry | null>>({
    objects: null,
    events: null,
    tickets: null,
    rules: null,
  });
  const [latestByScope, setLatestByScope] = useState<Record<OntologyScope, LatestApprovalResponse | null>>({
    objects: null,
    events: null,
    tickets: null,
    rules: null,
  });
  const [scope, setScope] = useState<OntologyScope>("objects");
  const [regQuery, setRegQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showConfig, setShowConfig] = useState(false);
  const loadSequence = useRef(0);

  const loadLatest = useCallback(async (nextScope: OntologyScope): Promise<LatestApprovalResponse> => (
    ontologyRequest<LatestApprovalResponse>(`/api/admin/ontology/change-approvals/latest?scope=${encodeURIComponent(nextScope)}`)
  ), []);

  const loadRegistries = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError("");
    try {
      const registriesResponse = await ontologyRequest<RegistryResponse>("/api/admin/ontology/registries");
      const rows = Array.isArray(registriesResponse.registries) ? registriesResponse.registries : [];
      const nextRegistries: Record<OntologyScope, OntologyRegistry | null> = { objects: null, events: null, tickets: null, rules: null };
      for (const row of rows) {
        if (isScope(row.scope)) nextRegistries[row.scope] = row;
      }
      const latestRows = await Promise.all(SCOPES.map(async (item) => [item.id, await loadLatest(item.id)] as const));
      if (sequence !== loadSequence.current) return;
      setRegistries(nextRegistries);
      setLatestByScope(Object.fromEntries(latestRows) as Record<OntologyScope, LatestApprovalResponse>);
    } catch (cause) {
      if (sequence !== loadSequence.current) return;
      setError(cause instanceof Error ? cause.message : "无法读取本体注册表或审批状态");
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [loadLatest]);

  useEffect(() => {
    void loadRegistries();
  }, [loadRegistries]);

  const activeRegistry = registries[scope];
  const activeScope = SCOPES.find((item) => item.id === scope) || SCOPES[0];
  const activeLabel = activeRegistry?.scope_label || activeScope.label;
  const latestResponse = latestByScope[scope];
  const latest = latestResponse?.latest || null;
  const baseline = activeRegistry?.base_version || latestResponse?.base_version || "—";
  const entries = useMemo(() => activeRegistry ? registryEntries(activeRegistry.data, scope) : [], [activeRegistry, scope]);
  const filteredEntries = useMemo(() => {
    const normalized = regQuery.trim().toLocaleLowerCase();
    if (!normalized) return entries;
    return entries.filter((entry) => jsonText(entry.value).toLocaleLowerCase().includes(normalized));
  }, [entries, regQuery]);

  const reloadScopeStatus = useCallback(async (nextScope: OntologyScope) => {
    setError("");
    try {
      const latestStatus = await loadLatest(nextScope);
      setLatestByScope((current) => ({ ...current, [nextScope]: latestStatus }));
      setNotice(`已重新读取「${SCOPES.find((item) => item.id === nextScope)?.label || nextScope}」的最新审批状态。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取最新审批状态");
    }
  }, [loadLatest]);

  // ---------- 审批 ----------
  const [summary, setSummary] = useState("");
  const [title, setTitle] = useState("");
  const [targetDigest, setTargetDigest] = useState("");
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [refs, setRefs] = useState<OntologyRef[]>([]);
  const [refsLoading, setRefsLoading] = useState(false);
  const [selectedRef, setSelectedRef] = useState("");
  const [diff, setDiff] = useState<OntologyDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState("");
  const [diffConfirmed, setDiffConfirmed] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const loadRefs = useCallback(async (nextScope: OntologyScope) => {
    setRefsLoading(true);
    setSelectedRef("");
    setDiff(null);
    setDiffError("");
    setDiffConfirmed(false);
    try {
      const res = await ontologyRequest<{ refs?: OntologyRef[] }>(
        `/api/admin/ontology/refs?scope=${encodeURIComponent(nextScope)}`,
      );
      setRefs(Array.isArray(res.refs) ? res.refs : []);
    } catch (cause) {
      setDiffError(cause instanceof Error ? cause.message : "无法读取引用候选");
    } finally {
      setRefsLoading(false);
    }
  }, []);

  const loadDiff = useCallback(async (nextScope: OntologyScope, ref: string) => {
    setDiffLoading(true);
    setDiffError("");
    setDiffConfirmed(false);
    try {
      const qs = new URLSearchParams({ scope: nextScope });
      if (ref !== WORKING_PREVIEW_REF) qs.set("change_ref", ref);
      const res = await ontologyRequest<OntologyDiff>(`/api/admin/ontology/diff?${qs.toString()}`);
      setDiff(res);
    } catch (cause) {
      setDiff(null);
      setDiffError(cause instanceof Error ? cause.message : "无法读取 diff");
    } finally {
      setDiffLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRefs(scope);
  }, [scope, loadRefs]);

  useEffect(() => {
    if (!selectedRef) {
      setDiff(null);
      setDiffError("");
      setDiffConfirmed(false);
      return;
    }
    void loadDiff(scope, selectedRef);
  }, [selectedRef, scope, loadDiff]);

  const submitApproval = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setError("");
    setNotice("");
    const body: Record<string, string> = { scope, summary: summary.trim() };
    if (title.trim()) body.title = title.trim();
    if (selectedRef && selectedRef !== WORKING_PREVIEW_REF) body.change_ref = selectedRef;
    else if (targetDigest.trim()) body.target_digest = targetDigest.trim();

    try {
      await ontologyRequest("/api/admin/ontology/change-approvals", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setNotice("待审批请求已响应；正在重新读取该范围的真实最新审批状态。");
      try {
        const latestStatus = await loadLatest(scope);
        setLatestByScope((current) => ({ ...current, [scope]: latestStatus }));
        setNotice(`待审批请求已响应；已重新读取「${activeLabel}」的真实最新审批状态。`);
        setSummary("");
        setTitle("");
        setTargetDigest("");
        setSelectedRef("");
        setDiff(null);
        setDiffConfirmed(false);
      } catch (refreshCause) {
        setError(`审批请求已响应，但读取最新审批状态失败：${refreshCause instanceof Error ? refreshCause.message : "未知错误"}`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法发起本体变更审批");
    } finally {
      setSubmitting(false);
    }
  }, [activeLabel, loadLatest, scope, submitting, summary, targetDigest, title, selectedRef]);

  const openApprovalConfirm = () => {
    const cleanSummary = summary.trim();
    const cleanTargetDigest = targetDigest.trim();
    if (!scope || !cleanSummary) {
      setFormError("范围与变更摘要为必填项。");
      return;
    }
    const useAdvanced = showAdvanced && !!cleanTargetDigest;
    if (useAdvanced) {
      if (!TARGET_DIGEST_PATTERN.test(cleanTargetDigest)) {
        setFormError("目标内容摘要必须是 sha256:<64 位十六进制字符>。");
        return;
      }
    } else {
      if (!selectedRef) {
        setFormError("请选择变更引用（下拉），并确认 diff；或在高级中提供 target_digest。");
        return;
      }
      if (selectedRef === WORKING_PREVIEW_REF) {
        setFormError("未提交的工作区改动仅供预览 diff，不可发起审批；请先把改动提交到分支，再选该分支。");
        return;
      }
      if (!diff || diffError) {
        setFormError("diff 未读出，无法确认变更内容；请重试或选其他引用。");
        return;
      }
      if (!diff.approvable) {
        setFormError("该目标不可发起审批；请选择一个分支或提交引用。");
        return;
      }
      if (!diffConfirmed) {
        setFormError("请先勾选“我已确认以上变更”，再提交审批。");
        return;
      }
    }
    setFormError("");
    const added = diff?.changes.filter((c) => c.change_kind === "added").length ?? 0;
    const removed = diff?.changes.filter((c) => c.change_kind === "removed").length ?? 0;
    const changed = diff?.changes.filter((c) => c.change_kind === "changed").length ?? 0;
    const diffSummary = useAdvanced
      ? "高级模式：未预览 diff，目标摘要由发起人提供。"
      : `diff：新增 ${added}、删除 ${removed}、变更 ${changed}${diff?.truncated ? "（已截断，仅显示前 200 项）" : ""}；目标：${diff?.target_label ?? selectedRef}；基线：${diff?.base_label ?? baseline}。`;
    const digestForConfirm = useAdvanced
      ? cleanTargetDigest
      : diff?.target_digest || "未填写（由后端根据所选引用计算）";
    const refForConfirm = useAdvanced ? "未填写（使用显式目标内容摘要）" : selectedRef;
    ask({
      kind: "approval-initiate",
      title: "确认发起本体变更审批？",
      object: `${activeLabel} · ${scope}`,
      scope: `${activeLabel}（${scope}）`,
      change: `摘要：${cleanSummary}；${diffSummary}；目标内容摘要：${digestForConfirm}；变更引用：${refForConfirm}${title.trim() ? `；标题：${title.trim()}` : ""}`,
      consequence: "确认后只创建待审批请求，不产生 CEO 批准。此页面不写入注册表文件；文件级变更仍必须通过 Git 完成，并由后端按当前基线与目标内容校验。",
      ruleVersion: baseline,
      approvalState: latest?.status ? `当前最新状态：${latest.status}` : "当前暂无审批记录",
      confirmLabel: "确认提交审批",
      busyLabel: "提交审批中…",
      confirmTone: "primary",
      initialFocus: "cancel",
      cancelLabel: "取消，不提交",
      cancelHint: "取消只关闭确认，不会创建审批请求或写入文件。",
    }, async () => {
      await submitApproval();
    });
  };

  const selectScope = (nextScope: OntologyScope) => {
    setScope(nextScope);
    setShowConfig(false);
    setFormError("");
  };

  const renderRegistryPanel = (panelScope: OntologyScope) => {
    const reg = registries[panelScope];
    const panelLatest = latestByScope[panelScope]?.latest || null;
    const panelBaseline = reg?.base_version || latestByScope[panelScope]?.base_version || "—";
    const panelEntries = reg ? registryEntries(reg.data, panelScope) : [];
    const panelFiltered = (() => {
      const normalized = regQuery.trim().toLocaleLowerCase();
      if (!normalized) return panelEntries;
      return panelEntries.filter((entry) => jsonText(entry.value).toLocaleLowerCase().includes(normalized));
    })();
    return (
      <div>
        <Descriptions size="small" bordered column={1} style={{ marginBottom: 12 }}>
          <Descriptions.Item label="当前 baseline">
            <code title={panelBaseline}>{panelBaseline}</code>
          </Descriptions.Item>
          <Descriptions.Item label="目标内容摘要">
            <code title={reg?.target_digest || ""}>{reg?.target_digest || "未提供（当前运行文件摘要不作为待变更目标）"}</code>
          </Descriptions.Item>
          <Descriptions.Item label="最新审批状态">
            {panelLatest ? (
              <span>
                <Tag color={approvalTone(panelLatest.status) === "ok" ? "green" : approvalTone(panelLatest.status) === "error" ? "red" : approvalTone(panelLatest.status) === "pending" ? "orange" : "default"}>
                  状态：{panelLatest.status || "未返回"}
                </Tag>
                <span style={{ marginLeft: 8 }}>审批 ID：{panelLatest.approval_id || "未返回"}</span>
              </span>
            ) : (
              <span>暂无审批记录</span>
            )}
            <Button type="link" size="small" onClick={() => void reloadScopeStatus(panelScope)} disabled={loading || submitting}>
              重试状态读取
            </Button>
          </Descriptions.Item>
        </Descriptions>
        <Table
          size="small"
          rowKey={(entry: RegistryEntry) => entry.id}
          dataSource={panelFiltered}
          pagination={panelFiltered.length > 15 ? { pageSize: 15 } : false}
          columns={[
            {
              title: "条目",
              key: "entry",
              render: (_: unknown, entry: RegistryEntry) => (
                <span>
                  <strong title={entryTitle(entry)}>{entryTitle(entry)}</strong>
                  {entryCode(entry) && entryCode(entry) !== entryTitle(entry) ? <code> {entryCode(entry)}</code> : null}
                </span>
              ),
            },
            {
              title: "摘要",
              key: "summary",
              render: (_: unknown, entry: RegistryEntry) => <span title={entrySummary(entry)}>{entrySummary(entry)}</span>,
            },
            {
              title: "分类 / 状态",
              key: "category",
              render: (_: unknown, entry: RegistryEntry) => (
                <span>
                  {entryCategory(entry)}
                  <div style={{ color: "#888" }}>{entryStatus(entry)}</div>
                </span>
              ),
            },
            {
              title: "来源",
              key: "source",
              render: (_: unknown, entry: RegistryEntry) => <span title={entrySource(entry)}>{entrySource(entry)}</span>,
            },
          ]}
          locale={{ emptyText: loading && !reg ? "正在读取当前注册表…" : !reg ? "该范围尚未返回注册表数据。" : "当前搜索没有匹配条目。" }}
        />
        {reg ? (
          <div style={{ marginTop: 8 }}>
            <Button type="link" size="small" onClick={() => setShowConfig((v) => !v)}>
              {showConfig ? "收起完整配置对象" : "查看完整配置对象"}
            </Button>
            {showConfig ? <pre aria-label={`${activeLabel}完整配置对象`}>{jsonText(reg.data)}</pre> : null}
          </div>
        ) : null}
      </div>
    );
  };

  const confirmation = domain?.confirmation ?? null;
  const confirmationUnavailable = !!mapData?.confirmation_unavailable;
  const diffAdded = diff?.changes.filter((c) => c.change_kind === "added").length ?? 0;
  const diffRemoved = diff?.changes.filter((c) => c.change_kind === "removed").length ?? 0;
  const diffChanged = diff?.changes.filter((c) => c.change_kind === "changed").length ?? 0;

  return (
    <div style={{ padding: 16, maxWidth: 1280 }}>
      {dialog}
      <h2 style={{ marginBottom: 4 }}>本体</h2>
      <p style={{ color: "#666", marginBottom: 12 }}>
        域地图 → 域详情 → 注册表 → 审批。浏览当前注册表基线与最新审批状态。此页面不会写入配置文件；文件变更始终通过 Git 完成，发起审批不产生 CEO 批准。
      </p>
      {notice ? <Alert type="success" showIcon message={notice} style={{ marginBottom: 8 }} /> : null}
      {error ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 8 }}
          message={error}
          action={<Button size="small" onClick={() => void loadRegistries()} disabled={loading || submitting}>重试读取</Button>}
        />
      ) : null}
      {mapError ? <Alert type="error" showIcon message={mapError} style={{ marginBottom: 8 }} /> : null}

      <Tabs
        activeKey={section}
        onChange={setSection}
        size="small"
        items={[
          {
            key: "map",
            label: "域地图",
            children: (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {/* 域选择卡片：点卡片进入该域的详情 */}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {(mapData?.domains ?? []).map((d) => (
                    <Card
                      key={d.code}
                      size="small"
                      hoverable
                      tabIndex={0}
                      role="button"
                      aria-pressed={selected === d.code}
                      aria-label={`查看${d.name}域详情`}
                      onClick={() => { setSelected(d.code); setSection("detail"); }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelected(d.code);
                          setSection("detail");
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
                          d.confirmation.current ? <Tag color="green">已确认</Tag> : <Tag color="orange">待更新</Tag>
                        ) : (
                          <Tag>未确认</Tag>
                        )}
                      </div>
                    </Card>
                  ))}
                </div>
                {/* 域间关系图（仅展示） */}
                <Card title="域间关系" size="small" bodyStyle={{ padding: 8 }}>
                  <svg viewBox={`0 0 1000 ${domainPos.height}`} style={{ width: "100%", height: "auto", maxHeight: 480 }}>
                    <defs>
                      <marker id="omap-arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
                        <path d="M0,0 L9,4.5 L0,9 z" fill="#1890ff" />
                      </marker>
                      <marker id="omap-arrow-gray" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
                        <path d="M0,0 L9,4.5 L0,9 z" fill="#999" />
                      </marker>
                    </defs>
                    {(mapData?.relations ?? [])
                      .filter((r) => r.kind !== "none")
                      .map((r, i) => (
                        <g key={i}>
                          <path
                            d={edgePath(r.from, r.to, domainPos.pos)}
                            fill="none"
                            stroke={r.kind === "master_data" ? "#999" : "#1890ff"}
                            strokeWidth={1.5}
                            strokeDasharray={r.kind === "master_data" ? "6 4" : undefined}
                            markerEnd={r.kind === "master_data" ? "url(#omap-arrow-gray)" : "url(#omap-arrow)"}
                            opacity={r.from === selected || r.to === selected ? 1 : 0.35}
                          />
                        </g>
                      ))}
                    {(mapData?.domains ?? []).map((d) => {
                      const p = domainPos.pos[d.code];
                      if (!p) return null;
                      const active = d.code === selected;
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
                    <span style={{ marginLeft: 12 }}>点域卡片查看该域详情</span>
                  </div>
                </Card>
              </div>
            ),
          },
          {
            key: "detail",
            label: "域详情",
            children: domain ? (
              <Card
                title={`${domain.name} · 域视图`}
                size="small"
                bodyStyle={{ padding: 8 }}
                extra={
                  <Input
                    size="small"
                    allowClear
                    value={detailQuery}
                    onChange={(e) => setDetailQuery(e.target.value)}
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
                <Collapse
                  activeKey={detailOpenKeys}
                  onChange={(keys) => setManualKeys(Array.isArray(keys) ? keys.map(String) : [String(keys)])}
                >
                  {COMPONENT_SECTIONS.map((s) => {
                    const block = domain.components[s.key];
                    const items = block ? block.items.filter((row) => rowMatches(row, dq)) : [];
                    return (
                      <Collapse.Panel
                        key={s.key}
                        header={`${s.label}（${block?.total ?? 0}）${dq && items.length !== (block?.total ?? 0) ? ` · 匹配 ${items.length}` : ""}`}
                      >
                        {!block || block.total === 0 ? (
                          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`${s.label}暂无数据（空白如实标注，待建设）`} />
                        ) : items.length === 0 ? (
                          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`没有匹配“${detailQuery.trim()}”的条目`} />
                        ) : (
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
                              rowKey={(_: ComponentItem, idx?: number) => `${s.key}-${idx}`}
                              columns={columnsFor(items)}
                              dataSource={items}
                              pagination={items.length > 12 ? { pageSize: 12 } : false}
                            />
                            {block.truncated && <div style={{ fontSize: 11, color: "#999" }}>仅显示前 100 条。</div>}
                          </>
                        )}
                      </Collapse.Panel>
                    );
                  })}
                </Collapse>
              </Card>
            ) : (
              <Spin style={{ margin: 32 }} />
            ),
          },
          {
            key: "registry",
            label: "注册表",
            children: (
              <div>
                <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "#666" }}>搜索当前注册表：</span>
                  <Input
                    size="small"
                    allowClear
                    value={regQuery}
                    onChange={(e) => setRegQuery(e.target.value)}
                    placeholder="搜索名称、代码、状态或引用"
                    aria-label="搜索当前注册表"
                    style={{ width: 280 }}
                    disabled={loading}
                  />
                  <Button type="link" size="small" onClick={() => void loadRegistries()} disabled={loading || submitting}>
                    {loading ? "读取中…" : "重新读取"}
                  </Button>
                </div>
                <p style={{ fontSize: 12, color: "#666" }}>搜索匹配当前范围内条目的完整字段内容。列表仅作浏览，不提供文件编辑。</p>
                <Tabs
                  activeKey={scope}
                  onChange={(k) => selectScope(k as OntologyScope)}
                  size="small"
                  items={SCOPES.map((item) => ({
                    key: item.id,
                    label: item.label,
                    children: renderRegistryPanel(item.id),
                  }))}
                />
              </div>
            ),
          },
          {
            key: "approval",
            label: "审批",
            children: (
              <div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: "#666" }}>审批范围：</span>
                  <Select
                    size="small"
                    value={scope}
                    onChange={(v) => selectScope(v as OntologyScope)}
                    options={SCOPES.map((item) => ({ value: item.id, label: `${item.label}（${item.id}）` }))}
                    style={{ width: 160 }}
                    disabled={submitting}
                  />
                  <span style={{ fontSize: 12, color: "#666" }}>
                    当前最新：{latest ? `${latest.status || "未返回"}（${latest.approval_id || "未返回"}）` : "暂无审批记录"}
                  </span>
                  <Tag color="red">R3 · 正式写入前确认</Tag>
                </div>
                <p style={{ fontSize: 12, color: "#666" }}>
                  选一个变更引用，系统自动算出 diff 供你确认；target_digest 由后端按引用计算，不用手输。审批请求绑定当前范围与后端返回的 baseline；当前运行文件摘要不会被自动当作待变更目标。
                </p>
                <Form layout="vertical" onFinish={openApprovalConfirm} style={{ maxWidth: 720 }}>
                  <Form.Item label="审批标题（可选）">
                    <Input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      maxLength={160}
                      disabled={submitting}
                      placeholder={`默认：本体变更审批：${activeLabel}`}
                    />
                  </Form.Item>
                  <Form.Item label="变更摘要" required>
                    <Input.TextArea
                      value={summary}
                      onChange={(e) => setSummary(e.target.value)}
                      disabled={submitting}
                      rows={3}
                      placeholder="说明改了什么、为什么，以及受影响的范围"
                    />
                  </Form.Item>
                  <Form.Item label="变更引用（下拉选择，不用手输）">
                    <Select
                      value={selectedRef || undefined}
                      onChange={setSelectedRef}
                      disabled={submitting || refsLoading}
                      placeholder={refsLoading ? "读取引用中…" : "请选择变更引用"}
                      options={[
                        { value: WORKING_PREVIEW_REF, label: "未提交的工作区改动（仅预览 diff，不可审批）" },
                        ...refs.map((r) => ({
                          value: r.ref,
                          label: `${r.kind === "branch" ? "分支" : "提交"} · ${r.ref.slice(0, 40)}${r.subject ? ` · ${r.subject.slice(0, 40)}` : ""}`,
                        })),
                      ]}
                    />
                  </Form.Item>
                  {selectedRef ? (
                    <div style={{ marginBottom: 16 }}>
                      {diffLoading ? (
                        <p style={{ color: "#666" }}>正在计算 diff…</p>
                      ) : diffError ? (
                        <Alert type="error" showIcon message={diffError} />
                      ) : diff ? (
                        <>
                          <p style={{ color: "#666" }}>
                            基线：{diff.base_label} · 目标：{diff.target_label}
                            {diff.target_digest ? ` · 目标摘要：${diff.target_digest.slice(0, 19)}…` : ""}
                          </p>
                          {diff.changes.length === 0 ? (
                            <p style={{ color: "#666" }}>基线与目标内容一致，无变更。</p>
                          ) : (
                            <div style={{ maxHeight: 300, overflowY: "auto", border: "1px solid #e5e5e5", borderRadius: 4, padding: 8 }}>
                              {Array.from(new Set(diff.changes.map((c) => c.section))).map((sec) => (
                                <div key={sec} style={{ marginBottom: 8 }}>
                                  <strong>{sec}</strong>
                                  <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
                                    {diff.changes.filter((c) => c.section === sec).map((c, i) => (
                                      <li key={`${c.change_kind}:${c.key}:${i}`} style={{ fontSize: 13 }}>
                                        [{diffKindLabel(c.change_kind)}] {c.label}
                                        {c.key !== c.label ? <code>（{c.key}）</code> : null}
                                        {c.fields && c.fields.length > 0 ? (
                                          <ul style={{ margin: "2px 0 0 16px", padding: 0, color: "#555" }}>
                                            {c.fields.map((f) => (
                                              <li key={f.field}>
                                                {f.field}：{f.from || "（空）"} → {f.to || "（空）"}
                                              </li>
                                            ))}
                                          </ul>
                                        ) : null}
                                        {c.from !== undefined || c.to !== undefined ? (
                                          <span style={{ color: "#555" }}>：{c.from || "（空）"} → {c.to || "（空）"}</span>
                                        ) : null}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ))}
                            </div>
                          )}
                          {diff.truncated && <p style={{ color: "#666" }}>diff 已截断，仅显示前 200 项。</p>}
                          {diff.approvable ? (
                            <Checkbox
                              checked={diffConfirmed}
                              onChange={(e) => setDiffConfirmed(e.target.checked)}
                              disabled={submitting || diff.changes.length === 0}
                              style={{ marginTop: 8 }}
                            >
                              我已确认以上 {diff.changes.length} 项变更{diff.changes.length === 0 ? "（无变更，不可提交）" : ""}
                            </Checkbox>
                          ) : (
                            <p style={{ color: "#666" }}>未提交改动仅供预览；请先把改动提交到分支，再选该分支发起审批。</p>
                          )}
                        </>
                      ) : null}
                    </div>
                  ) : null}
                  <Form.Item>
                    <Button type="link" size="small" onClick={() => setShowAdvanced((v) => !v)} style={{ paddingLeft: 0 }}>
                      {showAdvanced ? "收起高级：直接提供 target_digest" : "高级：直接提供 target_digest（改动不在服务器 Git 里时用）"}
                    </Button>
                    {showAdvanced && (
                      <Input
                        value={targetDigest}
                        onChange={(e) => setTargetDigest(e.target.value)}
                        disabled={submitting}
                        placeholder="sha256:<64 位十六进制字符>"
                        style={{ marginTop: 4 }}
                      />
                    )}
                  </Form.Item>
                  {formError ? <Alert type="error" showIcon message={formError} style={{ marginBottom: 12 }} /> : null}
                  <Form.Item>
                    <p style={{ color: "#666" }}>确认页会再次展示范围、变更摘要、diff 摘要与目标内容摘要；提交只创建待审批请求，不产生 CEO 批准，随后只读取真实 latest。</p>
                    <Button type="primary" htmlType="submit" loading={submitting} disabled={loading}>
                      {submitting ? "提交审批中…" : "发起审批"}
                    </Button>
                  </Form.Item>
                </Form>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
