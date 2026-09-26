import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { governanceStatus, type AdminRow } from "../../adminGovernance";
import { ConnectorMark } from "./ConnectorMark";
import { JsonImportPanel, McpConfigPanel, UrlAddPanel } from "./ConnectorPanels";
import { ConnectorToolsDrawer } from "./ConnectorToolsDrawer";
import {
  connectorActionLabel,
  connectorCardView,
  connectorHref,
  connectorStatusNote,
  kindLabel,
  type ConnectorCardView,
} from "./entity";
import "./connectorAdmin.css";

export type ConnectorSaveFn = (path: string, body: AdminRow, message: string, method?: string) => Promise<void>;

type CreatePanelKind = "mcp" | "url" | "json";

const CREATE_ITEMS: Array<{ kind: CreatePanelKind; label: string; hint: string }> = [
  { kind: "mcp", label: "自定义 MCP", hint: "填写服务器名称、传输类型、URL 与请求头" },
  { kind: "json", label: "通过 JSON 导入 MCP", hint: "粘贴 mcpServers 配置，预览后导入" },
  { kind: "url", label: "通过 URL 添加 MCP", hint: "只填名称与服务器 URL，快速加入目录" },
];

/** Built-in catalog entries. Seeds exist for both; the + path stays honest for future entries. */
const BUILTIN_CATALOG = [
  { id: "claw", label: "MediaCrawler MCP", purpose: "创作者采集、检索与画像数据" },
  { id: "starrykol", label: "Starry KOL MCP", purpose: "红人库、负责人、品牌邮箱与合作往来事实" },
] as const;

