/** Existing Lucas assets provide active animation and a static completed frame.
 * Reduced motion always uses PNG, including during execution. */
export default function AgentAvatar({ active = false, failed = false, completed = false, frame, className = "" }: {
  active?: boolean; failed?: boolean; completed?: boolean; frame?: number; className?: string;
}) {
  const image = frame || (failed ? 8 : active ? 6 : completed ? 9 : 1);
  return <picture className={`workspace-agent-avatar ${className}`} aria-hidden="true" data-agent-avatar={active ? "active" : "static"}>
    <source media="(prefers-reduced-motion: reduce)" srcSet={`/avatars/lucas/Lucas${image}.png`} />
    <img src={`/avatars/lucas/Lucas${image}.${active ? "webp" : "png"}`} alt="" />
  </picture>;
}
