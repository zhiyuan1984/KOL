import { lazy, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, type Task } from "../api";
import { discoveryWorkspaceOf } from "../home/discoveryWorkspaceState";

const Chat = lazy(() => import("./Chat"));
const Home = lazy(() => import("./Home"));

type SessionView =
  | { id: string; kind: "loading" | "chat" }
  | { id: string; kind: "discovery"; task: Task }
  | { id: string; kind: "error"; message: string };

/** Select a renderer from server facts. A session address is never a Home redirect. */
export default function Session() {
  const { id = "" } = useParams();
  const [view, setView] = useState<SessionView>({ id, kind: "loading" });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setView({ id, kind: "loading" });
    void api.taskBySession(id).then(value => {
      if (!active) return;
      const task = ("task" in value ? value.task : value) as Task;
      setView(discoveryWorkspaceOf(task) ? { id, kind: "discovery", task } : { id, kind: "chat" });
    }).catch(error => {
      if (!active) return;
      // Older ordinary sessions have messages without a task resource.
      if ((error as { status?: number }).status === 404) setView({ id, kind: "chat" });
      else setView({ id, kind: "error", message: error instanceof Error ? error.message : "暂时无法读取会话任务" });
    });
    return () => { active = false; };
  }, [id, retry]);

  if (view.id !== id || view.kind === "loading") return <p className="muted" role="status">正在读取会话任务…</p>;
  if (view.kind === "error") return <section role="alert" data-session-route-error>
    <strong>暂时无法打开这次会话</strong>
    <p>{view.message}</p>
    <button type="button" className="btn text" onClick={() => setRetry(value => value + 1)}>重试读取</button>
  </section>;
  return view.kind === "discovery"
    ? <Home key={id} sessionRoute={{ id, task: view.task }} />
    : <Chat key={id} />;
}
