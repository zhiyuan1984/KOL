import { useRef, useState } from "react";
import { api } from "../api";
import type { Candidate } from "./DiscoveryRuntimeCandidate";

type Entry = { actionId: string; row: Candidate };

/** One scoring entry for the current list; each persisted assessment stays independent. */
export default function DiscoveryCandidateScoring({ entries, selectedEntries, refresh }: {
  entries: Entry[]; selectedEntries?: Entry[]; refresh: () => void;
}) {
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState("");
  const scope = selectedEntries || entries;
  const pending = scope.filter(({ row }) => row.snapshot_version
    && (!row.assessment || ["unscored", "failed"].includes(row.assessment.state)));
  const scored = scope.filter(({ row }) => row.assessment?.state === "scored").length;
  const queued = scope.filter(({ row }) => row.assessment?.execution_state === "queued").length;
  const scoring = scope.filter(({ row }) => row.assessment?.state === "scoring"
    && row.assessment.execution_state !== "queued").length;
  const failed = scope.filter(({ row }) => row.assessment?.state === "failed").length;
  const unscored = scope.length - scored - queued - scoring - failed;

  async function completeScores() {
    if (submitting.current || !pending.length) return;
    submitting.current = true; setBusy(true); setReceipt("");
    let accepted = 0;
    let rejected = 0;
    // Submit one at a time to the durable queue. A failed request does not block
    // other candidates; replay is safe under the server's assessment key.
    try {
      for (const { actionId, row } of pending) {
        try {
          const result = await api.discoveryCandidateCommand(actionId, row.id, "score", row.snapshot_version!);
          if (!result.ok) throw new Error("Scoring request not accepted");
          accepted++;
        } catch { rejected++; }
        refresh();
      }
      setReceipt(`已提交 ${accepted} 位评分${rejected ? `；${rejected} 位提交未确认，请刷新核对后补全` : "，结果自动更新"}。`);
    } finally { submitting.current = false; setBusy(false); }
  }

  return <div className="discovery-candidate-scoring" data-discovery-scoring>
    <div className="discovery-scoring-toolbar">
      <span>{selectedEntries ? `已选 ${scope.length} 位` : `当前列表 ${scope.length} 位`}</span>
      <button type="button" className="link-button" disabled={busy || !pending.length}
        onClick={() => void completeScores()}>{busy ? "正在提交评分…" : `补全评分（${pending.length}）`}</button>
    </div>
    <p className="discovery-scoring-progress" role="status">已评分 {scored} · 排队 {queued} · 评分中 {scoring} · 失败 {failed} · 未评分 {unscored}</p>
    <p className="discovery-scoring-hint">新候选自动评分；补全仅处理未评分与失败项，已有结果复用。</p>
    {receipt ? <p className="discovery-scoring-receipt" role="status">{receipt}</p> : null}
  </div>;
}
