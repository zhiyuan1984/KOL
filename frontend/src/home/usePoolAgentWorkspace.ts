import { useCallback, useRef, useState } from "react";
import { api, type TaskRunResult } from "../api";
import { runPendingAsk, storePending } from "../components/ChatBlocks";
import { randomUuid } from "../uuid";
import { enqueueKolAnalyze, PoolMaintenancePendingError, resumePoolJevAssessment } from "./kolSurfaceApi";
import { KOL_BATCH_SIZE, type PoolKol } from "./kolContract";

export type PoolAnalysisTurn = {
  id: string; kind: "analysis"; scope: PoolKol[]; prompt: string;
  taskId?: string; run?: TaskRunResult; sessionId?: string; error?: string;
  dispatching: boolean;
};
export type PoolScoreTurn = {
  id: string; kind: "score"; scope: PoolKol[]; criteria: Record<string, unknown> | null; criteriaNote: string;
  status: "running" | "waiting" | "completed" | "failed";
  batchesReturned: number; results: PoolKol[]; error?: string;
};
export type PoolScoreConfirm = { scope: PoolKol[]; criteria: Record<string, unknown> | null; criteriaNote: string };
export type PoolAgentTurn = PoolAnalysisTurn | PoolScoreTurn;

/** 保存每轮的范围与回执；选择变化只影响下一轮。 */
export function usePoolAgentWorkspace(assess: (
  ids: string[], criteria: Record<string, unknown> | null,
) => Promise<{ items: PoolKol[]; message: string }>, refresh: () => Promise<unknown>) {
  const [turns, setTurns] = useState<PoolAgentTurn[]>([]);
  const [scoreConfirm, setScoreConfirm] = useState<PoolScoreConfirm | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [runningSessions, setRunningSessions] = useState<Record<string, boolean>>({});
  const inFlight = useRef(false);
  const patch = (id: string, values: Partial<PoolAgentTurn>) => setTurns((rows) => rows.map((row) =>
    row.id === id ? { ...row, ...values } as PoolAgentTurn : row));
  const onSessionRunning = useCallback((id: string, running: boolean) => {
    setRunningSessions((current) => current[id] === running ? current : { ...current, [id]: running });
  }, []);

  const dispatch = async (turn: PoolAnalysisTurn) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setDispatching(true);
    patch(turn.id, { dispatching: true, error: undefined });
    try {
      let taskId = turn.taskId;
      if (!taskId) {
        const queued = await enqueueKolAnalyze({ kol_uids: turn.scope.map((card) => card.kol_uid), prompt: turn.prompt, surface: "pool" });
        taskId = queued.work_item_id;
        patch(turn.id, { taskId });
      }
      const run = turn.run || await api.runTask(taskId, { text: turn.prompt });
      patch(turn.id, { run, sessionId: run.session_id });
      const pending = run.pending_message || run.pending;
      storePending(run.session_id, {
        ...pending, text: String(pending?.text || turn.prompt), intent: "kol_analyze",
        work_item_id: run.work_item_id || taskId, task_type: "kol_analyze", run_id: run.run_id,
      });
      await runPendingAsk(run.session_id);
      patch(turn.id, { dispatching: false });
    } catch (error) {
      patch(turn.id, { dispatching: false, error: error instanceof Error ? error.message : "分析未能提交，请重试" });
    } finally {
      inFlight.current = false;
      setDispatching(false);
    }
  };
  const submit = async (scope: PoolKol[], prompt: string) => {
    if (!scope.length || inFlight.current) return;
    const turn: PoolAnalysisTurn = { id: randomUuid(), kind: "analysis", scope: structuredClone(scope), prompt, dispatching: true };
    setTurns((rows) => [...rows, turn]);
    await dispatch(turn);
  };

  const runScore = async (turn: PoolScoreTurn, resume = false) => {
    if (inFlight.current) return;
    const snapshot = turn;
    inFlight.current = true;
    setScoring(true);
    setScoreConfirm(null);
    patch(turn.id, { status: "running", error: undefined });
    let results = turn.results;
    try {
      for (let offset = turn.batchesReturned * KOL_BATCH_SIZE; offset < snapshot.scope.length; offset += KOL_BATCH_SIZE) {
        const ids = snapshot.scope.slice(offset, offset + KOL_BATCH_SIZE).map((card) => card.kol_uid);
        const receipt = resume ? await resumePoolJevAssessment() : await assess(ids, snapshot.criteria);
        if (resume) await refresh();
        resume = false;
        results = [...results, ...receipt.items.filter((card) => ids.includes(card.kol_uid))];
        patch(turn.id, { results: structuredClone(results), batchesReturned: Math.floor(offset / KOL_BATCH_SIZE) + 1 });
      }
      const unavailable = snapshot.scope.filter((card) => {
        const result = results.find((item) => item.kol_uid === card.kol_uid);
        return !result?.assessment?.assessed_at || result.assessment.state === "failed";
      });
      patch(turn.id, { status: unavailable.length ? "failed" : "completed",
        error: unavailable.length ? `${unavailable.length} 位未获得评分，可确认后重试。` : undefined });
    } catch (error) {
      patch(turn.id, { status: error instanceof PoolMaintenancePendingError ? "waiting" : "failed", error: error instanceof Error ? error.message : "红人评分失败" });
    } finally {
      inFlight.current = false;
      setScoring(false);
    }
  };
  const confirmScore = async () => {
    if (!scoreConfirm || inFlight.current) return;
    const turn: PoolScoreTurn = { ...scoreConfirm, id: randomUuid(), kind: "score", status: "running", batchesReturned: 0, results: [] };
    setTurns((rows) => [...rows, turn]);
    await runScore(turn);
  };
  const retryScore = (turn: PoolScoreTurn) => {
    const succeeded = new Set(turn.results.filter((card) => card.assessment?.assessed_at && card.assessment.state !== "failed").map((card) => card.kol_uid));
    setScoreConfirm({ scope: turn.scope.filter((card) => !succeeded.has(card.kol_uid)), criteria: turn.criteria, criteriaNote: turn.criteriaNote });
  };
  const stop = async () => {
    const active = turns.filter((turn): turn is PoolAnalysisTurn => turn.kind === "analysis" && Boolean(turn.sessionId && runningSessions[turn.sessionId]));
    for (const turn of active) {
      try {
        await api.stopSession(turn.sessionId!);
        onSessionRunning(turn.sessionId!, false);
      } catch (error) {
        patch(turn.id, { error: error instanceof Error ? error.message : "停止失败" });
      }
    }
  };
  return {
    turns, scoreConfirm, setScoreConfirm, dispatching, scoring,
    running: Object.values(runningSessions).some(Boolean),
    waitingScore: turns.some((turn) => turn.kind === "score" && turn.status === "waiting"),
    submit, retryAnalysis: dispatch, confirmScore, retryScore, resumeScore: (turn: PoolScoreTurn) => runScore(turn, true), stop, onSessionRunning,
  };
}
