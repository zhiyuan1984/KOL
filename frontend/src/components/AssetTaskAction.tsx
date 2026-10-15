import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Select } from "antd";
import { api, type SessionRow } from "../api";
import { useAccount } from "./AuthGate";
import CompactButton from "./CompactButton";
import type { ComposerDraftStash } from "../composer/types";
import { lastWorkspaceTarget, mergeAssetDraft, readDraft, readWorkspaceDraft, saveWorkspaceDraft, writeDraft } from "../composer/draft";

/** Catalogue use is a draft handoff to an explicitly selected target: a session, or the workbench composer. */
export const WORKBENCH_TARGET = "__workbench__";

export default function AssetTaskAction({ draft, disabled = false, beforeUse, onUsed, useAttributes }: {
  draft: ComposerDraftStash; disabled?: boolean; beforeUse?: () => Promise<void>; onUsed?: () => void;
  useAttributes?: Record<string, string>;
}) {
  const { account } = useAccount();
  const userId = account?.id || "";
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [target, setTarget] = useState(() => lastWorkspaceTarget(userId)?.sessionId || "");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setLoaded(false); setError("");
    void api.sessions().then(rows => {
      if (!active) return;
      const available = rows.filter(row => !row.archived_at);
      setSessions(available); setLoaded(true);
      setTarget(current => current === WORKBENCH_TARGET || available.some(row => row.id === current) ? current : "");
    }).catch(e => { if (active) { setError(e instanceof Error ? e.message : "无法读取目标任务"); setLoaded(true); } });
    return () => { active = false; };
  }, [reload, userId]);
  const useForTask = async () => {
    if (!userId || !target || busy || disabled) return;
    setBusy(true); setError("");
    try {
      if (target === WORKBENCH_TARGET) {
        // No session to re-check: the home-scope draft is the handoff.
        const merged = mergeAssetDraft(readDraft({ page: "home" }) ?? undefined, draft);
        await beforeUse?.();
        writeDraft({ page: "home" }, merged);
        onUsed?.();
        navigate("/");
        return;
      }
      // Re-read access immediately before handing off; failed reads retain the catalogue and draft.
      await api.session(target);
      const prior = readWorkspaceDraft(userId, target);
      const sessionTarget = prior?.target || { sessionId: target, path: `/s/${encodeURIComponent(target)}`,
        title: sessions.find(row => row.id === target)?.title || "当前任务" };
      const merged = mergeAssetDraft(prior?.draft, draft);
      await beforeUse?.();
      saveWorkspaceDraft(userId, sessionTarget, merged);
      onUsed?.();
      navigate(sessionTarget.path);
    } catch (e) { setError(e instanceof Error ? e.message : "暂时无法带入任务，已保留选择"); }
    finally { setBusy(false); }
  };
  return <div className="asset-task-action">
    <label className="asset-task-target"><span>目标任务</span><Select size="small" aria-label="选择目标任务"
      value={target || undefined} placeholder={loaded ? "选择要继续的任务" : "正在读取任务…"}
      loading={!loaded} disabled={busy || !loaded || !!error} showSearch optionFilterProp="label"
      options={[{ value: WORKBENCH_TARGET, label: "工作台提问框" }, ...sessions.map(row => ({ value: row.id, label: row.title || row.id }))]} onChange={setTarget} /></label>
    {error ? <p className="asset-action-error" role="alert">{error} <CompactButton onClick={() => setReload(value => value + 1)}>重试</CompactButton></p> : null}
    {loaded && !error && !sessions.length ? <p className="muted">暂无可继续的任务。<CompactButton onClick={() => navigate("/agents")}>选择数字员工开始工作</CompactButton></p> : null}
    <div className="kbv-actions"><CompactButton emphasis="primary" size="md" data-asset-use {...useAttributes}
      disabled={disabled || busy || !loaded || !target || !userId || !!error} onClick={() => void useForTask()}>
      {busy ? "正在带入…" : target === WORKBENCH_TARGET ? "发到工作台提问框" : "用于当前任务"}</CompactButton></div>
  </div>;
}
