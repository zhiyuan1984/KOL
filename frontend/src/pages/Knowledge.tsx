import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, type KnowledgeRow } from "../api";
import {
  HIDE_REASONS,
  KB_LEAD,
  KB_MARKET_LEAD,
  KB_TAB_LABEL,
  hideReasonLabel,
  kbIsMail,
  kbKicker,
  kbMatchesTab,
  kbProvenanceLine,
  kbScopeLine,
  kbStatusLabel,
  kbSummary,
  kbVariableLine,
  kbVisibleTabs,
  readKbFavorites,
  readKbRecent,
  rememberKbRecent,
  stashComposerFill,
  toggleKbFavorite,
  type KbBrowseTab,
} from "../knowledgeCopy";

function Hinted({
  id,
  hint,
  open,
  onOpen,
  onClose,
  children,
}: {
  id: string;
  hint: string;
  open: boolean;
  onOpen: (id: string) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(onClose, 3000);
    return () => clearTimeout(timer.current);
  }, [open, onClose]);

  return (
    <span className={"kb-action" + (open ? " has-tip" : "")} onMouseEnter={() => onOpen(id)}>
      {children}
      {open && (
        <span className="kb-tip" role="tooltip" data-kb-tip={id}>
          <span>{hint}</span>
          <button
            type="button"
            className="kb-tip-x"
            aria-label="关闭说明"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onClose();
            }}
          >
            ×
          </button>
        </span>
      )}
    </span>
  );
}

function parseBrowseTab(raw: string | null): KbBrowseTab {
  if (raw === "mail" || raw === "brand" || raw === "sop" || raw === "quote" || raw === "recent") return raw;
  return "all";
}

function ContentDrawer({
  row,
  market,
  onClose,
  onUse,
}: {
  row: KnowledgeRow;
  market: boolean;
  onClose: () => void;
  onUse: (row: KnowledgeRow) => void;
}) {
  const status = kbStatusLabel(row);
  const vars = kbVariableLine(row);
  return (
    <aside
      className="kb-drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="kb-preview-title"
      data-kb-preview={row.id}
      data-kb-drawer
    >
      <header className="kb-drawer-head">
        <div>
          <div className="page-kicker">{kbIsMail(row) ? "知识库 · 邮件模板" : "知识库"}</div>
          <h2 id="kb-preview-title">{row.title}</h2>
          <p className="kb-drawer-status">
            <span className={"chip" + (row.deprecated ? " chip-warn" : "")}>{status}</span>
          </p>
        </div>
        <button className="btn" type="button" onClick={onClose}>关闭</button>
      </header>
      <div className="kb-drawer-body">
        <p className="kb-result">打开全文，不会把资料发出去。</p>
        {kbScopeLine(row) ? <p className="kb-card-scope">{kbScopeLine(row)}</p> : null}
        {vars ? <p className="kb-card-vars">{vars}</p> : null}
        <p className="kb-card-source">{kbProvenanceLine(row)}</p>
        {row.subject && (
          <p className="kb-preview-subject"><span>主题</span> {row.subject}</p>
        )}
        <pre className="kb-preview-body" data-kb-preview-body>{row.body_en || row.body}</pre>
      </div>
      {kbIsMail(row) && !market && (
        <footer className="kb-drawer-foot">
          <button className="btn work" type="button" data-kb-use={row.id} onClick={() => onUse(row)}>
            用于当前任务
          </button>
        </footer>
      )}
    </aside>
  );
}

