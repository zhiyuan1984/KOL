import { useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { EmailCard, Message, TaskResultCard } from "../api";
import {
  ConfirmStageArtifact,
  DraftArtifact,
  emailMarkdown,
  type DraftEdit,
  InboundArtifact,
  KolMailCard,
  OverdueArtifact,
  SupplementArtifact,
} from "./ChatBlocks";
import CrawlArtifact, { crawlCandidates } from "./CrawlArtifact";
import Markdown from "./Markdown";
import { ResultActions, GenericResultArtifact, composeResultActions, isComposeResultCard } from "./ResultArtifact";
import { officialStageReached } from "../journey";
import { stageLabel } from "../labels";

export type StreamArtifactContext = {
  sessionId: string;
  messages: Message[];
  officialStage?: string;
  collaborationId?: string;
  handle?: string;
  onRefresh: () => void;
  onPosted: (messages: Message[]) => void;
  onPrefill?: (text: string) => void;
};

/** 智能体产出的卡片（结果、草稿、阶段确认、来信、补全）在中栏时间流里各自出现在产生的时刻。 */
export const STREAM_ARTIFACT_KINDS = new Set([
  "task_result_card",
  "email_card",
  "confirm_stage_card",
  "kol_mail_card",
  "inbound_card",
  "supplement_card",
]);

function lastIdOf(messages: Message[], match: (message: Message) => boolean): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (match(messages[index])) return messages[index].id;
  }
  return undefined;
}

export function resultCardOf(message: Message): TaskResultCard {
  const payload = message.payload as Record<string, unknown>;
  const embedded = (payload.task_result && typeof payload.task_result === "object" && payload.task_result)
    || (payload.crawl_result && typeof payload.crawl_result === "object" && payload.crawl_result);
  return (embedded || payload) as TaskResultCard;
}

/** 只有最新、且其后没有草稿或写邮件结果的补全卡还可以填写；更早的补全只保留说明。 */
function activeSupplementId(messages: Message[]): string | undefined {
  const ship = lastIdOf(messages, (message) => message.kind === "supplement_card");
  if (!ship) return undefined;
  const shipIndex = messages.findIndex((message) => message.id === ship);
  const composedAfter = messages.slice(shipIndex + 1).some((message) => message.kind === "email_card"
    || (message.kind === "task_result_card" && isComposeResultCard(resultCardOf(message))));
  return composedAfter ? undefined : ship;
}

function SupersededNote({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <details className="artifact stream-superseded" data-stream-superseded>
      <summary>{title}</summary>
      {children}
    </details>
  );
}

/**
 * 返回某条消息在时间流里的完整卡片：undefined 表示它不是卡片（按普通消息渲染），
 * null 表示这一条不用显示。只有最新的草稿与阶段确认卡可以操作，更早的折叠成只读记录，
 * 避免员工在历史里误发旧稿或确认过期的阶段。
 */
export function useStreamArtifacts(ctx: StreamArtifactContext): (message: Message) => ReactNode | undefined {
  const edits = useRef({ sessionId: ctx.sessionId, drafts: new Map<string, DraftEdit>() });
  if (edits.current.sessionId !== ctx.sessionId) edits.current = { sessionId: ctx.sessionId, drafts: new Map<string, DraftEdit>() };
  const { messages } = ctx;
  const latestDraftId = lastIdOf(messages, (message) => message.kind === "email_card");
  const latestStageId = lastIdOf(messages, (message) => message.kind === "confirm_stage_card");
  const supplementId = activeSupplementId(messages);

  return (message: Message) => {
    const payload = message.payload as Record<string, unknown>;
    if (message.kind === "task_result_card") {
      const card = resultCardOf(message);
      const candidates = crawlCandidates(card, payload);
      if (candidates.length) {
        return (
          <CrawlArtifact
            job={null}
            events={[]}
            candidates={candidates}
            busy={false}
            error=""
            onStart={async () => undefined}
            onStop={async () => undefined}
            onPrefill={ctx.onPrefill || (() => undefined)}
            showControls={false}
          />
        );
      }
      const compose = isComposeResultCard(card);
      const index = messages.findIndex((row) => row.id === message.id);
      const draftFollows = messages.slice(index + 1).some((row) => row.kind === "email_card");
      return (
        <section data-compose-loop={compose ? "true" : undefined}>
          <GenericResultArtifact
            card={card}
            sessionId={ctx.sessionId}
            onPrefill={ctx.onPrefill}
            stacked={compose}
            collaborationId={ctx.collaborationId}
            handle={ctx.handle}
            onRefresh={ctx.onRefresh}
          />
          {compose && (!draftFollows || Boolean(card.compose_loop?.gap?.field)) ? (
            <ResultActions
              actions={composeResultActions(card, card.recommended_actions || card.actions || [])}
              sessionId={ctx.sessionId}
              onPrefill={ctx.onPrefill}
            />
          ) : null}
        </section>
      );
    }
    if (message.kind === "email_card") {
      const card = payload as unknown as EmailCard;
      if (message.id === latestDraftId) {
        return <DraftArtifact card={card} onRefresh={ctx.onRefresh} edits={edits.current.drafts} />;
      }
      const sent = String(card.status || "") === "sent";
      return (
        <SupersededNote title={`${sent ? "已发送的邮件" : "早先的草稿（已被新版替代）"} · ${card.subject || "无主题"}`}>
          <Markdown>{emailMarkdown(card)}</Markdown>
        </SupersededNote>
      );
    }
    if (message.kind === "confirm_stage_card") {
      const proposed = String(payload.proposed_stage || "");
      const label = stageLabel(proposed) || proposed || "具体阶段";
      if (payload.rejected) return <SupersededNote title={`阶段建议 · ${label} · 已驳回，正式阶段未改`} />;
      if (payload.resolved || officialStageReached(ctx.officialStage, proposed)) {
        return <SupersededNote title={`阶段建议 · ${label} · 已写入正式阶段`} />;
      }
      if (message.id !== latestStageId) return <SupersededNote title={`早先的阶段建议 · ${label}（已被新的建议替代）`} />;
      return <ConfirmStageArtifact payload={payload} sessionId={ctx.sessionId} onRefresh={ctx.onRefresh} />;
    }
    if (message.kind === "kol_mail_card") {
      return (
        <KolMailCard
          payload={payload}
          sessionId={ctx.sessionId}
          officialStage={ctx.officialStage}
          onRefresh={ctx.onRefresh}
          createdAt={message.created_at}
          messageId={message.id}
          showSubject
        />
      );
    }
    if (message.kind === "inbound_card") return <InboundArtifact payload={payload} onRefresh={ctx.onRefresh} />;
    if (message.kind === "supplement_card") {
      const fields = Array.isArray(payload.fields) ? payload.fields : [];
      if (message.id !== supplementId || !fields.length) return undefined;
      return <SupplementArtifact payload={payload} sessionId={ctx.sessionId} onPosted={ctx.onPosted} />;
    }
    if (message.kind === "steps" && String(payload.title || "").includes("失联")) return <OverdueArtifact payload={payload} />;
    if (typeof payload.approval_id === "string" && payload.approval_id) {
      return (
        <article className="artifact" data-kind="approval-line">
          <Markdown>{`### 费用审批\n\n${String(payload.text || "请到「工作审批」处理。")}\n\n> 审批人由规则引擎计算。中间档同意不执行副作用。`}</Markdown>
          <p><Link to={`/approvals?id=${payload.approval_id}`}>打开工作审批</Link></p>
        </article>
      );
    }
    return undefined;
  };
}
