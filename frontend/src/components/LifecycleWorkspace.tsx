import { useId, type ReactNode } from "react";
import { LifecycleNavigation, type LifecycleOption } from "./LifecycleNavigation";
import "./lifecycle-workspace.css";

type Props = {
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
  feedback?: ReactNode;
  views: Array<LifecycleOption & { content: ReactNode }>;
  value: string;
  onChange: (id: string) => void;
};

/** A stable header/navigation/scroll region; hidden panels preserve editing context. */
export function LifecycleWorkspace({ title, meta, actions, feedback, views, value, onChange }: Props) {
  const id = useId();
  return <section className="lifecycle-workspace" aria-label={title} data-lifecycle-workspace>
    <header className="lifecycle-workspace-header"><h2>{title}</h2>
      <div className="lifecycle-workspace-meta">{meta}</div><div className="lifecycle-actions">{actions}</div>
    </header>
    {feedback ? <div className="lifecycle-feedback">{feedback}</div> : null}
    <LifecycleNavigation label={`${title}管理视图`} mode="views" idPrefix={id} options={views} value={value} onChange={onChange} />
    <div className="lifecycle-workspace-body">
      {views.map(view => <section key={view.id} id={`${id}-panel-${view.id}`} role="tabpanel"
        aria-labelledby={`${id}-tab-${view.id}`} tabIndex={0} hidden={value !== view.id} className="lifecycle-view">{view.content}</section>)}
    </div>
  </section>;
}