export default function Knowledge({ market = false }: { market?: boolean }) {
  const [rows, setRows] = useState<KnowledgeRow[]>([]);
  const [preview, setPreview] = useState<KnowledgeRow | null>(null);
  const [hideFor, setHideFor] = useState("");
  const [err, setErr] = useState("");
  const [tipId, setTipId] = useState("");
  const [favorites, setFavorites] = useState<string[]>(() => readKbFavorites());
  const [recent, setRecent] = useState<{ id: string; at: number }[]>(() => readKbRecent());
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const closeTip = useCallback(() => setTipId(""), []);
  const tab = parseBrowseTab(params.get("cat"));
  const recentIds = useMemo(() => recent.map((item) => item.id), [recent]);

  const load = () => {
    (market ? api.kbMarket() : api.knowledge())
      .then(setRows)
      .catch((e) => setErr(e instanceof Error ? e.message : "无法加载知识库"));
  };

  useEffect(load, [market]);

  useEffect(() => {
    if (!preview) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreview(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview]);

  const tabs = useMemo(() => kbVisibleTabs(rows, recentIds), [rows, recentIds]);

  useEffect(() => {
    if (!rows.length || tabs.includes(tab)) return;
    const next = new URLSearchParams(params);
    next.delete("cat");
    setParams(next, { replace: true });
  }, [params, setParams, rows.length, tab, tabs]);

  const setTab = (nextTab: KbBrowseTab) => {
    const next = new URLSearchParams(params);
    if (nextTab === "all") next.delete("cat");
    else next.set("cat", nextTab);
    setParams(next, { replace: true });
  };

  const openPreview = (row: KnowledgeRow) => {
    setPreview(row);
    setRecent(rememberKbRecent(row.id));
  };

  const useForTask = (row: KnowledgeRow) => {
    if (!kbIsMail(row)) return;
    const go = () => {
      setRecent(rememberKbRecent(row.id));
      stashComposerFill(row);
      nav(`/?knowledge_id=${encodeURIComponent(row.id)}`);
    };
    if (row.cited) {
      go();
      return;
    }
    void api.citeKnowledge(row.id).then(() => go()).catch((e) => setErr(e instanceof Error ? e.message : "无法选用这份资料"));
  };

  const visible = useMemo(() => {
    const filtered = rows.filter((row) => kbMatchesTab(row, tab, recentIds));
    if (tab !== "recent") return filtered;
    const rank = new Map(recentIds.map((id, index) => [id, index]));
    return [...filtered].sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99));
  }, [recentIds, rows, tab]);

  return (
    <div className={"list-page kb-page" + (preview ? " has-drawer" : "")} data-kb-page={market ? "market" : "mine"}>
      <header className="kb-hero">
        <div className="page-kicker">{kbKicker(tab)}</div>
        <h1>知识库</h1>
        <nav className="kb-tabs" aria-label="资料分类">
          {tabs.map((item) => (
            <button
              key={item}
              type="button"
              className={tab === item ? "active" : ""}
              aria-selected={tab === item}
              data-kb-tab={item}
              onClick={() => setTab(item)}
            >
              {KB_TAB_LABEL[item]}
            </button>
          ))}
        </nav>
        <p className="kb-lead">{market ? KB_MARKET_LEAD : KB_LEAD}</p>
      </header>
      {err && <p className="error">{err}</p>}
      {visible.map((k) => {
        const status = kbStatusLabel(k);
        const vars = kbVariableLine(k);
        const favorited = favorites.includes(k.id);
        return (
          <article
            className={"panel kb-card" + (k.cited ? " is-cited" : "") + (k.deprecated ? " is-hidden" : "")}
            key={k.id}
            data-knowledge={k.id}
            data-kind={k.kind}
            data-cited={k.cited ? "true" : "false"}
          >
            <div className="kb-card-title-row">
              <h3>{k.title}</h3>
              <span className={"chip kb-status" + (k.deprecated ? " chip-warn" : "")}>
                {status}
              </span>
            </div>
            {kbScopeLine(k) ? <p className="kb-card-scope">{kbScopeLine(k)}</p> : null}
            <p className="kb-card-summary" data-kb-summary>{kbSummary(k)}</p>
            {vars ? <p className="kb-card-vars">{vars}</p> : null}
            <p className="kb-card-source">{kbProvenanceLine(k)}</p>
            {k.deprecated && (
              <p className="kb-card-hidden">已隐藏 · {hideReasonLabel(k.deprecate_reason) || k.deprecate_reason_label}</p>
            )}
            <div className="kb-actions">
              {kbIsMail(k) && (
                <Hinted
                  id={`${k.id}-fill`}
                  open={tipId === `${k.id}-fill`}
                  onOpen={setTipId}
                  onClose={closeTip}
                  hint="锁定这份资料并打开首页草稿。英文正文会填进输入框，可改后再发，不会直接发送。"
                >
                  <button className="btn work" type="button" data-fill-composer={k.id} onClick={() => useForTask(k)}>
                    用于当前任务
                  </button>
                </Hinted>
              )}
              <Hinted
                id={`${k.id}-preview`}
                open={tipId === `${k.id}-preview`}
                onOpen={setTipId}
                onClose={closeTip}
                  hint="打开全文。不会把资料发出去。"
              >
                <button
                  className={"btn" + (preview?.id === k.id ? " is-on" : "")}
                  type="button"
                  data-kb-open={k.id}
                  aria-pressed={preview?.id === k.id}
                  onClick={() => openPreview(k)}
                >
                  查看
                </button>
              </Hinted>
              <Hinted
                id={`${k.id}-fav`}
                open={tipId === `${k.id}-fav`}
                onOpen={setTipId}
                onClose={closeTip}
                hint="先记在这台设备上，方便下次找。不会同步到其他设备。"
              >
                <button
                  className={"btn" + (favorited ? " is-on" : "")}
                  type="button"
                  data-kb-favorite={k.id}
                  aria-pressed={favorited}
                  onClick={() => setFavorites(toggleKbFavorite(k.id))}
                >
                  {favorited ? "已收藏" : "收藏"}
                </button>
              </Hinted>
            </div>
            {!market && (
              <details className="kb-more" data-kb-more={k.id}>
                <summary>更多</summary>
                <div className="kb-more-actions">
                  {k.deprecated ? (
                    <button className="btn" type="button" onClick={() => void api.undeprecateKnowledge(k.id).then(() => { setHideFor(""); load(); })}>
                      取消隐藏
                    </button>
                  ) : (
                    <button
                      className={"btn" + (hideFor === k.id ? " is-on" : "")}
                      type="button"
                      aria-expanded={hideFor === k.id}
                      aria-pressed={hideFor === k.id}
                      onClick={() => setHideFor((cur) => (cur === k.id ? "" : k.id))}
                    >
                      对本账号隐藏
                    </button>
                  )}
                </div>
                {hideFor === k.id && !k.deprecated && (
                  <div className="kb-hide-panel">
                    <p className="kb-hide-title">选择隐藏原因 · 只影响你这个账号</p>
                    {HIDE_REASONS.map((reason) => (
                      <button
                        key={reason.code}
                        className="kb-hide-option"
                        type="button"
                        data-deprecate-reason={reason.code}
                        onClick={() => void api.deprecateKnowledge(k.id, reason.code).then(() => { setHideFor(""); load(); })}
                      >
                        <strong>{reason.label}</strong>
                        <span>{reason.result}</span>
                      </button>
                    ))}
                  </div>
                )}
              </details>
            )}
          </article>
        );
      })}
      {!rows.length && <p className="muted">暂无已发布资料。</p>}
      {rows.length > 0 && !visible.length && (
        <p className="muted" data-kb-empty>
          {tab === "recent" ? "还没有最近使用的资料。查看或用于当前任务后会出现在这里。" : "这一类暂时没有资料。"}
        </p>
      )}
      {preview && (
        <ContentDrawer
          row={preview}
          market={market}
          onClose={() => setPreview(null)}
          onUse={useForTask}
        />
      )}
    </div>
  );
}
