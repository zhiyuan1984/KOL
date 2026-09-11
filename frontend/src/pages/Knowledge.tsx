import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type KnowledgeRow } from "../api";
import {
  HIDE_REASONS,
  brandLabel,
  composerStarter,
  hideReasonLabel,
  kindLabel,
  skillLabel,
  stashComposerFill,
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

function PreviewModal({ row, onClose }: { row: KnowledgeRow; onClose: () => void }) {
  return (
    <div className="kb-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="kb-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="kb-preview-title"
        data-kb-preview={row.id}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="kb-modal-head">
          <div>
            <div className="page-kicker">预览 · 只看不改</div>
            <h2 id="kb-preview-title">{row.title}</h2>
          </div>
          <button className="btn" type="button" onClick={onClose}>关闭</button>
        </div>
        <p className="kb-result">打开预览不会启用、不会隐藏、不会发信。</p>
        <div className="kb-preview-meta">
          <span className="chip">{kindLabel(row.kind)}</span>
          <span className="chip">{brandLabel(row.brand)}</span>
          {row.current_version ? <span className="chip">第 {row.current_version} 版</span> : null}
        </div>
        {row.subject && (
          <p className="kb-preview-subject"><span>主题</span> {row.subject}</p>
        )}
        <pre className="kb-preview-body">{row.body_en || row.body}</pre>
      </div>
    </div>
  );
}

export default function Knowledge({ market = false }: { market?: boolean }) {
  const [rows, setRows] = useState<KnowledgeRow[]>([]);
  const [preview, setPreview] = useState<KnowledgeRow | null>(null);
  const [hideFor, setHideFor] = useState("");
  const [err, setErr] = useState("");
  const [tipId, setTipId] = useState("");
  const nav = useNavigate();
  const closeTip = useCallback(() => setTipId(""), []);

  const load = () => {
    (market ? api.kbMarket() : api.knowledge())
      .then(setRows)
      .catch((e) => setErr(e instanceof Error ? e.message : "无法加载知识库"));
  };

  useEffect(load, [market]);

  const useTemplate = (row: KnowledgeRow) => {
    if (row.kind !== "mail_template") return;
    const go = () => {
      stashComposerFill(row);
      nav(`/?knowledge_id=${encodeURIComponent(row.id)}`);
    };
    if (row.cited) {
      go();
      return;
    }
    void api.citeKnowledge(row.id).then(() => go()).catch((e) => setErr(e instanceof Error ? e.message : "无法启用模板"));
  };

  const grouped = useMemo(() => {
    const mail = rows.filter((row) => row.kind === "mail_template");
    const other = rows.filter((row) => row.kind !== "mail_template");
    return [
      { key: "mail", title: "邮件模板", hint: "启用后，写合作邮件时 Codex 用这份英文底稿。点「用这份写信」会锁到这一封。", rows: mail },
      { key: "other", title: "口径与其它", hint: "给对话当规矩用，不会直接变成一封信。", rows: other },
      { key: "other", title: "口径与其它", hint: "给对话当规矩用，不会直接变成一封信。", rows: other },
    ].filter((group) => group.rows.length);
  }, [rows]);

  return (
    <div className="list-page kb-page" data-kb-page={market ? "market" : "mine"}>
      <header className="kb-hero">
        <div className="page-kicker">{market ? "市场 · 只读" : "资产 · 不发送"}</div>
        <h1>{market ? "知识市场" : "我的知识库"}</h1>
        <nav className="kb-tabs" aria-label="知识库视图">
          <Link to="/kb" className={market ? "" : "active"}>我的知识库</Link>
          <Link to="/market/kb" className={market ? "active" : ""}>知识市场</Link>
        </nav>
        <p className="kb-lead">
          {market
            ? "只读已发布知识。添加到我的库后，写邮件才会用这份模板。"
            : "启用到本账号后，写合作邮件走 Codex harness。发送不等于推进阶段。"}
        </p>
      </header>
      {err && <p className="error">{err}</p>}
      {grouped.map((group) => (
        <section className="kb-group" key={group.key}>
          <div className="kb-group-head">
            <h2>{group.title}</h2>
            <p>{group.hint}</p>
          </div>
          {group.rows.map((k) => (
            <article
              className={"panel kb-card" + (k.cited ? " is-cited" : "") + (k.deprecated ? " is-hidden" : "")}
              key={k.id}
              data-knowledge={k.id}
              data-kind={k.kind}
              data-cited={k.cited ? "true" : "false"}
            >
              <div className="kb-card-head">
                <div>
                  <h3>{k.title}</h3>
                  <p className="kb-card-meta">
                    <span className="chip">{kindLabel(k.kind)}</span>
                    <span className="chip">{brandLabel(k.brand)}</span>
                    <span className="chip">{skillLabel(k.skill_id)}</span>
                    {k.current_version ? <span className="chip">第 {k.current_version} 版</span> : null}
                    <span className={"chip" + (k.cited ? " chip-ok" : "")}>{k.cited ? "已启用" : "未启用"}</span>
                    {k.deprecated && (
                      <span className="chip chip-warn">已对本账号隐藏 · {hideReasonLabel(k.deprecate_reason) || k.deprecate_reason_label}</span>
                    )}
                  </p>
                </div>
              </div>
              <p className="muted kb-card-body">{k.body}</p>
              {k.kind === "mail_template" && (
                <p className="kb-starter">启用后这一封：<code>{composerStarter(k)}</code></p>
              )}
              <div className="kb-actions">
                {market ? (
                  <Hinted
                    id={`${k.id}-add`}
                    open={tipId === `${k.id}-add`}
                    onOpen={setTipId}
                    onClose={closeTip}
                    hint={k.cited ? "已在我的库启用。写合作邮件时 Codex 会用这份底稿。" : "添加到我的库后，写合作邮件才会把这份模板带进 Codex 箱子。"}
                  >
                    <button
                      className={k.cited ? "btn is-on" : "btn work"}
                      type="button"
                      data-cite={k.id}
                      aria-pressed={Boolean(k.cited)}
                      onClick={() => void (k.cited ? api.unciteKnowledge(k.id) : api.citeKnowledge(k.id)).then(() => load())}
                    >
                      {k.cited ? "已添加到我的库" : "添加到我的库"}
                    </button>
                  </Hinted>
                ) : (
                  <>
                    <Hinted
                      id={`${k.id}-cite`}
                      open={tipId === `${k.id}-cite`}
                      onOpen={setTipId}
                      onClose={closeTip}
                      hint={k.cited ? "已对本账号启用。写合作邮件时 Codex 可用这份底稿。撤回后不再带进箱子。" : "启用后写入本账号。下次写合作邮件会按这份已发布模板出草稿。"}
                    >
                      <button
                        className={k.cited ? "btn is-on" : "btn work"}
                        type="button"
                        data-cite={k.id}
                        aria-pressed={Boolean(k.cited)}
                        onClick={() => void (k.cited ? api.unciteKnowledge(k.id) : api.citeKnowledge(k.id)).then(() => { setHideFor(""); load(); })}
                      >
                        {k.cited ? "从本账号停用" : "启用到本账号"}
                      </button>
                    </Hinted>
                    {k.deprecated ? (
                      <Hinted
                        id={`${k.id}-undep`}
                        open={tipId === `${k.id}-undep`}
                        onOpen={setTipId}
                        onClose={closeTip}
                        hint="取消后，这份知识会重新出现在你的首页选择器。已发信不受影响。"
                      >
                        <button className="btn work" type="button" onClick={() => void api.undeprecateKnowledge(k.id).then(() => { setHideFor(""); load(); })}>
                          取消隐藏
                        </button>
                      </Hinted>
                    ) : (
                      <Hinted
                        id={`${k.id}-hide`}
                        open={tipId === `${k.id}-hide`}
                        onOpen={setTipId}
                        onClose={closeTip}
                        hint="只有你看不到；已发信和别人的首页都不变。"
                      >
                        <button
                          className={"btn" + (hideFor === k.id ? " is-on" : "")}
                          type="button"
                          aria-expanded={hideFor === k.id}
                          aria-pressed={hideFor === k.id}
                          onClick={() => setHideFor((cur) => (cur === k.id ? "" : k.id))}
                        >
                          对本账号隐藏
                        </button>
                      </Hinted>
                    )}
                  </>
                )}
                <Hinted
                  id={`${k.id}-preview`}
                  open={tipId === `${k.id}-preview`}
                  onOpen={setTipId}
                  onClose={closeTip}
                  hint="打开预览不会启用、不会隐藏、不会发信。"
                >
                  <button
                    className={"btn" + (preview?.id === k.id ? " is-on" : "")}
                    type="button"
                    aria-pressed={preview?.id === k.id}
                    onClick={() => setPreview(k)}
                  >
                    预览正文
                  </button>
                </Hinted>
                {k.kind === "mail_template" && !market && (
                  <Hinted
                    id={`${k.id}-fill`}
                    open={tipId === `${k.id}-fill`}
                    onOpen={setTipId}
                    onClose={closeTip}
                    hint={`锁到这一封并打开首页，例如「${composerStarter(k)}」。Codex 用已启用模板出草稿，不会直接发送。`}
                  >
                    <button className="btn work" type="button" data-fill-composer={k.id} onClick={() => useTemplate(k)}>
                      用这份写信
                    </button>
                  </Hinted>
                )}
              </div>
              {!market && hideFor === k.id && !k.deprecated && (
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
            </article>
          ))}
        </section>
      ))}
      {!rows.length && <p className="muted">暂无已发布知识。</p>}
      {preview && <PreviewModal row={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
