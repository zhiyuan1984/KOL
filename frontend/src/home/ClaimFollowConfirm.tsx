import type { PoolKol } from "./kolContract";

/** L3 领取确认留在对象行内，确认前不提交归属变更。 */
export default function ClaimFollowConfirm({ card, busy = false, error, onConfirm, onCancel }: {
  card: PoolKol | null; busy?: boolean; error?: string | null;
  onConfirm: () => void; onCancel: () => void;
}) {
  if (!card) return null;
  return <div className="pool-claim-confirm" data-claim-follow-confirm>
    <span data-claim-object>确认领取 {card.identity.display} 到我的跟进？不会发信，也不会改正式阶段。</span>
    <button type="button" data-claim-follow-yes data-home-entry="claim-kol" disabled={busy}
      onClick={onConfirm}>{busy ? "正在领取…" : "确认领取"}</button>
    <button type="button" data-claim-follow-no disabled={busy} onClick={onCancel}>取消</button>
    {error && <p data-claim-follow-error role="alert">{error}</p>}
  </div>;
}
