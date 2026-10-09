import { useState } from "react";
import { Avatar } from "antd";

export default function KolAvatar({ name, src, identityKey, className = "" }: { name: string; src?: string | null; identityKey?: string; className?: string }) {
  const [failedKey, setFailedKey] = useState<string>();
  const imageKey = `${identityKey || name}:${src || ""}`;
  const available = Boolean(src && failedKey !== imageKey);
  const initial = Array.from(name.replace(/^@/, "").trim())[0] || "红";
  return <Avatar className={`kol-card-avatar ${className}`} shape="square" size="small" data-kol-avatar={available ? "source" : "fallback"}
    data-avatar-source={available ? "kol" : "fallback"} aria-hidden="true"
    src={available ? <img key={imageKey} src={src!} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedKey(imageKey)} /> : undefined}>
    {initial}
  </Avatar>;
}
