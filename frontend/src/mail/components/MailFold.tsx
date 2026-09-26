import type { ReactNode } from "react";

export type MailFoldKey = "summary" | "translation" | "original";

export const MAIL_FOLD_KEYS: MailFoldKey[] = ["summary", "translation", "original"];

const STORE_PREFIX = "mail:fold:";

/** Fold state is remembered per block; a missing key means "open". */
export function readMailFolds(): Record<MailFoldKey, boolean> {
  const folds = { summary: true, translation: true, original: true } as Record<MailFoldKey, boolean>;
  for (const key of MAIL_FOLD_KEYS) {
    try {
      const raw = localStorage.getItem(STORE_PREFIX + key);
      if (raw === "true" || raw === "false") folds[key] = raw === "true";
    } catch {
      /* ignore quota / private mode */
    }
  }
  return folds;
}

export function writeMailFold(key: MailFoldKey, open: boolean) {
  try {
    localStorage.setItem(STORE_PREFIX + key, open ? "true" : "false");
  } catch {
    /* ignore quota / private mode */
  }
}

/**
 * One collapsible block of the detail column. The header is the only control
 * (`aria-expanded`/`aria-controls`); the body always stays mounted so the
 * `data-mail-*` contracts keep resolving while the block is folded away.
 */
export function MailFold({
  id,
  label,
  open,
  onToggle,
  tag,
  attrs,
  children,
}: {
  id: MailFoldKey;
  label: string;
  open: boolean;
  onToggle: () => void;
  tag?: ReactNode;
  attrs?: Record<string, string | undefined>;
  children: ReactNode;
}) {
  const bodyId = `mail-fold-body-${id}`;
  return (
    <section className="mail-fold" data-mail-fold={id} {...attrs}>
      <button
        type="button"
        className="mail-fold-head"
        data-mail-fold-head={id}
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
      >
        <span className="mail-fold-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
        <strong className="mail-side-title">{label}</strong>
        {tag}
      </button>
      <div className="mail-fold-body" id={bodyId} hidden={!open}>
        {children}
      </div>
    </section>
  );
}
