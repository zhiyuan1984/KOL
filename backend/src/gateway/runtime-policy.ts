/**
 * Physical lower bound for existing Host-owned side effects. Runtime governance
 * may tighten this floor but cannot relabel these actions as L1/L2 to bypass it.
 * This is authorization policy, not an implementation of business tools.
 */
const HOST_ONLY_TOOLS = new Set([
  "sendEmailNow", "changeLifecycleStage", "decryptKolContact",
  "importKolProfilesFromCrawler", "importKolProfilesV2", "upload_creators", "updateKolProfile", "addKolProfile",
  "clear_history", "deleteKol", "deleteKolProfile", "send_mail", "wecom_send",
  "confirm_stage", "starry_stage", "ingest", "start_crawl", "stop_crawl", "follow",
].map((name) => name.replace(/[^a-z0-9]/gi, "").toLowerCase()));

export function runtimeHostOnlyTool(name: string): boolean {
  const bare = name.split(/[.:/]/).at(-1) || name;
  return HOST_ONLY_TOOLS.has(bare.replace(/[^a-z0-9]/gi, "").toLowerCase());
}
