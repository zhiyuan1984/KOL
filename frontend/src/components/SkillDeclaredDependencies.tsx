import { useState } from "react";
import { api } from "../api";
import { skillDeclaredMountConfirm } from "../adminConfirm";
import {
  coverageToolStateLabel,
  errorMessage,
  mountSkipReasonLabel,
  versionConflictMessage,
  type SkillCoverageRow,
  type SkillCoverageTool,
} from "../runtimeConnectorUi";
import { useAdminConfirm } from "./ConfirmDialog";

/** 一个技能声明的工具按连接器分组；连接器 id 为空表示遗留声明（目录里没有对应连接器）。 */
function groupByConnector(tools: SkillCoverageTool[]) {
  const groups = new Map<string, { connectorId: string; label: string; tools: SkillCoverageTool[] }>();
  for (const tool of tools) {
    const key = tool.connector_id || "\u0000unknown";
    const existing = groups.get(key);
    if (existing) {
      existing.tools.push(tool);
      continue;
    }
    groups.set(key, {
      connectorId: tool.connector_id,
      label: tool.connector_label || tool.connector_id || "目录里没有对应连接器",
      tools: [tool],
    });
  }
  return [...groups.values()];
}

/**
 * 技能声明（SKILL.md 的 `mcp:`）与运行时挂载的对照。
 * 这里只读服务端的扫描结果，挂载动作走同一套确认与回执；不会顺手启用连接器或 L3 策略。
 */
export function SkillDeclaredDependencies({ skillId, row, onMounted }: {
  skillId: string;
  row: SkillCoverageRow | null;
  onMounted?: () => Promise<void> | void;
}) {
  const { ask, dialog } = useAdminConfirm();
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  if (!row) {
    return (
      <section className="skill-detail-card" data-skill-declared-dependencies="unavailable">
        <div className="skill-section-head">
          <div><h3>按技能定义的工具依赖</h3><p>这次没有读到扫描结果。下面的手工挂载不受影响。</p></div>
        </div>
      </section>
    );
  }

  if (!row.tools.length) {
    return (
      <section className="skill-detail-card" data-skill-declared-dependencies="none">
        <div className="skill-section-head">
          <div><h3>按技能定义的工具依赖</h3><p>该技能在 SKILL.md 里没有声明 MCP 工具（<code>mcp: []</code>），没有可批量挂载的依赖。</p></div>
        </div>
      </section>
    );
  }

  const groups = groupByConnector(row.tools);

  const mount = (connectorId: string, label: string, mountable: number, skipped: number) => {
    ask(skillDeclaredMountConfirm({
      connectorLabel: label,
      connectorId,
      skillCount: 1,
      toolCount: mountable,
      skippedCount: skipped,
    }), async () => {
      setBusy(connectorId);
      setError("");
      setNotice("");
      try {
        await api.mountRuntimeConnectorDeclaredTools(connectorId, { skill_ids: [skillId] });
        setNotice(`已按定义挂载“${label}”的工具；只有已登记且启用策略的声明工具会被挂上。`);
        await onMounted?.();
      } catch (cause) {
        setError(versionConflictMessage(cause) || errorMessage(cause, "按定义挂载未完成"));
      } finally {
        setBusy("");
      }
    });
  };

  return (
    <section className="skill-detail-card" data-skill-declared-dependencies={skillId}>
      {dialog}
      <div className="skill-section-head">
        <div>
          <h3>按技能定义的工具依赖</h3>
          <p>
            来自该技能 SKILL.md 的 <code>mcp:</code> 声明，对照连接器已登记工具与运行时挂载。
            声明 {row.declared_tools} 个 · 已挂载 {row.mounted_tools} 个 · 待挂载 {row.pending_tools} 个。
          </p>
        </div>
      </div>
      {notice && <p className="runtime-notice" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <p className="muted" data-skill-declared-agents>
        {row.agents.length
          ? `已挂到数字员工：${row.agents.join("、")}（${row.stage === "published" ? "已发布" : "未发布"}）。`
          : "该技能还没有挂到任何数字员工：可以按定义登记挂载，但员工侧暂时不会走到它。"}
      </p>
      <div className="skill-declared-groups">
        {groups.map((group) => {
          const mountable = group.tools.filter((tool) => tool.state === "available").length;
          const skipped = group.tools.length - group.tools.filter((tool) => tool.state === "mounted" || tool.state === "available").length;
          const connectorState = group.tools[0];
          return (
            <article className="skill-declared-group" key={group.connectorId || "unknown"} data-skill-declared-connector={group.connectorId || "unknown"}>
              <div className="skill-declared-group-head">
                <div>
                  <strong>{group.label}</strong>
                  <p className="muted">
                    {group.connectorId ? <code>{group.connectorId}</code> : "未登记连接器"}
                    {connectorState.connector_status ? ` · 连接器状态 ${connectorState.connector_status}` : ""}
                    {connectorState.connector_enabled === false ? "（未启用）" : connectorState.connector_enabled ? "（已启用）" : ""}
                  </p>
                </div>
                <button
                  type="button"
                  className="skill-governance-secondary"
                  data-skill-declared-mount={group.connectorId || "unknown"}
                  disabled={!group.connectorId || mountable === 0 || busy === group.connectorId}
                  onClick={() => mount(group.connectorId, group.label, mountable, skipped)}
                >
                  {busy === group.connectorId ? "挂载中…" : mountable ? `按定义挂载（${mountable} 个）` : "没有可挂载的登记工具"}
                </button>
              </div>
              <ul className="skill-declared-tools">
                {group.tools.map((tool) => (
                  <li key={tool.declared_as} data-skill-declared-tool={tool.tool_name} data-state={tool.state}>
                    <code>{tool.tool_name}</code>
                    <span className="muted">
                      {coverageToolStateLabel(tool.state)}
                      {tool.policy_risk ? ` · ${tool.policy_risk}` : ""}
                      {tool.state === "blocked_by_policy" ? ` · ${mountSkipReasonLabel("policy_disabled")}` : ""}
                      {tool.state === "unregistered" ? ` · ${mountSkipReasonLabel("policy_unregistered")}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="muted">
                可一键挂载 {mountable} 个；工具必须先在连接器详情完成一次通过的测试才会登记，
                声明之外的连接器工具不会被顺手挂上。
              </p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
