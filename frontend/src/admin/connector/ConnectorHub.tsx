import WorkspaceSearchInput from "../../components/WorkspaceSearchInput";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { governanceStatus, type AdminRow } from "../../adminGovernance";
import { ConnectorMark } from "./ConnectorMark";
import { ApiConfigPanel, JsonImportPanel, ModalShell, UrlAddPanel } from "./ConnectorPanels";
import { ConnectorSetupWizard, McpConfigPanel } from "./ConnectorSetupWizard";
import { ConnectorToolsDrawer } from "./ConnectorToolsDrawer";
import {
  connectorCardView,
  connectorHref,
  connectorStatusNote,
  type ConnectorCardView,
} from "./entity";
import "./connectorAdmin.css";

export type ConnectorSaveFn = (path: string, body: AdminRow, message: string, method?: string) => Promise<void>;

type CreatePanelKind = "mcp" | "api" | "url" | "json";

const CREATE_ITEMS: Array<{ kind: CreatePanelKind; label: string; hint: string }> = [
  { kind: "mcp", label: "自定义 MCP", hint: "填写服务器名称、传输类型、URL 与请求头" },
  { kind: "api", label: "自定义 HTTP API", hint: "填写名称与密钥；Base URL 与动作在详情配置" },
  { kind: "json", label: "通过 JSON 导入 MCP", hint: "粘贴 mcpServers 配置，预览后导入" },
  { kind: "url", label: "通过 URL 添加 MCP", hint: "只填名称与服务器 URL，快速加入目录" },
];

/** Built-in catalog entries. Seeds exist for both; the + path stays honest for future entries. */
const BUILTIN_CATALOG = [
  { id: "claw", label: "MediaCrawler MCP", purpose: "创作者采集、检索与画像数据" },
  { id: "starrykol", label: "Starry KOL MCP", purpose: "红人库、负责人、品牌邮箱与合作往来事实" },
] as const;

type HealthCounts = { total: number; enabled: number; registered: number; pending: number; errors: number };

function connectorHealthCounts(cards: ConnectorCardView[]): HealthCounts {
  const counts: HealthCounts = { total: cards.length, enabled: 0, registered: 0, pending: 0, errors: 0 };
  for (const card of cards) {
    const status = governanceStatus(card);
    if (card.enabled) counts.enabled += 1;
    if (card.credentialRegistered) counts.registered += 1;
    if (status.key === "draft" || status.key === "pending" || status.key === "verified") counts.pending += 1;
    if (status.key === "error") counts.errors += 1;
  }
  return counts;
}

