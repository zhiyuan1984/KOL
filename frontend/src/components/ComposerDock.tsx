import { useEffect, useRef, useState, type ReactNode } from "react";
import type { KnowledgeRow } from "../api";
import {
  composerFillText,
  composerHoldsTemplateBody,
  pickDefaultMailTemplate,
  skillLabel,
  templateBodyExcerpt,
  type LockedMailTemplate,
} from "../knowledgeCopy";
import { useViewMode } from "../viewMode";

const PLACEHOLDER = "输入 / 使用技能";
const WORKSPACE_PLACEHOLDERS = [
  "让 Agent 分析/安排",
  "让 Agent 分析/安排今天的跟进",
  "让 Agent 分析/安排本周异常",
];

export type ComposerVariant = "compact" | "workspace";

export type AttachmentRef = { id?: string; name: string; path: string; size?: number; type?: string };
type ProjectOption = { id: string; label: string; handle?: string; description?: string };

export type ComposerSubmit = {
  text: string;
  intent?: string;
  collaboration_id?: string;
  knowledge_id?: string;
  attachments?: AttachmentRef[];
  model_tier?: string;
  entities?: Record<string, unknown>;
};

export type ComposerSuggestion = {
  label?: string;
  prompt?: string;
  intent?: string;
};

export type SkillOption = {
  id: string;
  title: string;
  label?: string;
  aliases?: string[];
  in_market?: boolean;
  granted?: boolean;
};

function labelOf(s: SkillOption): string {
  return s.label || s.title;
}

function isQuietSkill(s: SkillOption): boolean {
  return /approval|审批/.test(`${s.id} ${labelOf(s)}`);
}

function triggerQuery(value: string, caret: number): { start: number; q: string; mark: "/" | "@" } | null {
  const before = value.slice(0, caret);
  for (let i = before.length - 1; i >= 0; i--) {
    const ch = before[i];
    if (ch !== "/" && ch !== "@") continue;
    if (i > 0 && !/\s/.test(before[i - 1])) continue;
    const q = before.slice(i + 1);
    if (q.endsWith(" ") && q.trim()) return null;
    return { start: i, q, mark: ch };
  }
  return null;
}