export function ConnectorHub({ connectors, users, onSave, reload }: {
  connectors: AdminRow[];
  users: AdminRow[];
  onSave: ConnectorSaveFn;
  reload: () => void;
}) {
  const cards = useMemo(() => connectors.map(connectorCardView), [connectors]);
  const [q, setQ] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const [tab, setTab] = useState<"app" | "custom_mcp">("app");
  const [menuOpen, setMenuOpen] = useState(false);
  const [panel, setPanel] = useState<CreatePanelKind | null>(null);
  const [toolsCard, setToolsCard] = useState<ConnectorCardView | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [adding, setAdding] = useState("");

  const needle = q.trim().toLowerCase();
  const filtered = cards.filter((card) => !needle || `${card.label} ${card.purpose} ${card.id}`.toLowerCase().includes(needle));
  const visible = browsing ? filtered.filter((card) => card.kind === tab) : filtered;
  const missingBuiltins = browsing && tab === "app"
    ? BUILTIN_CATALOG.filter((entry) => !cards.some((card) => card.id === entry.id))
    : [];

  const finishPanel = (message: string) => {
    setPanel(null);
    setError("");
    setNotice(message);
    reload();
  };

  const addBuiltin = async (id: string, label: string, purpose: string) => {
    setAdding(id);
    setError("");
    try {
      await onSave("/api/admin/connectors", { id, label, purpose }, `已将“${label}”加入连接器目录`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加入目录失败");
    } finally {
      setAdding("");
    }
  };

  return (
    <section className="connector-hub" data-connector-hub data-connector-mode={browsing ? "browse" : "added"} data-admin-page="connectors">
      <header className="connector-hub-head">
        <div>
          <p className="page-kicker">连接器治理</p>
          <h2 data-connector-hub-title>{browsing ? "连接器" : "已添加的连接器"}</h2>
          <p className="muted">
            组织当前挂接的连接能力。配置权限不等于调用权限；接口仍需逐项审阅与范围授权，L3 动作继续经过确认与 Host Gateway。
          </p>
        </div>
        <div className="connector-hub-actions">
          <button
            type="button"
            className="btn"
            aria-pressed={browsing}
            data-connector-browse-toggle
            onClick={() => setBrowsing((value) => !value)}
          >
            {browsing ? "返回已添加" : "浏览连接器"}
          </button>
          <div className="connector-menu-wrap">
            <button
              type="button"
              className="btn"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              data-connector-create-toggle
              onClick={() => setMenuOpen((value) => !value)}
            >
              创建 <span aria-hidden>⌄</span>
            </button>
            {menuOpen && (
              <CreateMenu
                onPick={(kind) => {
                  setMenuOpen(false);
                  setPanel(kind);
                }}
                onClose={() => setMenuOpen(false)}
              />
            )}
          </div>
        </div>
      </header>

      <div className="connector-hub-tools">
        <label className="connector-search">
          <svg viewBox="0 0 24 24" aria-hidden>
            <circle cx="11" cy="11" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
            <path d="M16 16.4 20 20.4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            className="connector-search-input"
            data-connector-search
            placeholder="搜索连接器"
            aria-label="搜索连接器"
            value={q}
            onChange={(event) => setQ(event.target.value)}
          />
        </label>
        {browsing && (
          <div className="hub-chips" role="tablist" aria-label="连接器分类">
            {([["app", "应用"], ["custom_mcp", "自定义 MCP"]] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={"hub-chip" + (tab === id ? " on" : "")}
                data-connector-tab={id}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {notice && <p className="admin-receipt status-ok" role="status" data-connector-notice>{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      {!visible.length && !missingBuiltins.length ? (
        <p className="muted connector-empty" data-connector-empty>
          {browsing ? "该分类下还没有连接器。用「创建」加入第一个。" : needle ? "没有匹配的连接器。" : "尚未挂接任何连接器。"}
        </p>
      ) : (
        <div className="connector-grid" data-connector-grid data-admin-connectors-table>
          {visible.map((card) => (
            <ConnectorCard key={card.id} card={card} browse={browsing} onViewTools={() => setToolsCard(card)} />
          ))}
          {missingBuiltins.map((entry) => (
            <CatalogCard
              key={entry.id}
              id={entry.id}
              label={entry.label}
              purpose={entry.purpose}
              busy={adding === entry.id}
              onAdd={() => void addBuiltin(entry.id, entry.label, entry.purpose)}
            />
          ))}
          {browsing && tab === "custom_mcp" && (
            <button type="button" className="connector-card connector-card-new" data-connector-card-new onClick={() => setPanel("mcp")}>
              <span className="connector-mark connector-mark-letter" aria-hidden>+</span>
              <div className="connector-card-body">
                <div className="connector-card-title"><strong>新建自定义 MCP</strong></div>
                <p className="connector-card-purpose">配置服务器名称、传输类型、URL 与请求头。</p>
              </div>
            </button>
          )}
        </div>
      )}

      {panel === "mcp" && <McpConfigPanel onClose={() => setPanel(null)} onDone={finishPanel} />}
      {panel === "url" && <UrlAddPanel onClose={() => setPanel(null)} onDone={finishPanel} />}
      {panel === "json" && <JsonImportPanel onClose={() => setPanel(null)} onDone={finishPanel} />}
      {toolsCard && <ConnectorToolsDrawer card={toolsCard} users={users} onClose={() => setToolsCard(null)} />}
    </section>
  );
}

function ConnectorCard({ card, browse, onViewTools }: { card: ConnectorCardView; browse: boolean; onViewTools: () => void }) {
  const status = governanceStatus(card);
  return (
    <article
      className="connector-card"
      data-connector-card
      data-connector={card.id}
      data-connector-kind={card.kind}
      data-governance-status={status.key}
    >
      <ConnectorMark id={card.id} label={card.label} iconUrl={card.iconUrl} />
      <div className="connector-card-body">
        <div className="connector-card-title">
          <Link to={connectorHref(card.id)} className="connector-card-link"><strong>{card.label}</strong></Link>
          <span className="connector-kind-tag">{kindLabel(card.kind)}</span>
        </div>
        <p className="connector-card-purpose">{card.purpose || "未填写业务用途"}</p>
        <p className="connector-card-meta">
          {card.lastVerifiedAt ? `最近验证 ${card.lastVerifiedAt}` : "尚未测试"}
          {card.approvedToolCount > 0 ? ` · ${card.approvedToolCount} 个已审阅接口` : ""}
        </p>
      </div>
      <div className="connector-card-side">
        <span className={`admin-status is-${status.key}`} title={connectorStatusNote(card)}>{status.label}</span>
        {browse ? (
          <span className="connector-added">
            <svg viewBox="0 0 16 16" aria-hidden><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span className="sr-only">已加入目录</span>
          </span>
        ) : (
          <Link className="btn sm" to={connectorHref(card.id)} data-connector-action="open">{connectorActionLabel(card)}</Link>
        )}
        <button type="button" className="btn ghost sm" data-connector-tools-entry onClick={onViewTools}>查看工具</button>
      </div>
    </article>
  );
}

function CatalogCard({ id, label, purpose, busy, onAdd }: { id: string; label: string; purpose: string; busy: boolean; onAdd: () => void }) {
  return (
    <article className="connector-card" data-connector-card data-connector={id} data-connector-kind="app">
      <ConnectorMark id={id} label={label} />
      <div className="connector-card-body">
        <div className="connector-card-title"><strong>{label}</strong><span className="connector-kind-tag">内置</span></div>
        <p className="connector-card-purpose">{purpose}</p>
        <p className="connector-card-meta">尚未加入组织目录</p>
      </div>
      <div className="connector-card-side">
        <button type="button" className="connector-plus" aria-label={`加入目录：${label}`} disabled={busy} onClick={onAdd}>
          +
        </button>
      </div>
    </article>
  );
}

function CreateMenu({ onPick, onClose }: { onPick: (kind: CreatePanelKind) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (event: MouseEvent) => {
      const wrap = ref.current?.parentElement;
      if (wrap && !wrap.contains(event.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onClose]);
  const move = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") || []);
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
    items[next]?.focus();
  };
  return (
    <div className="connector-menu" role="menu" ref={ref} data-connector-create-menu onKeyDown={move}>
      {CREATE_ITEMS.map((item, index) => (
        <button
          key={item.kind}
          type="button"
          role="menuitem"
          className="connector-menu-item"
          data-connector-create-item={item.kind}
          autoFocus={index === 0}
          onClick={() => onPick(item.kind)}
        >
          <strong>{item.label}</strong>
          <small>{item.hint}</small>
        </button>
      ))}
    </div>
  );
}
