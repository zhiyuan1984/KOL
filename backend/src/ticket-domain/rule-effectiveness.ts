import { postgresPool } from "../postgres/pool.js";
import type { Json } from "../types.js";

type RuleEffectivenessRow = {
  rule_id: string;
  rule_version: number | string;
  title: string;
  rule_type: string;
  rule_status: string;
  published_at: string | null;
  evaluations: number | string;
  distinct_events: number | string;
  linked_tickets: number | string;
  matched: number | string;
  skipped: number | string;
  missing_fields: number | string;
  failed: number | string;
};

function bounded(value: number | undefined): number {
  return Math.min(Math.max(1, Math.floor(value || 100)), 200);
}

function count(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

/**
 * Raw governance counts only. A matched evaluation is a pending human
 * suggestion, never evidence of a completed assignment/escalation/ticket.
 * Confirmation decisions are intentionally reported as not recorded until an
 * explicit human-decision contract exists.
 */
export async function schedulingRuleEffectivenessRawReport(limit?: number): Promise<Json> {
  const rows = await postgresPool().query<RuleEffectivenessRow>(
    `SELECT rule.id AS rule_id,rule.version AS rule_version,rule.title,rule.rule_type,
            rule.status AS rule_status,rule.published_at,
            COUNT(evaluation.id)::int AS evaluations,
            COUNT(DISTINCT evaluation.source_event_id)::int AS distinct_events,
            COUNT(DISTINCT evaluation.ticket_id)::int AS linked_tickets,
            COUNT(*) FILTER (WHERE evaluation.outcome='matched')::int AS matched,
            COUNT(*) FILTER (WHERE evaluation.outcome='skipped')::int AS skipped,
            COUNT(*) FILTER (WHERE evaluation.outcome='missing_fields')::int AS missing_fields,
            COUNT(*) FILTER (WHERE evaluation.outcome='failed')::int AS failed
       FROM scheduling_rules rule
       LEFT JOIN ticket_rule_evaluations evaluation
         ON evaluation.rule_id=rule.id AND evaluation.rule_version=rule.version
      GROUP BY rule.id,rule.version,rule.title,rule.rule_type,rule.status,rule.published_at
      ORDER BY CASE rule.status WHEN 'published' THEN 0 WHEN 'draft' THEN 1 WHEN 'disabled' THEN 2 ELSE 3 END,
               rule.published_at DESC NULLS LAST,rule.id,rule.version DESC
      LIMIT $1`,
    [bounded(limit)],
  );
  const rules = rows.rows.map((row) => {
    const matched = count(row.matched);
    return {
      rule_id: row.rule_id,
      rule_version: count(row.rule_version),
      title: row.title,
      rule_type: row.rule_type,
      rule_status: row.rule_status,
      published_at: row.published_at,
      evaluations: count(row.evaluations),
      distinct_events: count(row.distinct_events),
      linked_tickets: count(row.linked_tickets),
      by_outcome: {
        matched,
        skipped: count(row.skipped),
        missing_fields: count(row.missing_fields),
        failed: count(row.failed),
      },
      manual_confirmation: {
        matched_pending: matched,
        confirmations_recorded: null,
        coverage_status: "not_recorded",
      },
      execution_effect: "none",
    };
  });
  const totals = rules.reduce((accumulator, rule) => ({
    rules: accumulator.rules + 1,
    evaluations: accumulator.evaluations + rule.evaluations,
    distinct_events: accumulator.distinct_events + rule.distinct_events,
    matched: accumulator.matched + rule.by_outcome.matched,
    skipped: accumulator.skipped + rule.by_outcome.skipped,
    missing_fields: accumulator.missing_fields + rule.by_outcome.missing_fields,
    failed: accumulator.failed + rule.by_outcome.failed,
  }), { rules: 0, evaluations: 0, distinct_events: 0, matched: 0, skipped: 0, missing_fields: 0, failed: 0 });
  return {
    report_version: "scheduling-rule-effectiveness-raw.v1",
    as_of: new Date().toISOString(),
    source: "postgresql_ticket_rule_evaluations",
    timezone: "UTC",
    rules,
    totals,
    note: "仅统计已持久化的规则评估原始计数。matched 表示待人工确认建议；当前未记录人工确认决定，不推导自动执行、SLA、绩效、命中率或完成率。",
  };
}
