import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ChatThread, useSessionMessages } from "../components/ChatBlocks";
import { KOL_BATCH_SIZE } from "./kolContract";
import type { PoolAgentTurn, PoolAnalysisTurn, PoolScoreTurn } from "./usePoolAgentWorkspace";

function AnalysisSession({ turn, onRunning }: { turn: PoolAnalysisTurn; onRunning: (id: string, running: boolean) => void }) {
  const { messages, agentStatus, err, reload, sessionLoaded } = useSessionMessages(turn.sessionId);
  useEffect(() => {
    if (turn.sessionId) onRunning(turn.sessionId, agentStatus === "running");
  }, [turn.sessionId, agentStatus, onRunning]);
  useEffect(() => { if (!turn.dispatching) reload(false); }, [turn.dispatching, reload]);
  return <>
    {!messages.some((message) => message.role === "user") ? <p className="pool-agent-question">{turn.prompt}</p> : null}
    <ChatThread messages={messages} onRefresh={() => reload(false)} />
    {!messages.length && !turn.error ? <p className="pool-agent-wait" role="status">
      {turn.dispatching ? "正在提交分析任务…" : !sessionLoaded ? "正在读取分析会话…" : agentStatus === "running" ? "Agent 正在读取公开资料并分析，等待真实输出…" : "尚无分析输出，可继续原会话查看运行记录。"}
    </p> : null}
    {err ? <p role="alert">{err} <button className="btn text sm" onClick={() => reload(false)}>重新读取</button></p> : null}
    {turn.sessionId ? <Link className="pool-agent-session-link" to={`/s/${turn.sessionId}`}>继续原会话</Link> : null}
  </>;
}

export default function PoolAgentFeed({ turns, onRetryAnalysis, onRetryScore, onResumeScore, onRunning, disabled }: {
  turns: PoolAgentTurn[];
  onRetryAnalysis: (turn: PoolAnalysisTurn) => void;
  onRetryScore: (turn: PoolScoreTurn) => void;
  onResumeScore: (turn: PoolScoreTurn) => void;
  onRunning: (id: string, running: boolean) => void;
  disabled: boolean;
}) {
  return <div className="pool-agent-feed" data-pool-agent-feed>
    {!turns.length ? <p className="pool-agent-empty">从右侧选择红人，AI 将以选择结果作为分析范围。选择后可直接提问，或使用上方快捷意图。</p> : null}
    {turns.map((turn) => <section className="pool-agent-turn" key={turn.id} data-pool-agent-turn={turn.kind}>
      <div className="pool-agent-turn-scope" data-pool-history-scope>
        <strong>{turn.kind === "score" ? "红人评分" : "AI 分析"}</strong>
        <details><summary>分析范围：{turn.scope.slice(0, 3).map((card) => card.identity.display).join("、")}{turn.scope.length > 3 ? ` +${turn.scope.length - 3}` : ""}</summary>
          <ul>{turn.scope.map((card) => <li key={card.kol_uid}>{card.identity.display}</li>)}</ul>
        </details>
      </div>
      {turn.kind === "analysis" ? <>
        {turn.sessionId ? <AnalysisSession turn={turn} onRunning={onRunning} /> : <p className="pool-agent-question">{turn.prompt}</p>}
        {!turn.sessionId && turn.dispatching ? <p role="status">正在建立分析任务…</p> : null}
        {turn.error ? <p role="alert">{turn.error} <button className="btn text sm" disabled={disabled} onClick={() => onRetryAnalysis(turn)}>重试</button></p> : null}
      </> : <>
        <p className="pool-agent-score-status" role="status" data-pool-score-status>
          {turn.status === "running" ? `◌ 正在评分 · 已返回 ${turn.batchesReturned}/${Math.ceil(turn.scope.length / KOL_BATCH_SIZE)} 批次，等待评分服务回执…`
            : turn.status === "waiting" ? "◌ 评分仍在后台进行，等待回执" : turn.status === "completed" ? "✓ 红人评分已完成 · 已写入 KOL 记忆" : "⚠ 红人评分未全部完成"}
        </p>
        <p className="pool-agent-meta">{turn.criteriaNote} · 由 Jev 根据公开资料评估，结果供人工判断。</p>
        {turn.results.length ? <ul className="pool-agent-score-results" data-pool-score-results>{turn.results.map((card) => <li key={card.kol_uid} data-pool-score-result={card.kol_uid}>
          <span>{card.identity.display}</span>
          <span>{card.assessment?.state === "failed" ? "评分失败" : card.assessment?.potential_score != null ? `评分 ${card.assessment.potential_score}` : "资料不足，暂无评分"}
            {card.assessment?.state === "low_confidence" ? " · 置信度不足" : ""}</span>
        </li>)}</ul> : null}
        {turn.error ? <p role={turn.status === "waiting" ? "status" : "alert"}>{turn.error} <button className="btn text sm" disabled={disabled}
          onClick={() => turn.status === "waiting" ? onResumeScore(turn) : onRetryScore(turn)}>{turn.status === "waiting" ? "读取评分状态" : "重试"}</button></p> : null}
      </>}
    </section>)}
  </div>;
}
