import { useEffect, useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import KbvIcon from "../../knowledgeIcons";

type Props = {
  open: boolean;
  title: string;
  body: ReactNode;
  legacyHref?: string;
  legacyLabel?: string;
  onClose: () => void;
};

/** 阶段说明弹窗（P1）：未接入的能力如实标注，并给旧版过渡入口；不伪造动作。 */
export default function PhaseNotice({ open, title, body, legacyHref, legacyLabel, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="kbv-dialog"
      data-kbv-phase-notice
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="kbv-dialog-head">
        <h2>{title}</h2>
        <button type="button" className="btn ghost" aria-label="关闭" onClick={onClose}>
          <KbvIcon name="close" />
        </button>
      </div>
      <div className="kbv-dialog-body">
        <p className="muted">{body}</p>
        {legacyHref ? (
          <p>
            <Link className="kbv-link-plain" to={legacyHref}>{legacyLabel || "打开旧版视图"} →</Link>
          </p>
        ) : null}
      </div>
      <div className="kbv-dialog-actions">
        <button type="button" className="btn" onClick={onClose}>关闭</button>
      </div>
    </dialog>
  );
}
