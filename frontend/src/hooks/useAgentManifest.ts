import { useEffect, useState } from "react";
import { api, type AgentManifestView } from "../api";

let cached: AgentManifestView | null = null;
let pending: Promise<AgentManifestView> | null = null;

export function useAgentManifest() {
  const [manifest, setManifest] = useState<AgentManifestView | null>(cached);
  useEffect(() => {
    if (!pending) pending = api.agentManifest().then((value) => { cached = value; return value; });
    let active = true;
    void pending.then((value) => { if (active) setManifest(value); }).catch(() => { if (active) setManifest(null); });
    return () => { active = false; };
  }, []);
  return manifest;
}