export default function ComposerDock({
  value,
  onChange,
  onSubmit,
  disabled,
  variant = "compact",
  onFocusChange,
  lockedIntent,
  lockedLabel,
  lockedKnowledgeId,
  lockedTemplate,
  stageCode,
  onKnowledgeChange,
  autoFocus,
  selectFirstPlaceholder,
  autoFocusToken,
  suggestions,
  onPickSuggestion,
  onPickSkill,
  running,
  queue,
  onStop,
  onRemoveQueued,
  hint,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (payload: ComposerSubmit) => void;
  disabled?: boolean;
  variant?: ComposerVariant;
  onFocusChange?: (focused: boolean) => void;
  lockedIntent?: string | null;
  lockedLabel?: string | null;
  lockedKnowledgeId?: string | null;
  lockedTemplate?: LockedMailTemplate | null;
  stageCode?: string | null;
  onKnowledgeChange?: (row: KnowledgeRow | null) => void;
  autoFocus?: boolean;
  selectFirstPlaceholder?: boolean;
  autoFocusToken?: number;
  suggestions?: ComposerSuggestion[];
  onPickSuggestion?: (item: ComposerSuggestion) => void;
  onPickSkill?: (skill: SkillOption, ctx: { mention: string; rest: string }) => void;
  running?: boolean;
  queue?: { id: string; text?: string; intent?: string }[];
  onStop?: () => void;
  onRemoveQueued?: (id: string) => void;
  hint?: string;
}) {
  const [skills, setSkills] = useState<SkillOption[]>([]);
  const [templates, setTemplates] = useState<KnowledgeRow[]>([]);
  const [connectors, setConnectors] = useState<{ id: string; label: string }[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [recentFiles, setRecentFiles] = useState<(AttachmentRef & { available?: boolean })[]>([]);
  const [picker, setPicker] = useState(false);
  const [query, setQuery] = useState("");
  const [atStart, setAtStart] = useState(0);
  const [triggerMark, setTriggerMark] = useState<"/" | "@">("/");
  const [attachments, setAttachments] = useState<AttachmentRef[]>([]);
  const [uploading, setUploading] = useState(false);
  const [attachErr, setAttachErr] = useState("");
  const [plusOpen, setPlusOpen] = useState(false);
  const [activeSubmenu, setActiveSubmenu] = useState<"projects" | "recent" | "skills" | "connectors" | null>(null);
  const [selectedProject, setSelectedProject] = useState<ProjectOption | null>(null);
  const [dragging, setDragging] = useState(false);
  const [modelTier, setModelTier] = useState(() => localStorage.getItem("composer:model-tier") || "balanced");
  const [hintIndex, setHintIndex] = useState(0);
  const [focused, setFocused] = useState(false);
  const { debug } = useViewMode();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const onKnowledgeChangeRef = useRef(onKnowledgeChange);
  const lockSourceRef = useRef<"auto" | "explicit" | null>(lockedKnowledgeId ? "explicit" : null);
  onKnowledgeChangeRef.current = onKnowledgeChange;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [mine, market] = await Promise.all([
        fetch("/api/skills").then((r) => r.json() as Promise<SkillOption[]>),
        fetch("/api/skills/market")
          .then((r) => r.json() as Promise<SkillOption[]>)
          .catch(() => [] as SkillOption[]),
      ]);
      if (cancelled) return;
      const map = new Map<string, SkillOption>();
      for (const s of [...(Array.isArray(mine) ? mine : []), ...(Array.isArray(market) ? market : [])]) {
        if (!s?.id) continue;
        if (s.granted === false) continue;
        const prev = map.get(s.id);
        const label = s.label || s.title || prev?.label || prev?.title || s.id;
        map.set(s.id, {
          ...prev,
          ...s,
          label,
          title: label,
          aliases: Array.from(new Set([...(prev?.aliases || []), ...(s.aliases || [])])),
        });
      }
      setSkills([...map.values()]);
    };
    load().catch(() => {
      if (!cancelled) setSkills([]);
    });
    fetch("/api/knowledge/composer")
      .then((r) => r.ok ? r.json() as Promise<KnowledgeRow[]> : [])
      .then((rows) => {
        if (!cancelled && Array.isArray(rows)) setTemplates(rows);
      })
      .catch(() => {
        if (!cancelled) setTemplates([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (lockedKnowledgeId && lockSourceRef.current !== "auto") {
      lockSourceRef.current = "explicit";
    }
    const wantsDefault = lockedLabel === "写合作邮件" || value.includes("写合作邮件");
    if (!wantsDefault || !templates.length) return;
    if (lockedKnowledgeId && lockSourceRef.current === "explicit") return;
    const picked = pickDefaultMailTemplate(templates, stageCode);
    if (!picked) {
      if (lockSourceRef.current === "auto" && lockedKnowledgeId) {
        lockSourceRef.current = null;
        onKnowledgeChangeRef.current?.(null);
      }
      return;
    }
    if (picked.id === lockedKnowledgeId) return;
    lockSourceRef.current = "auto";
    onKnowledgeChangeRef.current?.(picked);
  }, [lockedKnowledgeId, lockedLabel, templates, stageCode, value]);

  useEffect(() => {
    void Promise.all([
      fetch("/api/connectors").then((r) => r.ok ? r.json() : []),
      fetch("/api/projects").then((r) => r.ok ? r.json() : []),
      fetch("/api/files/recent?limit=12").then((r) => r.ok ? r.json() : []),
    ]).then(([connectorRows, projectRows, fileRows]) => {
      if (Array.isArray(connectorRows)) {
        setConnectors(connectorRows.filter((row) => row.id).map((row) => ({
          id: String(row.id),
          label: row.label || row.name || String(row.id),
        })));
      }
      if (Array.isArray(projectRows)) setProjects(projectRows);
      if (Array.isArray(fileRows)) setRecentFiles(fileRows);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!plusOpen) return;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setPlusOpen(false);
        setActiveSubmenu(null);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPlusOpen(false);
        setActiveSubmenu(null);
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [plusOpen]);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    if (variant === "workspace") {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 40), 220)}px`;
      return;
    }
    textarea.style.height = "0";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [value, variant]);

  useEffect(() => {
    if (variant !== "workspace" || value.trim() || focused) return;
    const timer = window.setInterval(() => {
      setHintIndex((current) => (current + 1) % WORKSPACE_PLACEHOLDERS.length);
    }, 7000);
    return () => window.clearInterval(timer);
  }, [variant, value, focused]);

  useEffect(() => {
    if (!skills.length) return;
    refreshAt(value);
    // Re-open the picker once the catalog arrives if the user already typed / or @.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skills]);

  useEffect(() => {
    if (!autoFocus) return;
    const delay = window.setTimeout(() => {
      const node = inputRef.current;
      if (!node) return;
      node.focus();
      if (!selectFirstPlaceholder) return;
      const match = node.value.match(/\[[^\]]+\]/);
      if (match && match.index != null) {
        node.setSelectionRange(match.index, match.index + match[0].length);
      }
    }, 350);
    return () => window.clearTimeout(delay);
    // Apply when a template draft lands on the home composer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus, autoFocusToken]);

  const selected = skills.filter((s) => {
    const names = [labelOf(s), ...(s.aliases || [])];
    return names.some((n) => value.includes(`/${n}`) || value.includes(`@${n}`) || value.includes(n));
  });
  const lockedSkill = lockedIntent ? skills.find((s) => s.id === lockedIntent) : undefined;
  const chipSkills = lockedSkill && !selected.some((s) => s.id === lockedSkill.id)
    ? [lockedSkill, ...selected]
    : selected;

  const filtered = skills.filter((s) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const blob = `${s.id} ${labelOf(s)} ${(s.aliases || []).join(" ")}`.toLowerCase();
    return blob.includes(q) || labelOf(s).toLowerCase().startsWith(q);
  });
  const filteredTemplates = templates.filter((row) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const blob = `${row.id} ${row.title} ${row.skill_id || ""} ${row.starter || ""}`.toLowerCase();
    return blob.includes(q);
  });
  const filteredConnectors = debug && triggerMark === "@" ? connectors.filter((connector) => {
    const q = query.trim().toLowerCase();
    return !q || `${connector.id} ${connector.label}`.toLowerCase().includes(q);
  }) : [];

  const refreshAt = (next: string, caret?: number) => {
    const el = inputRef.current;
    const pos = caret ?? el?.selectionStart ?? next.length;
    const hit = triggerQuery(next, pos);
    if (!hit) {
      setPicker(false);
      setQuery("");
      return;
    }
    setTriggerMark(hit.mark);
    const q = hit.q;
    const hits = skills.filter((s) => {
      if (!q) return true;
      const blob = `${s.id} ${labelOf(s)} ${(s.aliases || []).join(" ")}`.toLowerCase();
      return blob.includes(q.toLowerCase()) || labelOf(s).toLowerCase().startsWith(q.toLowerCase());
    });
    const templateHits = templates.filter((row) => {
      if (!q) return true;
      return `${row.id} ${row.title} ${row.skill_id || ""}`.toLowerCase().includes(q.toLowerCase());
    });
    const connectorHits = debug && hit.mark === "@" && connectors.some((connector) =>
      `${connector.id} ${connector.label}`.toLowerCase().includes(q.toLowerCase()),
    );
    if (q && !hits.length && !templateHits.length && !connectorHits) {
      setPicker(false);
      setQuery(q);
      return;
    }
    setAtStart(hit.start);
    setQuery(q);
    setPicker(true);
  };

  const pickSkill = (s: SkillOption) => {
    const lab = labelOf(s);
    const mention = `${triggerMark}${lab}`;
    const el = inputRef.current;
    const caret = el?.selectionStart ?? value.length;
    const before = value.slice(0, atStart);
    const after = value.slice(caret);
    const next = `${before}${mention} ${after}`.replace(/\s+/g, " ").trimStart();
    onChange(next);
    lockSourceRef.current = null;
    onKnowledgeChange?.(null);
    setPicker(false);
    setQuery("");
    onPickSkill?.(s, { mention, rest: `${before} ${after}`.replace(/\s+/g, " ").trim() });
    requestAnimationFrame(() => {
      const node = inputRef.current;
      if (!node) return;
      const pos = (before + mention + " ").length;
      node.focus();
      node.setSelectionRange(pos, pos);
    });
  };

  const pickTemplate = (row: KnowledgeRow) => {
    const fill = composerFillText(row);
    lockSourceRef.current = "explicit";
    onChange(fill);
    onKnowledgeChange?.(row);
    setPicker(false);
    setQuery("");
    requestAnimationFrame(() => {
      const node = inputRef.current;
      if (!node) return;
      node.focus();
      const match = fill.match(/\[[^\]]+\]/);
      if (match && match.index != null) node.setSelectionRange(match.index, match.index + match[0].length);
    });
  };

  const pickConnector = (connector: { id: string; label: string }) => {
    const mention = `@${connector.label}`;
    const el = inputRef.current;
    const caret = el?.selectionStart ?? value.length;
    const before = value.slice(0, atStart);
    const after = value.slice(caret);
    onChange(`${before}${mention} ${after}`.replace(/\s+/g, " ").trimStart());
    setPicker(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const appendMention = (mention: string) => {
    const prefix = `${value}${value && !value.endsWith(" ") ? " " : ""}`;
    onChange(`${prefix}${mention} `);
    setPlusOpen(false);
    setActiveSubmenu(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const reuseRecentFile = (file: AttachmentRef & { available?: boolean }) => {
    if (file.available === false) return;
    setAttachments((current) => current.some((item) => item.path === file.path) ? current : [...current, file]);
    setPlusOpen(false);
    setActiveSubmenu(null);
  };

  const attachFiles = async (files: FileList | File[] | null) => {
    if (!files?.length) return;
    setUploading(true);
    setAttachErr("");
    try {
      const next: AttachmentRef[] = [...attachments];
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        const r = await fetch("/api/attachments", { method: "POST", body: fd });
        const b = (await r.json().catch(() => ({}))) as AttachmentRef & { detail?: string };
        if (!r.ok || !b.path) {
          throw new Error(typeof b.detail === "string" ? b.detail : "附件未写入磁盘");
        }
        const uploaded = { id: b.id, name: b.name || file.name, path: b.path, size: b.size || file.size, type: b.type || file.type || "文件", available: true };
        next.push(uploaded);
        setRecentFiles((current) => [uploaded, ...current.filter((item) => item.path !== uploaded.path)].slice(0, 12));
      }
      setAttachments(next);
    } catch (e) {
      setAttachErr(String(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const openToolbarMenu = (submenu: "projects" | "skills" | "connectors") => {
    setPlusOpen(true);
    setActiveSubmenu(submenu);
  };

  const setComposerFocus = (next: boolean) => {
    setFocused(next);
    onFocusChange?.(next);
  };

  const intent = lockedIntent || undefined;
  const lockedRow = templates.find((row) => row.id === lockedKnowledgeId);
  const previewTitle = lockedRow?.title || lockedTemplate?.title || "";
  const previewSubject = lockedRow?.subject || lockedTemplate?.subject || "";
  const previewBody = lockedRow?.body_en || lockedRow?.body || lockedTemplate?.body_en || "";
  const previewExcerpt = templateBodyExcerpt(previewBody);
  const bodyInComposer = composerHoldsTemplateBody(value, previewBody);
  const empty = !value.trim() && attachments.length === 0 && !selectedProject;
  const busy = disabled || uploading;
  const workspace = variant === "workspace";
  const placeholder = (hint && !value.trim())
    ? hint
    : workspace
      ? (value.trim() ? WORKSPACE_PLACEHOLDERS[0] : WORKSPACE_PLACEHOLDERS[hintIndex])
      : PLACEHOLDER;

  const submit = () => {
    if (empty || busy) return;
    const text = value.trim() || attachments.map((a) => a.name).join("、") || selectedProject?.label || "";
    onSubmit({
      text,
      intent,
      collaboration_id: selectedProject?.id,
      knowledge_id: lockedKnowledgeId || undefined,
      model_tier: modelTier,
      attachments: attachments.length ? attachments : undefined,
    });
    setAttachments([]);
    setSelectedProject(null);
    setPicker(false);
    setAttachErr("");
  };

  return (
    <div
      className={"composer-dock" + (dragging ? " is-dragging" : "") + (workspace ? " composer-dock--workspace" : "")}
      data-composer
      data-composer-size={variant}
      data-composer-running={running ? "true" : undefined}
      data-composer-hint={hint || undefined}
      aria-busy={busy || running || undefined}
      onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); void attachFiles(e.dataTransfer.files); }}
    >
      {dragging && (
        <div className="drop-overlay drop-overlay--sticky" role="status">
          <div className="sticky-note">
            <span className="sticky-note-pin" aria-hidden />
            <strong>贴这里就行</strong>
            <span>{debug ? "松开上传附件 · 走 Host 会话，不造本地执行" : "松开即可上传附件"}</span>
          </div>
        </div>
      )}
      {picker && (
        <div className="skill-picker" data-skill-picker role="listbox" aria-label="技能">
          {skills.length === 0 && templates.length === 0 && <p className="muted skill-picker-empty">加载技能…</p>}
          {skills.length + templates.length > 0 && filtered.length === 0 && filteredTemplates.length === 0 && filteredConnectors.length === 0 && <p className="muted skill-picker-empty">没有匹配项</p>}
          {filteredTemplates.map((row) => (
            <button
              key={`kb-${row.id}`}
              type="button"
              className="skill-option"
              data-knowledge-option={row.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pickTemplate(row)}
            >
              <span className="skill-option-label">{row.title}</span>
              <span className="skill-option-id">已启用模板 · {skillLabel(row.skill_id)}</span>
            </button>
          ))}
          {filteredConnectors.map((connector) => (
            <button key={`connector-${connector.id}`} type="button" className="skill-option" data-connector-option={connector.id} onMouseDown={(e) => e.preventDefault()} onClick={() => pickConnector(connector)}>
              <span className="skill-option-label">@{connector.label}</span>
              <span className="skill-option-id">连接器</span>
            </button>
          ))}
          {filtered.map((s) => (
            <button
              key={s.id}
              type="button"
              className="skill-option"
              data-skill-option={s.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pickSkill(s)}
            >
              <span className="skill-option-label">{labelOf(s)}</span>
              <span className="skill-option-id">技能</span>
            </button>
          ))}
        </div>
      )}
      {(chipSkills.length > 0 || attachments.length > 0 || selectedProject || lockedKnowledgeId) && (
        <div className="composer-chips">
          {chipSkills.map((s) => (
            <span key={s.id} className={"skill-chip" + (isQuietSkill(s) ? " skill-chip--quiet" : "")} data-skill-chip={s.id}>
              {value.includes(`/${labelOf(s)}`) ? "/" : value.includes(`@${labelOf(s)}`) ? "@" : ""}
              {s.id === "email_compose" && (lockedLabel === "写合作邮件" || value.includes("写合作邮件"))
                ? "写合作邮件"
                : s.id === lockedIntent ? (lockedLabel || labelOf(s)) : labelOf(s)}
            </span>
          ))}
          {lockedKnowledgeId && (
            <span className="skill-chip" data-knowledge-chip={lockedKnowledgeId}>
              本封按「{previewTitle || "已启用模板"}」
            </span>
          )}
          {attachments.map((a) => (
            <span key={a.path} className="attachment-card" data-attachment-name={a.name} title={a.path}>
              <span className="attachment-icon" aria-hidden>▧</span>
              <span className="attachment-meta"><strong>{a.name}</strong><small>{a.type || "文件"}{a.size ? ` · ${formatSize(a.size)}` : ""} · 已上传</small></span>
              <button
                type="button"
                className="chip-x"
                aria-label={`移除 ${a.name}`}
                onClick={() => setAttachments((cur) => cur.filter((x) => x.path !== a.path))}
              >
                ×
              </button>
            </span>
          ))}
          {selectedProject && (
            <span className="project-chip" data-project-id={selectedProject.id}>
              <span aria-hidden>▱</span>
              <span><strong>{selectedProject.label}</strong><small>已添加到项目</small></span>
              <button type="button" className="chip-x" aria-label={`移除项目 ${selectedProject.label}`} onClick={() => setSelectedProject(null)}>×</button>
            </span>
          )}
        </div>
      )}
      {lockedKnowledgeId && (previewTitle || previewBody) ? (
        <aside
          className={"composer-template-preview" + (bodyInComposer ? " composer-template-preview--lock" : "")}
          data-knowledge-preview={lockedKnowledgeId}
          data-knowledge-preview-mode={bodyInComposer ? "lock" : "full"}
          aria-label="已锁定邮件底稿"
        >
          <div className="composer-template-preview-head">
            <strong data-knowledge-preview-title>{previewTitle || "已启用模板"}</strong>
            {previewSubject ? (
              <span className="composer-template-preview-subject">{previewSubject}</span>
            ) : null}
          </div>
          {!bodyInComposer && previewExcerpt ? (
            <p className="composer-template-preview-excerpt" data-knowledge-preview-body>
              {previewExcerpt}
            </p>
          ) : null}
          {!bodyInComposer && previewBody && previewBody !== previewExcerpt ? (
            <details>
              <summary>全文</summary>
              <pre>{previewBody}</pre>
            </details>
          ) : null}
        </aside>
      ) : null}
      {queue && queue.length > 0 ? (
        <div className="composer-queue" data-run-queue>
          {queue.map((item) => (
            <span key={item.id} className="queue-chip" data-queue-id={item.id}>
              <span>{String(item.text || "排队中的任务").slice(0, 28)}</span>
              <button
                type="button"
                className="chip-x"
                aria-label="移出队列"
                onClick={() => onRemoveQueued?.(item.id)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {attachErr && <p className="error composer-err">{attachErr}</p>}
      {suggestions && suggestions.length > 0 ? (
        <div className="composer-suggestions" data-ai-next-actions data-composer-suggestions>
          {suggestions.slice(0, 3).map((item, index) => {
            const label = item.label || `建议 ${index + 1}`;
            return (
              <button
                key={`${item.intent || label}-${index}`}
                type="button"
                data-ai-next={item.intent || ""}
                disabled={disabled}
                onClick={() => {
                  if (onPickSuggestion) {
                    onPickSuggestion(item);
                    return;
                  }
                  onChange(String(item.prompt || item.label || ""));
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      ) : null}
      <form
        className={"composer" + (workspace ? " composer--workspace" : "")}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          ref={fileRef}
          type="file"
          hidden
          data-attach-input
          multiple
          onChange={(e) => attachFiles(e.target.files)}
        />
        <textarea
          ref={inputRef}
          data-composer-input
          data-ai-prompt-textarea
          data-composer-hint={hint || undefined}
          aria-busy={busy || undefined}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            refreshAt(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          onKeyUp={() => refreshAt(value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setPicker(false);
              return;
            }
            if (e.key === "Enter" && picker && (filtered.length || filteredTemplates.length || filteredConnectors.length)) {
              e.preventDefault();
              if (triggerMark === "@" && filteredConnectors.length) pickConnector(filteredConnectors[0]);
              else if (filteredTemplates.length) pickTemplate(filteredTemplates[0]);
              else if (filtered.length) pickSkill(filtered[0]);
            }
          }}
          onFocus={() => {
            setComposerFocus(true);
            refreshAt(value);
          }}
          onBlur={(e) => {
            if (!e.currentTarget.form?.contains(e.relatedTarget as Node)) setComposerFocus(false);
          }}
          onClick={() => refreshAt(value)}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            if (files.length) {
              e.preventDefault();
              void attachFiles(files);
            }
          }}
          rows={workspace ? 2 : 1}
          placeholder={placeholder}
          aria-label="发消息或创建任务"
        />
        <div className={workspace ? "composer-toolbar" : "composer-inline-tools"} data-ai-prompt-tools>
        <div className="composer-add-wrap" ref={menuRef}>
        <button
          type="button"
          className={"composer-plus" + (plusOpen ? " is-selected" : "")}
          data-attach
          aria-label="添加资料"
          title="添加资料"
          disabled={busy}
          aria-expanded={plusOpen}
          onClick={() => {
            setPlusOpen((v) => !v);
            setActiveSubmenu(null);
          }}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
            {workspace ? (
              <path
                d="M12 5v14M5 12h14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            ) : (
              <path
                d="M16.5 6.5v9.2a4.5 4.5 0 0 1-9 0V7.2a3 3 0 0 1 6 0v8.1a1.5 1.5 0 0 1-3 0V8"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            )}
          </svg>
        </button>
        {workspace && (
          <>
            <button
              type="button"
              className={"composer-tool" + (activeSubmenu === "projects" ? " is-selected" : "")}
              data-composer-tool="project"
              aria-label="项目"
              aria-pressed={activeSubmenu === "projects"}
              onClick={() => openToolbarMenu("projects")}
            >
              <svg className="composer-tool-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden>
                <path d="M3.5 7.5h6l1.5 2h9v9a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2zM3.5 7.5v-1a2 2 0 0 1 2-2h4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
              </svg>
              <span className="composer-tool-label">项目</span>
            </button>
            <button
              type="button"
              className={"composer-tool" + (activeSubmenu === "skills" ? " is-selected" : "")}
              data-composer-tool="skills"
              aria-label="技能"
              aria-pressed={activeSubmenu === "skills"}
              onClick={() => openToolbarMenu("skills")}
            >
              <svg className="composer-tool-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden>
                <path d="M5 5h5v5H5zm9 0h5v5h-5zM5 14h5v5H5zm9 0h5v5h-5z" fill="none" stroke="currentColor" strokeWidth="1.6" />
              </svg>
              <span className="composer-tool-label">技能</span>
            </button>
          </>
        )}
        {plusOpen && (
          <div className="menu-popover composer-add-menu cascade-menu" role="menu" aria-label="添加内容">
            <MenuButton icon="upload" label="上传文件" onClick={() => { setPlusOpen(false); fileRef.current?.click(); }} />
            <MenuButton icon="project" label="添加到项目" arrow onActivate={() => setActiveSubmenu("projects")} />
            <MenuButton icon="recent" label="最近的文件" arrow onActivate={() => setActiveSubmenu("recent")} />
            <div className="menu-divider" />
            <MenuButton icon="skills" label="技能" arrow onActivate={() => setActiveSubmenu("skills")} />
            {activeSubmenu === "projects" && (
              <CascadeSubmenu label="项目">
                {projects.map((project) => (
                  <button type="button" role="menuitem" key={project.id} onClick={() => {
                    setSelectedProject(project);
                    setPlusOpen(false);
                    setActiveSubmenu(null);
                  }}>
                    <MenuIcon kind="project" /><span><strong>{project.label}</strong><small>{project.description}</small></span>
                  </button>
                ))}
                {!projects.length && <p className="menu-empty">暂无可用项目</p>}
              </CascadeSubmenu>
            )}
            {activeSubmenu === "recent" && (
              <CascadeSubmenu label="最近的文件">
                {recentFiles.map((file) => (
                  <button type="button" role="menuitem" key={file.id || file.path} disabled={file.available === false} onClick={() => reuseRecentFile(file)}>
                    <MenuIcon kind="recent" /><span><strong>{file.name}</strong><small>{file.type || "文件"}{file.size ? ` · ${formatSize(file.size)}` : ""}</small></span>
                  </button>
                ))}
                {!recentFiles.length && <p className="menu-empty">暂无最近文件</p>}
              </CascadeSubmenu>
            )}
            {activeSubmenu === "skills" && (
              <CascadeSubmenu label="技能">
                <div className="submenu-scroll">
                  {skills.map((skill) => (
                    <button type="button" role="menuitem" key={skill.id} onClick={() => appendMention(`/${labelOf(skill)}`)}>
                      <MenuIcon kind="skills" /><span><strong>{labelOf(skill)}</strong>{debug ? <small>{skill.id}</small> : null}</span>
                    </button>
                  ))}
                </div>
              </CascadeSubmenu>
            )}
          </div>
        )}
        </div>
        <span className="composer-toolbar-divider" data-composer-divider aria-hidden="true" />
        <div className="composer-toolbar-end">
        <label className="tier-control">
          <span className="sr-only">模型档位</span>
          <svg className="tier-control-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M13.2 2.8 5.5 13h5.1l-.8 8.2L17.5 11h-5.1l.8-8.2Z" />
          </svg>
          <select value={modelTier} onChange={(e) => { setModelTier(e.target.value); localStorage.setItem("composer:model-tier", e.target.value); }} aria-label="模型档位">
            <option value="fast">快速</option><option value="balanced">均衡</option><option value="quality">高质量</option>
          </select>
        </label>
        {running ? (
          <button
            className="btn ghost composer-stop"
            type="button"
            data-stop-run
            aria-label="停止生成"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onStop?.();
            }}
          >
            停止
          </button>
        ) : null}
        <button className={"btn send" + (workspace ? " send-arrow" : "")} type="submit" data-send data-ai-prompt-submit disabled={busy || empty} aria-label={running ? "加入队列" : "发送"}>
          {workspace ? <SendArrowIcon ready={!busy && !empty} /> : "发送"}
        </button>
        </div>
        </div>
      </form>
      <span className="sr-only" role="status">{uploading ? "正在上传附件" : attachErr || ""}</span>
    </div>
  );
}

function SendArrowIcon({ ready }: { ready: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden data-send-arrow={ready ? "ready" : "idle"}>
      <path
        d="M12 19V6m0 0-5.5 5.5M12 6l5.5 5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type MenuKind = "upload" | "project" | "recent" | "skills" | "connector";

function MenuIcon({ kind }: { kind: MenuKind }) {
  const paths: Record<MenuKind, string> = {
    upload: "M12 16V5m0 0-4 4m4-4 4 4M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4",
    project: "M3.5 7.5h6l1.5 2h9v9a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2zM3.5 7.5v-1a2 2 0 0 1 2-2h4",
    recent: "M5 6.5h11a2 2 0 0 1 2 2v11H7a2 2 0 0 1-2-2zm7 3v4l3 2",
    skills: "M5 5h5v5H5zm9 0h5v5h-5zM5 14h5v5H5zm9 0h5v5h-5z",
    connector: "M7 4v4m-2-2h4m8 10v4m-2-2h4M9 6h4a4 4 0 0 1 4 4v6M15 18h-4a4 4 0 0 1-4-4v-4",
  };
  return (
    <svg className="cascade-icon" viewBox="0 0 24 24" aria-hidden>
      <path d={paths[kind]} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MenuButton({
  icon,
  label,
  arrow,
  onClick,
  onActivate,
}: {
  icon: MenuKind;
  label: string;
  arrow?: boolean;
  onClick?: () => void;
  onActivate?: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick || onActivate}
      onMouseEnter={onActivate}
      onFocus={onActivate}
    >
      <MenuIcon kind={icon} />
      <span>{label}</span>
      {arrow && <span className="menu-arrow" aria-hidden>›</span>}
    </button>
  );
}

function CascadeSubmenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="menu-popover cascade-submenu" role="menu" aria-label={label}>
      {children}
    </div>
  );
}

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
