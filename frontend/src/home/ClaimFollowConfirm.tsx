import { DiscoveryFollowConfirm } from "./DiscoveryFollowConfirm";
import type { PoolKol } from "./kolContract";

export default function ClaimFollowConfirm({
  card,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  card: PoolKol | null;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <DiscoveryFollowConfirm
      open={Boolean(card)}
      mode="single"
      busy={busy}
      error={error}
      title="确认领取跟进？"
      confirmLabel="确认领取"
      busyLabel="正在领取…"
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <p data-claim-object>对象：{card?.identity.display || "未指定红人"}</p>
      <p data-claim-scope>范围：从公海领取到「我跟进的红人」档案。</p>
      <p data-claim-change>变更：建立跟进归属（建联）。不会发信，也不会改正式阶段。</p>
      <p data-claim-consequence>后果：发送 ≠ 建联 ≠ 改阶段。领取成功后从公海消失，出现在跟进列表。</p>
    </DiscoveryFollowConfirm>
  );
}