export function ConnectorHub({ connectors, loading, onSave, reload }: {
  connectors: AdminRow[];
  loading: boolean;
  onSave: ConnectorSaveFn;
  reload: () => void;
}) {
  const cards = useMemo(() => connectors.map(connectorCardView), [connectors]);
  const [q, setQ] = useState("");
  const [browseOpen, setBrowseOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [panel, setPanel] = useState<CreatePanelKind | null>(null);
  const [toolsCard, setToolsCard] = useState<ConnectorCardView | null>(null);
  const [configCard, setConfigCard] = useState<ConnectorCardView | null>(null);
  const [notice, setNotice] = useState("");
  const [noticeTone, setNoticeTone] = useState<"ok" | "warn">("ok");
  const [error, setError] = useState("");
  const [adding, setAdding] = useState("");

  const needle = q.trim().toLowerCase();
  const visible = cards.filter((card) => !needle || `${card.label} ${card.purpose} ${card.id}`.toLowerCase().includes(needle));
  const counts = useMemo(() => connectorHealthCounts(cards), [cards]);

  const finishPanel = (message: string, tone: "ok" | "warn" = "ok") => {
    setPanel(null);
    setError("");
    setNotice(message);
    setNoticeTone(tone);
    reload();
  };

  /** The setup wizard is used both by the create panel and by the hub's config modal. */
  const finishConfig = (message: string, tone: "ok" | "warn" = "ok") => {
    setConfigCard(null);
    setError("");
    setNotice(message);
    setNoticeTone(tone);
    reload();
  };

  const addBuiltin = async (entry: { id: string; label: string; purpose: string }) => {
    setAdding(entry.id);
    setError("");
    try {
      await onSave("/api/admin/connectors", { id: entry.id, label: entry.label, purpose: entry.purpose }, `已将“${entry.label}”加入连接器目录`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加入目录失败");
    } finally {
      setAdding("");
    }
  };

  return (
    <section className="connector-hub" data-connector-hub data-admin-page="connectors">
      <header className="connector-hub-head">
        <h2 data-connector-hub-title>已添加的连接器</h2>
        <div className="admin-health connector-hub-health" data-admin-health aria-label="连接器治理状态">
          {loading ? (
            <span>正在读取受管连接器目录与治理状态…</span>
          ) : (
            <>
              <span>受管连接器 <b>{counts.total}</b></span>
              <span>已启用 <b>{counts.enabled}</b></span>
              <span>凭据已登记 <b>{counts.registered}</b></span>
              <span>待处理 <b>{counts.pending}</b></span>
              {counts.errors > 0 && <span data-health="error">异常 <b>{counts.errors}</b></span>}
            </>
          )}
        </div>
      </header>

      <div className="connector-hub-tools">
        <WorkspaceSearchInput
            className="connector-search connector-search-input"
            data-connector-search
            placeholder="搜索连接器"
            aria-label="搜索连接器"
            value={q}
            onChange={(event) => setQ(event.target.value)}
          />
        <div className="connector-hub-actions">
          <button type="button" className="btn" data-connector-browse-toggle onClick={() => setBrowseOpen(true)}>
            浏览连接器
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
              创建
              <svg viewBox="0 0 16 16" aria-hidden><path d="M4 6.5l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
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
      </div>

      {notice && (
        <p
          className={"admin-receipt " + (noticeTone === "warn" ? "connector-receipt-warn" : "status-ok")}
          role="status"
          data-connector-notice
          data-connector-notice-tone={noticeTone}
        >
          {notice}
        </p>
      )}
      {error && <p className="error" role="alert">{error}</p>}

      {!visible.length ? (
        <p className="muted connector-empty" data-connector-empty>
          {needle ? "没有匹配的连接器。" : "尚未挂接任何连接器。"}
        </p>
      ) : (
        <div className="connector-grid" data-connector-grid data-admin-connectors-table>
          {visible.map((card) => (
            <ConnectorCard
              key={card.id}
              card={card}
              onOpen={() => setConfigCard(card)}
              onViewTools={() => setToolsCard(card)}
              onOpenConfig={() => setConfigCard(card)}
            />
          ))}
        </div>
      )}

      {panel === "mcp" && <McpConfigPanel onClose={() => setPanel(null)} onDone={finishPanel} reload={reload} />}
      {panel === "api" && <ApiConfigPanel onClose={() => setPanel(null)} onDone={finishPanel} />}
      {panel === "url" && <UrlAddPanel onClose={() => setPanel(null)} onDone={finishPanel} />}
      {panel === "json" && <JsonImportPanel onClose={() => setPanel(null)} onDone={finishPanel} />}
      {browseOpen && (
        <ConnectorBrowseModal
          cards={cards}
          loading={loading}
          adding={adding}
          onAddBuiltin={(entry) => void addBuiltin(entry)}
          onCreate={(kind) => {
            setBrowseOpen(false);
            setPanel(kind);
          }}
          onClose={() => setBrowseOpen(false)}
        />
      )}
      {configCard && (
        <ConnectorSetupWizard
          mode="configure"
          card={configCard}
          onClose={() => setConfigCard(null)}
          onDone={finishConfig}
          reload={reload}
          headerExtra={
            <Link
              className="connector-panel-detail-link"
              to={connectorHref(configCard.id)}
              onClick={() => setConfigCard(null)}
            >
              详情
            </Link>
          }
        />
      )}
      {toolsCard && <ConnectorToolsDrawer card={toolsCard} onClose={() => setToolsCard(null)} />}
    </section>
  );
}

/** 目录弹窗：搜索、分类与单列条目；已加入 ✓，未加入的内置项 ＋。 */
function ConnectorBrowseModal({ cards, loading, adding, onAddBuiltin, onCreate, onClose }: {
  cards: ConnectorCardView[];
  loading: boolean;
  adding: string;
  onAddBuiltin: (entry: { id: string; label: string; purpose: string }) => void;
  onCreate: (kind: CreatePanelKind) => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"app" | "custom_mcp" | "custom_api">("app");
  const [menuOpen, setMenuOpen] = useState(false);
  const needle = q.trim().toLowerCase();
  const matched = cards.filter((card) => !needle || `${card.label} ${card.purpose} ${card.id}`.toLowerCase().includes(needle));
  const visible = matched.filter((card) => card.kind === tab);
  const missingBuiltins = tab === "app"
    ? BUILTIN_CATALOG.filter((entry) => !cards.some((card) => card.id === entry.id))
    : [];

  return (
    <ModalShell kind="browse" title="连接器" onClose={onClose}>
      <div className="connector-browse" data-connector-browse-modal>
        <WorkspaceSearchInput
            className="connector-search connector-search-input"
            data-connector-browse-search
            placeholder="搜索连接器"
            aria-label="搜索连接器"
            value={q}
            onChange={(event) => setQ(event.target.value)}
          />
        <div className="connector-browse-toolbar" data-connector-browse-toolbar>
          <div className="hub-chips connector-hub-tabs" role="tablist" aria-label="连接器分类">
            {([ ["app", "应用"], ["custom_api", "自定义 API"], ["custom_mcp", "自定义 MCP"]] as const).map(([id, label]) => (
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
          <div className="connector-menu-wrap">
            <button
              type="button"
              className="btn"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              data-connector-browse-create
              onClick={() => setMenuOpen((value) => !value)}
            >
              创建
              <svg viewBox="0 0 16 16" aria-hidden><path d="M4 6.5l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            {menuOpen && (
              <CreateMenu
                onPick={(kind) => {
                  setMenuOpen(false);
                  onCreate(kind);
                }}
                onClose={() => setMenuOpen(false)}
              />
            )}
          </div>
        </div>
        {loading ? (
          <p className="muted" data-connector-browse-loading>正在读取连接器目录…</p>
        ) : !visible.length && !missingBuiltins.length && tab === "app" ? (
          <p className="muted">该分类下还没有连接器。用「创建」加入第一个。</p>
        ) : (
          <div className="connector-grid" data-connector-browse-grid>
            {visible.map((card) => (
              <ConnectorCard
                key={card.id}
                card={card}
                plain
                onOpen={() => {
                  onClose();
                  navigate(connectorHref(card.id));
                }}
              />
            ))}
            {missingBuiltins.map((entry) => (
              <CatalogCard
                key={entry.id}
                id={entry.id}
                label={entry.label}
                purpose={entry.purpose}
                busy={adding === entry.id}
                onAdd={() => onAddBuiltin(entry)}
              />
            ))}
            {tab === "custom_mcp" && (
              <button type="button" className="connector-card connector-card-new" data-connector-card-new onClick={() => onCreate("mcp")}>
                <span className="connector-mark connector-mark-letter" aria-hidden>+</span>
                <div className="connector-card-body">
                  <div className="connector-card-title"><strong>新建自定义 MCP</strong></div>
                  <p className="connector-card-purpose">配置服务器名称、传输类型、URL 与请求头。</p>
                </div>
              </button>
            )}
            {tab === "custom_api" && (
              <button type="button" className="connector-card connector-card-new" data-connector-card-new onClick={() => onCreate("api")}>
                <span className="connector-mark connector-mark-letter" aria-hidden>+</span>
                <div className="connector-card-body">
                  <div className="connector-card-title"><strong>新建自定义 HTTP API</strong></div>
                  <p className="connector-card-purpose">填写名称与密钥；Base URL 与动作在详情配置。</p>
                </div>
              </button>
            )}
          </div>
        )}
      </div>
    </ModalShell>
  );
}

function ConnectorCard({ card, onOpen, onViewTools, onOpenConfig, plain = false }: {
  card: ConnectorCardView;
  onOpen?: () => void;
  onViewTools?: () => void;
  onOpenConfig?: () => void;
  /** 浏览弹窗版式：只保留图标 / 名称 / 用途与右侧指示；治理状态行留在枢纽卡片（org-permissions）。 */
  plain?: boolean;
}) {
  const status = governanceStatus(card);
  const navigate = useNavigate();
  const href = connectorHref(card.id);
  const open = onOpen ?? (() => navigate(href));
  return (
    <article
      className="connector-card connector-card-linkable"
      data-connector-card
      data-connector={card.id}
      data-connector-kind={card.kind}
      data-governance-status={status.key}
      onClick={open}
    >
      <ConnectorMark id={card.id} label={card.label} iconUrl={card.iconUrl} />
      <div className="connector-card-body">
        <div className="connector-card-title">
          <Link
            to={href}
            className="connector-card-link"
            onClick={(event) => { event.preventDefault(); event.stopPropagation(); open(); }}
          >
            <strong>{card.label}</strong>
          </Link>
        </div>
        <p className="connector-card-purpose">{card.purpose || "未填写业务用途"}</p>
        {!plain && (
          <p className="connector-card-meta">
            {onOpenConfig ? (
              <button
                type="button"
                className="connector-card-status"
                data-connector-status-entry
                title={connectorStatusNote(card)}
                onClick={(event) => { event.stopPropagation(); onOpenConfig(); }}
              >
                {status.label}
              </button>
            ) : (
              <span className="connector-card-status" title={connectorStatusNote(card)}>{status.label}</span>
            )}
            <span className="connector-card-dot" aria-hidden>·</span>
            <span>{card.lastVerifiedAt ? `最近验证 ${card.lastVerifiedAt}` : "尚未测试"}</span>
            {card.approvedToolCount > 0 && (
              <>
                <span className="connector-card-dot" aria-hidden>·</span>
                <span>{card.approvedToolCount} 个已审阅接口</span>
              </>
            )}
            {onViewTools && (
              <>
                <span className="connector-card-dot" aria-hidden>·</span>
                <button
                  type="button"
                  className="connector-card-toolslink"
                  data-connector-tools-entry
                  onClick={(event) => { event.stopPropagation(); onViewTools(); }}
                >
                  查看工具
                </button>
              </>
            )}
          </p>
        )}
      </div>
      <div className="connector-card-side">
        <span className="connector-added">
          <svg viewBox="0 0 16 16" aria-hidden><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span className="sr-only">已加入目录</span>
        </span>
      </div>
    </article>
  );
}

function CatalogCard({ id, label, purpose, busy, onAdd }: { id: string; label: string; purpose: string; busy: boolean; onAdd: () => void }) {
  return (
    <article className="connector-card" data-connector-card data-connector={id} data-connector-kind="app">
      <ConnectorMark id={id} label={label} />
      <div className="connector-card-body">
        <div className="connector-card-title"><strong>{label}</strong></div>
        <p className="connector-card-purpose">{purpose}</p>
      </div>
      <div className="connector-card-side">
        <button type="button" className="connector-plus" aria-label={`加入目录：${label}`} disabled={busy} onClick={onAdd}>
          <svg viewBox="0 0 14 14" aria-hidden><path d="M7 2v10M2 7h10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
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
