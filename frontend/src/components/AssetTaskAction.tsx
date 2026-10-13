import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Select } from "antd";
import { api, type SessionRow } from "../api";
import { useAccount } from "./AuthGate";
import CompactButton from "./CompactButton";
import type { ComposerDraftStash } from "../composer/types";
import { lastWorkspaceTarget, mergeAssetDraft, readWorkspaceDraft, saveWorkspaceDraft } from "../composer/taskDraft";

/** Catalogue use is a draft handoff to an explicitly selected, authorized session. */
export default function AssetTaskAction({ draft, disabled = false, beforeUse, onUsed, useAttributes }: {
  draft: ComposerDraftStash; disabled?: boolean; beforeUse?: () => Promise<void>; onUsed?: () => void;
  useAttributes?: Record<string, string>;
}) {
  const { account } = useAccount();
  const userId = account?.id || "";
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sessionId, setSessionId] = useState(() => lastWorkspaceTarget(userId)?.sessionId || "");
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
      setSessionId(current => available.some(row => row.id === current) ? current : "");
    }).catch(e => { if (active) { setError(e instanceof Error ? e.message : "无法读取目标任务"); setLoaded(true); } });
    return () => { active = false; };
  }, [reload, userId]);
  const useForTask = async () => {
    if (!userId || !sessionId || busy || disabled) return;
    setBusy(true); setError("");
    try {
      // Re-read access immediately before handing off; failed reads retain the catalogue and draft.
      await api.session(sessionId);
      const prior = readWorkspaceDraft(userId, sessionId);
      const target = prior?.target || { sessionId, path: `/s/${encodeURIComponent(sessionId)}`,
        title: sessions.find(row => row.id === sessionId)?.title || "当前任务" };
      const merged = mergeAssetDraft(prior?.draft, draft);
      await beforeUse?.();
      saveWorkspaceDraft(userId, target, merged);
      onUsed?.();
      navigate(target.path);
    } catch (e) { setError(e instanceof Error ? e.message : "暂时无法带入任务，已保留选择"); }
    finally { setBusy(false); }
  };
  return <div className="asset-task-action">
    <label className="asset-task-target"><span>目标任务</span><Select size="small" aria-label="选择目标任务"
      value={sessionId || undefined} placeholder={loaded ? "选择要继续的任务" : "正在读取任务…"}
      loading={!loaded} disabled={busy || !loaded || !!error} showSearch optionFilterProp="label"
      options={sessions.map(row => ({ value: row.id, label: row.title || row.id }))} onChange={setSessionId} /></label>
    {error ? <p className="asset-action-error" role="alert">{error} <CompactButton onClick={() => setReload(value => value + 1)}>重试</CompactButton></p> : null}
    {loaded && !error && !sessions.length ? <p className="muted">暂无可继续的任务。<CompactButton onClick={() => navigate("/agents")}>选择数字员工开始工作</CompactButton></p> : null}
    <div className="kbv-actions"><CompactButton emphasis="primary" size="md" data-asset-use {...useAttributes}
      disabled={disabled || busy || !loaded || !sessionId || !userId || !!error} onClick={() => void useForTask()}>
      {busy ? "正在带入…" : "用于当前任务"}</CompactButton></div>
  </div>;
}
