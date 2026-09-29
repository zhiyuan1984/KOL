import { useState } from "react";
import { api } from "../../api";
import { skillDeclaredMountConfirm } from "../../adminConfirm";
import type { AskAdminConfirm } from "../../components/ConfirmDialog";
import {
  errorMessage,
  mountableDeclaredCount,
  versionConflictMessage,
  type SkillCoverage,
} from "../../runtimeConnectorUi";

/**
 * 「按技能定义挂载工具」的唯一实现：扫描 → 确认 → 写入 → 回执。
 * 只做挂载，不启用连接器、不改工具策略；跳过项由服务端权威判定并回报。
 */
export function useDeclaredToolMount({ ask, connectorId, connectorLabel, skillIds, onDone }: {
  ask: AskAdminConfirm;
  connectorId: string | null;
  connectorLabel: string;
  /** 省略＝按服务端默认口径（扫描出的已上线技能）。 */
  skillIds?: string[];
  onDone?: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState("");
  const [failure, setFailure] = useState("");

  const mount = () => {
    if (!connectorId) return;
    void (async () => {
      // 先扫描出「将要挂多少」，把数量和跳过项写进确认框；读不到就不编数字。
      let skillCount = 0;
      let toolCount = 0;
      let skippedCount = 0;
      try {
        const coverage: SkillCoverage = await api.runtimeSkillCoverage(connectorId);
        const rows = coverage.skills.filter((row) => row.implementation === "live");
        skillCount = rows.length;
        toolCount = rows.reduce((sum, row) => sum + mountableDeclaredCount(row), 0);
        skippedCount = rows.reduce((sum, row) => sum + row.pending_tools, 0) - toolCount;
      } catch {
        // 扫描失败不阻止动作：服务端仍按同一口径执行，确认框不写未读到的数字。
      }
      ask(skillDeclaredMountConfirm({ connectorLabel, connectorId, skillCount, toolCount, skippedCount }), async () => {
        setBusy(true);
        setFailure("");
        setReceipt("");
        try {
          const result = await api.mountRuntimeConnectorDeclaredTools(connectorId, skillIds ? { skill_ids: skillIds } : {});
          const { mounted_tools: mounted, unchanged_tools: unchanged, skipped_tools: skipped, skills } = result.summary;
          setReceipt(mounted
            ? `已按技能定义挂载：${mounted} 个工具挂到 ${skills} 个技能（${unchanged} 个原本已挂载，${skipped} 个跳过）。`
            : `没有新增挂载：${unchanged} 个原本已挂载，${skipped} 个跳过。请检查技能声明与工具策略。`);
          await onDone?.();
        } catch (cause) {
          setFailure(versionConflictMessage(cause) || errorMessage(cause, "按定义挂载未完成"));
        } finally {
          setBusy(false);
        }
      });
    })();
  };

  return { mount, busy, receipt, failure, clear: () => { setReceipt(""); setFailure(""); } };
}
