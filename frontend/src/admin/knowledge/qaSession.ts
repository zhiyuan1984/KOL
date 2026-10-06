import {
  QA_COMPRESSION_TURNS,
  QA_CONTEXT_VERSION,
  QA_LAST_ANSWER_LIMIT,
  QA_SUMMARY_LIMIT,
  QA_TURN_WINDOW,
  qaScopeKey,
} from "../../../../shared/knowledge-qa.js";
import type {
  QaCitation,
  QaContext,
  QaMaintenanceInput,
  QaMaintenanceResult,
  QaScope,
  QaTurn,
} from "../../../../shared/knowledge-qa.js";

export { qaScopeKey };

export type QaSessionTurn = QaTurn & {
  seq: number;
  /** 实际送给检索器的问句；原始问句仍保留在 query。 */
  effective_query: string;
};

export type QaSession = {
  summary: string;
  foldedThroughSeq: number;
  turnsSinceCompression: number;
  turns: QaSessionTurn[];
};

export type QaCurrentTurn = {
  query: string;
  answer: string;
  citations: QaCitation[];
  effectiveQuery?: string;
};

export type QaMaintenancePlan = {
  input: QaMaintenanceInput;
  current: QaSessionTurn;
  summaryBeforeMaintenance: string;
  foldedThroughSeq: number;
  turnsSinceCompression: number;
  compress: boolean;
};

export type QaMaintenanceFailure = {
  session: QaSession;
  degradedSummary: boolean;
};

function compact(text: string) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function unique(values: string[]) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()))];
}

function copyCitations(citations: QaCitation[]) {
  return citations.map((citation) => ({ ...citation }));
}

/** R1：确定性折叠，不调用模型，也不改写提问或回答。 */
export function qaR1Fold(turn: Pick<QaTurn, "query" | "answer" | "entities">): string {
  const answer = compact(turn.answer);
  const end = answer.search(/[。！？!?.]/u);
  const firstSentence = end >= 0 ? answer.slice(0, end + 1) : answer;
  const entities = unique(turn.entities || []);
  const parts = [
    `问：${compact(turn.query) || "（空问题）"}`,
    `答：${firstSentence || "（空回答）"}`,
  ];
  if (entities.length) parts.push(`实体：${entities.join("、")}`);
  return parts.join("\n");
}

function appendFold(summary: string, turn: QaSessionTurn | undefined) {
  if (!turn) return summary;
  const folded = qaR1Fold(turn);
  return summary ? `${summary}\n${folded}` : folded;
}

function latestSummaryTail(summary: string) {
  if (summary.length <= QA_SUMMARY_LIMIT) return summary;
  return summary.slice(-QA_SUMMARY_LIMIT);
}

function copyTurnForContext(turn: QaSessionTurn): QaTurn {
  return {
    query: turn.query,
    // 截断只作用在重写/检索上下文；会话明细和维护请求始终保留完整回答。
    answer: turn.answer.slice(0, QA_LAST_ANSWER_LIMIT),
    entities: [...turn.entities],
    citations: copyCitations(turn.citations),
  };
}

export function createQaSession(): QaSession {
  return { summary: "", foldedThroughSeq: 0, turnsSinceCompression: 0, turns: [] };
}

export function qaRecentTurns(session: QaSession): QaSessionTurn[] {
  return session.turns.slice(-QA_TURN_WINDOW);
}

/** 构造当前检索调用的会话上下文；首轮刻意传递 null + 空摘要。 */
export function qaSearchContext(session: QaSession, scope: QaScope): QaContext {
  const last = session.turns.at(-1);
  return {
    version: QA_CONTEXT_VERSION,
    scope: {
      base_id: scope.base_id,
      ...(scope.doc_ids?.length ? { doc_ids: [...scope.doc_ids] } : {}),
      ...(scope.include_pending ? { include_pending: true } : {}),
    },
    last_turn: last ? copyTurnForContext(last) : null,
    history_summary: session.summary,
  };
}

/**
 * 搜索回答成功后计划维护。前一轮立即折入 R1 摘要；当前轮直到维护结束才成为 last_turn。
 * 所有明细一直保留，压缩只作用于传给下一轮的摘要。
 */
