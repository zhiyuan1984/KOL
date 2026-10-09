import { useRef, useState } from "react";
import { api } from "../api";
import { friendlyApiError } from "../labels";
import { DiscoveryIngestConfirm } from "./DiscoveryIngestConfirm";
import DiscoveryRuntimeCandidate, { type Candidate } from "./DiscoveryRuntimeCandidate";
import type { DiscoveryBrief } from "./discoveryTemplate";

export default function DiscoveryCandidateBatch({ rows, actionId, brief, capturedAt, refresh, selectedIds: controlledIds, onSelect }: {
  rows: Candidate[]; actionId: string; brief: DiscoveryBrief; capturedAt: string; refresh: () => void;
  selectedIds?: string[]; onSelect?: (id: string, checked: boolean) => void;
}) {
  const [localIds, setSelectedIds] = useState<string[]>([]);
  const selectedIds = onSelect ? controlledIds || [] : localIds;
  const [confirmRows, setConfirmRows] = useState<Candidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState("");
  const eligible = rows.filter(row => row.snapshot_version && !row.followed && !row.in_pool && !row.ignored);
  const selected = eligible.filter(row => selectedIds.includes(row.id));
  function select(id: string, checked: boolean) {
    if (onSelect) onSelect(id, checked);
    else setSelectedIds(ids => checked ? [...new Set([...ids, id])] : ids.filter(value => value !== id));
  }
  async function ingest() {
    if (submitting.current || busy || !confirmRows) return;
    submitting.current = true;
    setBusy(true); setError("");
    let completed = 0;
    try {
      for (const row of confirmRows) {
        const result = await api.discoveryCandidateCommand(actionId, row.id, "ingest", row.snapshot_version!);
        if (!result.ok) throw new Error("入库结果尚未确认，请刷新核对。");
        completed++;
        select(row.id, false);
      }
      setConfirmRows(null);
    } catch (failure) { setError(friendlyApiError(failure, "入库未全部完成，请核对未完成候选后再确认。")); }
    finally {
      setReceipt(`本次已确认加入公海 ${completed} 位；${confirmRows.length - completed} 位未完成。`);
      submitting.current = false;
      setBusy(false); refresh();
    }
  }
  // Any candidate version or eligibility change invalidates the displayed confirmation.
  const stale = Boolean(confirmRows?.some(row => !eligible.some(current => current.id === row.id && current.snapshot_version === row.snapshot_version)));
  return <>
    <div className="discovery-candidate-batch" aria-label="候选批量操作">
      <label><input type="checkbox" aria-label="全选当前候选" disabled={busy || !eligible.length}
        checked={eligible.length > 0 && selected.length === eligible.length}
        onChange={event => { for (const row of eligible) select(row.id, event.target.checked); }} />全选当前候选</label>
      <span>已选 {selected.length} 人</span>
      <button type="button" className="link-button" disabled={busy || !selected.length}
        onClick={() => { setConfirmRows(selected); setError(""); }}>加入公海（{selected.length}）</button>
    </div>
    {receipt ? <p className="discovery-batch-receipt" role="status">{receipt}</p> : null}
    {rows.map(row => <DiscoveryRuntimeCandidate key={row.id} row={row} actionId={actionId} brief={brief} capturedAt={capturedAt}
      refresh={refresh} selected={selectedIds.includes(row.id)} onSelect={checked => select(row.id, checked)} />)}
    <DiscoveryIngestConfirm open={Boolean(confirmRows)} busy={busy} error={stale ? "候选资料或归属已变化，请取消并重新选择。" : error}
      confirmDisabled={stale} risk="R3" confirmText="确认入库公海" rows={[
        { label: "对象", value: confirmRows?.map(row => `${row.name}（${row.platform} / ${row.id}）`).join("、") },
        { label: "操作", value: `将已选 ${confirmRows?.length || 0} 位的公开资料加入公海；不领取跟进、不发信、不改变阶段。` },
        { label: "来源", value: "本次发现任务；已有评分按稳定平台账号复用。不确定回执停止提交余下对象。" },
      ]} onConfirm={() => { if (!stale) void ingest(); }} onCancel={() => { if (!busy) { setConfirmRows(null); setError(""); } }} />
  </>;
}
