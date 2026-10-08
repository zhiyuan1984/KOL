import type { CSSProperties } from "react";

export default function DiscoveryAvatar({ active = false, size = "md" }: { active?: boolean; size?: "sm" | "md" }) {
  const dimension = size === "sm" ? 24 : 32;
  const imageSize = size === "sm" ? 20 : 28;
  const style = { "--discovery-avatar-size": `${dimension}px`, "--discovery-avatar-image-size": `${imageSize}px` } as CSSProperties;
  return (
    <span className={`discovery-run-avatar discovery-run-avatar-${size}${active ? " is-active" : ""}`} aria-hidden="true" style={style}>
      {Array.from({ length: 9 }, (_, index) => (
        <img key={index + 1} src={`/avatars/lucas/Lucas${index + 1}.webp`} alt="" width={imageSize} height={imageSize} loading="eager" />
      ))}
    </span>
  );
}
