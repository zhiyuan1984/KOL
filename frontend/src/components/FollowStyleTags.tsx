import { useEffect, useMemo, useState } from "react";
import { api } from "../api";

export type FollowStyleTag = {
  id: string;
  label: string;
  custom?: boolean;
  reason?: string;
};

export const FOLLOW_STYLE_PRESETS: FollowStyleTag[] = [
  { id: "cautious", label: "犹豫谨慎" },
  { id: "slow_reply", label: "回复慢" },
  { id: "price_sensitive", label: "价格敏感" },
  { id: "fast_decide", label: "决策快" },
  { id: "needs_approval", label: "需上级拍板" },
  { id: "missing_materials", label: "材料不齐" },
];

function sameTag(a: FollowStyleTag, b: FollowStyleTag) {
  return a.id === b.id || a.label === b.label;
}

function toggleTag(current: FollowStyleTag[], tag: FollowStyleTag): FollowStyleTag[] {
  if (current.some((row) => sameTag(row, tag))) return current.filter((row) => !sameTag(row, tag));
  const mutex = tag.id === "cautious" ? "fast_decide" : tag.id === "fast_decide" ? "cautious" : "";
  return [...current.filter((row) => row.id !== mutex), tag];
}

export function FollowStyleTagPills({
  tags,
  empty = false,
}: {
  tags?: FollowStyleTag[] | null;
  empty?: boolean;
}) {
  if (!tags?.length) {
    return empty ? <span className="muted">暂无跟进标签</span> : null;
  }
  return (
    <span className="follow-style-tags" data-follow-style-tags>
      {tags.map((tag) => (
        <span key={tag.id + tag.label} className="follow-style-tag" data-follow-style-tag={tag.id}>
          {tag.label}
        </span>
      ))}
    </span>
  );
}

export function FollowStyleTagBar({
  collaborationId,
  sessionId,
  tags,
  presets,
  onSaved,
}: {
  collaborationId?: string | null;
  sessionId?: string;
  tags?: FollowStyleTag[] | null;
  presets?: FollowStyleTag[] | null;
  onSaved?: (tags: FollowStyleTag[]) => void;
}) {
  const current = tags || [];
  const options = presets?.length ? presets : FOLLOW_STYLE_PRESETS;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FollowStyleTag[]>(current);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) setDraft(current);
  }, [open, tags]);

  const dirty = useMemo(() => {
    const a = draft.map((tag) => tag.id).sort().join(",");
    const b = current.map((tag) => tag.id).sort().join(",");
    return a !== b || Boolean(custom.trim());
  }, [draft, current, custom]);

  if (!collaborationId) return null;

  const save = async () => {
    setBusy(true);
    setErr("");
    try {
      const label = custom.trim().slice(0, 12);
      const next = label ? toggleTag(draft, { id: `custom:${label}`, label, custom: true }) : draft;
      const result = await api.saveFollowStyleTags(collaborationId, {
        tags: next,
        mode: "replace",
        session_id: sessionId,
      });
      onSaved?.(result.follow_style_tags || next);
      setCustom("");
      setOpen(false);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "标签未能保存");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="follow-style-bar" data-follow-style-bar>
      <FollowStyleTagPills tags={current} />
      <button
        type="button"
        className="follow-style-add"
        data-follow-style-add
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        +标签
      </button>
      {open ? (
        <div className="follow-style-panel" data-follow-style-panel role="dialog" aria-label="跟进标签">
          <p className="muted">跟进风格，不改正式阶段。点保存后才写入。</p>
          <div className="follow-style-presets">
            {options.map((tag) => {
              const selected = draft.some((row) => sameTag(row, tag));
              return (
                <button
                  key={tag.id}
                  type="button"
                  className={"follow-style-chip" + (selected ? " is-on" : "")}
                  data-follow-style-preset={tag.id}
                  aria-pressed={selected}
                  onClick={() => setDraft((rows) => toggleTag(rows, tag))}
                >
                  {tag.label}
                </button>
              );
            })}
          </div>
          <label className="follow-style-custom">
            <span>自定义</span>
            <input
              value={custom}
              maxLength={12}
              placeholder="一词即可"
              onChange={(event) => setCustom(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                const label = custom.trim().slice(0, 12);
                if (!label) return;
                setDraft((rows) => toggleTag(rows, { id: `custom:${label}`, label, custom: true }));
                setCustom("");
              }}
            />
          </label>
          {err ? <p className="error" role="alert">{err}</p> : null}
          <div className="follow-style-actions">
            <button type="button" className="btn ghost sm" onClick={() => setOpen(false)} disabled={busy}>取消</button>
            <button type="button" className="btn work sm" data-follow-style-save onClick={() => void save()} disabled={busy || !dirty}>
              {busy ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function SuggestedFollowTags({
  tags,
  collaborationId,
  sessionId,
  handle,
  onPrefill,
  onApplied,
}: {
  tags?: FollowStyleTag[] | null;
  collaborationId?: string | null;
  sessionId?: string;
  handle?: string;
  onPrefill?: (text: string) => void;
  onApplied?: (tags: FollowStyleTag[]) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  if (!tags?.length) return null;
  return (
    <section className="suggested-follow-tags" data-suggested-follow-tags>
      <h3>建议跟进标签</h3>
      <ul>
        {tags.map((tag) => (
          <li key={tag.id}>
            <span>{tag.reason ? `${tag.reason}，建议打上「${tag.label}」` : `建议打上「${tag.label}」`}</span>
            {collaborationId ? (
              <button
                type="button"
                className="btn work sm"
                data-apply-follow-tag={tag.id}
                disabled={busy === tag.id}
                onClick={() => {
                  setBusy(tag.id);
                  void api.saveFollowStyleTags(collaborationId, {
                    tags: [tag],
                    mode: "add",
                    session_id: sessionId,
                  }).then((result) => {
                    onApplied?.(result.follow_style_tags || [tag]);
                  }).finally(() => setBusy(null));
                }}
              >
                {busy === tag.id ? "写入中…" : "打上"}
              </button>
            ) : onPrefill ? (
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => onPrefill(handle ? `给 @${handle} 打标签 ${tag.label}` : `打标签 ${tag.label}`)}
              >
                打上
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
