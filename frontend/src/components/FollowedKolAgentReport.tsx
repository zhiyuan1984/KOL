import type { FollowedKolCardModel } from "../followedKolCard";

type Props = {
  cards: FollowedKolCardModel[];
  busyId?: string | null;
  onOpenDetail: (card: FollowedKolCardModel) => void;
  onPrimary: (card: FollowedKolCardModel) => void;
  onOpenMail: (card: FollowedKolCardModel) => void;
  onCompose: (card: FollowedKolCardModel) => void;
  onConfirmStage: (card: FollowedKolCardModel) => void;
};

function textFor(card: FollowedKolCardModel): string {
  return `${card.current_state.stage_label} ${card.latest_fact.summary}`;
}

function isRefused(card: FollowedKolCardModel): boolean {
  return /拒绝|不想合作|REJECT|拒绝联系|已结束|已取消/i.test(textFor(card));
}

function isWaiting(card: FollowedKolCardModel): boolean {
  return !isRefused(card) && (card.owner === "them" || card.latest_fact.kind === "outbound" || !card.latest_fact.thread_id);
}

function isInterested(card: FollowedKolCardModel): boolean {
  return !isRefused(card) && !isWaiting(card);
}

function actionLabel(card: FollowedKolCardModel): string {
  const kind = card.recommended_action.kind;
  if (kind === "compose") return "准备回复（草稿）";
  if (kind === "confirm-send") return "确认发送";
  if (kind === "confirm-stage") return card.recommended_action.target_stage_label ? `确认进入${card.recommended_action.target_stage_label}` : "确认阶段";
  if (kind === "open-session") return "查看来信";
  if (kind === "profile") return "补充画像";
  return "查看详情";
}

function tags(card: FollowedKolCardModel, kind: "human" | "profile"): string[] {
  const source = kind === "human" ? card.follow_style_tags : card.source.profile_tags || [];
  return source.map((tag) => String(tag.label || "").trim()).filter(Boolean).slice(0, 5);
}

function Evidence({ card, onOpenMail }: { card: FollowedKolCardModel; onOpenMail: () => void }) {
  const summary = card.latest_fact.summary || "暂无最近往来总结";
  return (
    <p className="agent-report-evidence" data-kol-evidence>
      <span>证据：最近往来总结：{summary}</span>{" "}
      {card.latest_fact.thread_id ? (
        <button
          type="button"
          className="agent-report-mail-link"
          data-open-original-mail
          data-thread-id={card.latest_fact.thread_id}
          onClick={onOpenMail}
        >
          查看邮件正文 ↗
        </button>
      ) : (
        <button type="button" className="agent-report-mail-link" onClick={onOpenMail}>
          查看合作详情 ↗
        </button>
      )}
    </p>
  );
}

function DetailEntry({ card, index, busyId, onOpenDetail, onPrimary, onOpenMail, onCompose, onConfirmStage }: Props & { card: FollowedKolCardModel; index: number }) {
  const humanTags = tags(card, "human");
  const profileTags = tags(card, "profile");
  const primary = card.recommended_action.kind === "confirm-stage" ? "confirm-stage" : card.recommended_action.kind;
  const runPrimary = () => {
    if (card.recommended_action.kind === "compose" || card.recommended_action.kind === "confirm-send") onCompose(card);
    else if (card.recommended_action.kind === "confirm-stage") onConfirmStage(card);
    else onPrimary(card);
  };
  const initial = card.identity.display.replace(/^@/, "").slice(0, 1) || "红";
  return (
    <article className="agent-report-entry" data-followed-kol={card.handle} data-kol-work-card data-agent-result-entry>
      <div className="agent-report-entry-head" data-kol-band="identity">
        <span className="agent-report-index" aria-hidden>{index + 1}.</span>
        <span className="agent-report-avatar" aria-hidden>{initial}</span>
        <div className="agent-report-identity">
          <strong data-kol-identity data-kol-name>{card.identity.display}</strong>
          <span data-kol-scope>{[card.identity.platform, card.scope.brand].filter(Boolean).join(" · ") || "红人合作"}</span>
        </div>
        <span className="agent-report-count">共 {card.collaboration_count} 个合作</span>
      </div>
      <div className="agent-report-fact" data-kol-band="fact">
        <p>当前状态：{card.current_state.stage_label || "阶段未知"}</p>
        <p>合作摘要：{card.source.collab_summary || card.recommended_action.why || "暂无合作摘要"}</p>
      </div>
      <div className="agent-report-tags" data-kol-band="action">
        {humanTags.length ? <p><span>人工标签：</span>{humanTags.join("、")}</p> : null}
        {profileTags.length ? <p><span>画像标签：</span>{profileTags.join("、")}</p> : null}
        <Evidence card={card} onOpenMail={() => onOpenMail(card)} />
      </div>
      <div className="agent-report-actions" data-kol-band="cta">
        <button
          type="button"
          className="agent-report-action agent-report-action-primary"
          data-kol-primary-action={primary}
          data-agent-draft-action={card.recommended_action.kind === "compose" ? "true" : undefined}
          disabled={busyId === card.id}
          onClick={runPrimary}
        >
          {busyId === card.id ? "处理中…" : actionLabel(card)} ↗
        </button>
        <button type="button" className="agent-report-action" data-open-kol-detail onClick={() => onOpenDetail(card)}>
          查看详情 ↗
        </button>
      </div>
    </article>
  );
}

export default function FollowedKolAgentReport(props: Props) {
  const interested = props.cards.filter(isInterested).length;
  const waitingCards = props.cards.filter(isWaiting);
  const waiting = waitingCards.length;
  const refused = props.cards.filter(isRefused).length;
  return (
    <section className="followed-agent-report" data-followed-agent-report aria-label="红人合作助理结果">
      <header className="agent-report-head">
        <div className="agent-report-agent-line"><span className="agent-report-glyph" aria-hidden>✦</span>合作助理 · 示例任务</div>
        <p className="agent-report-complete" role="status">✓ 已整理 {props.cards.length} 位红人的最新互动</p>
        <h2>有 {interested} 位红人可以继续推进</h2>
        <p className="agent-report-summary">{interested} 位有兴趣，{waiting} 位待回复；另有 {refused} 位明确拒绝。</p>
      </header>
      <div className="agent-report-details" data-followed-kol-list id="followed-kol-results" data-followed-origin="collaboration">
        <h3>明细</h3>
        {props.cards.map((card, index) => <DetailEntry key={card.id} {...props} card={card} index={index} />)}
      </div>
      <div className="agent-report-next">
        <h3>下一步</h3>
        <div className="agent-report-next-links">
          {props.cards.filter(isInterested).slice(0, 3).map((card) => (
            <button key={card.id} type="button" className="agent-report-action" onClick={() => {
              if (card.recommended_action.kind === "compose" || card.recommended_action.kind === "confirm-send") props.onCompose(card);
              else if (card.recommended_action.kind === "confirm-stage") props.onConfirmStage(card);
              else props.onPrimary(card);
            }}>
              {actionLabel(card)} {card.identity.display} ↗
            </button>
          ))}
        </div>
        {waiting > 0 ? (
          <button type="button" className="agent-report-waiting" onClick={() => props.onOpenDetail(waitingCards[0])}>
            另外 {waiting} 位等待回复 ›
          </button>
        ) : null}
      </div>
    </section>
  );
}
