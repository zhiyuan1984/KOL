import { DiscoveryFollowConfirm } from "./DiscoveryFollowConfirm";

export default function ReleaseFollowConfirm({
  handle,
  open,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  handle?: string;
  open: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <DiscoveryFollowConfirm
      open={open}
      mode="single"
      busy={busy}
      error={error}
      title="确认回公海？"
      confirmLabel="确认释放"
      busyLabel="正在释放…"
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <p data-release-object>对象：{handle ? `@${handle.replace(/^@/, "")}` : "未指定红人"}</p>
      <p data-release-scope>范围：释放「我跟进的红人」归属，档案回到公海。</p>
      <p data-release-change>变更：B.active → released。不会改正式阶段。</p>
      <p data-release-consequence>后果：回公海 ≠ 改阶段。发送记录与阶段保持原样。</p>
    </DiscoveryFollowConfirm>
  );
}