export function planQaMaintenance(
  session: QaSession,
  scope: QaScope,
  current: QaCurrentTurn,
): QaMaintenancePlan {
  const previous = session.turns.at(-1);
  const mustFold = Boolean(previous && previous.seq > session.foldedThroughSeq);
  const summaryBeforeMaintenance = mustFold ? appendFold(session.summary, previous) : session.summary;
  const foldedThroughSeq = mustFold && previous ? previous.seq : session.foldedThroughSeq;
  const turnsSinceCompression = session.turnsSinceCompression + (mustFold ? 1 : 0);
  const compress = summaryBeforeMaintenance.length > QA_SUMMARY_LIMIT
    || turnsSinceCompression > QA_COMPRESSION_TURNS;
  const seq = (session.turns.at(-1)?.seq || 0) + 1;
  const turn: QaSessionTurn = {
    seq,
    query: current.query,
    answer: current.answer,
    entities: [],
    citations: copyCitations(current.citations),
    effective_query: current.effectiveQuery || current.query,
  };

  return {
    input: {
      scope: {
        base_id: scope.base_id,
        ...(scope.doc_ids?.length ? { doc_ids: [...scope.doc_ids] } : {}),
        ...(scope.include_pending ? { include_pending: true } : {}),
      },
      // entities 必须由维护端从完整 answer 提取，不能填入 rewrite 的 resolved_entities。
      turn: {
        query: turn.query,
        answer: turn.answer,
        entities: [],
        citations: copyCitations(turn.citations),
      },
      ...(turn.effective_query !== turn.query ? { effective_query: turn.effective_query } : {}),
      history_summary: summaryBeforeMaintenance,
      ...(compress ? { compress: true } : {}),
    },
    current: turn,
    summaryBeforeMaintenance,
    foldedThroughSeq,
    turnsSinceCompression,
    compress,
  };
}

export function commitQaMaintenance(plan: QaMaintenancePlan, result: QaMaintenanceResult): QaSession {
  const current: QaSessionTurn = {
    ...plan.current,
    entities: unique(result.entities || []),
    citations: copyCitations(plan.current.citations),
  };
  return {
    // 后端契约保证此摘要是 bounded summary；前端不以本地规则重写它。
    summary: String(result.history_summary || ""),
    foldedThroughSeq: plan.foldedThroughSeq,
    turnsSinceCompression: result.compressed ? 0 : plan.turnsSinceCompression,
    turns: [current],
  };
}

/**
 * 把维护结果合并到指定旧会话。单独导出便于组件在网络响应回到原会话时避免闭包陈旧。
 */
export function applyQaMaintenance(
  session: QaSession,
  plan: QaMaintenancePlan,
  result: QaMaintenanceResult,
): QaSession {
  if (plan.current.seq <= (session.turns.at(-1)?.seq || 0)) return session;
  const committed = commitQaMaintenance(plan, result);
  return { ...committed, turns: [...session.turns, committed.turns.at(-1)!].slice(-QA_TURN_WINDOW) };
}

/** 维护或压缩失败时仍追加已成功回答；压缩场景以最新 1500 字符作为明确的有界保底。 */
export function failQaMaintenance(session: QaSession, plan: QaMaintenancePlan): QaMaintenanceFailure {
  if (plan.current.seq <= (session.turns.at(-1)?.seq || 0)) {
    return { degradedSummary: false, session };
  }
  const degradedSummary = plan.compress;
  const summary = degradedSummary ? latestSummaryTail(plan.summaryBeforeMaintenance) : plan.summaryBeforeMaintenance;
  return {
    degradedSummary,
    session: {
      summary,
      foldedThroughSeq: plan.foldedThroughSeq,
      // 压缩失败不能假装已压缩；下一次折叠仍会重试压缩。
      turnsSinceCompression: plan.turnsSinceCompression,
      // 压缩失败也不能清空明细；保留当前窗口，供下一轮与诊断继续使用。
      turns: [...session.turns, plan.current].slice(-QA_TURN_WINDOW),
    },
  };
}
