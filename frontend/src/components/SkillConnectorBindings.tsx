import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import {
  errorMessage,
  policyKey,
  type RuntimeSkillConnector,
  type RuntimeSkillTool,
  type RuntimeToolPolicy,
  versionConflictMessage,
} from "../runtimeConnectorUi";

type ConnectorRecord = { id?: unknown; label?: unknown; enabled?: unknown };

type ConnectorOption = { id: string; label: string; enabled: boolean };

function connectorOptions(rows: ConnectorRecord[]): ConnectorOption[] {
  return rows
    .map((row) => ({ id: String(row.id || ""), label: String(row.label || row.id || "未命名连接器"), enabled: row.enabled !== false }))
    .filter((row) => row.id)
    .sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
}

function bindingKey(connectorId: string, toolName: string) {
  return policyKey(connectorId, toolName);
}

function riskLabel(risk: RuntimeToolPolicy["risk"]) {
  if (risk === "L3") return "L3 · 确认闸门";
  if (risk === "L2") return "L2 · 草稿";
  return "L1 · 只读";
}

export function SkillConnectorBindings({ skillId }: { skillId: string }) {
  const [connectors, setConnectors] = useState<ConnectorOption[]>([]);
  const [connectorBindings, setConnectorBindings] = useState<RuntimeSkillConnector[]>([]);
  const [toolBindings, setToolBindings] = useState<RuntimeSkillTool[]>([]);
  const [policies, setPolicies] = useState<RuntimeToolPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingError, setLoadingError] = useState("");
  const [notice, setNotice] = useState("");
  const [writeError, setWriteError] = useState("");
  const [busyKey, setBusyKey] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadingError("");
    const initial = await Promise.allSettled([
      api.adminConnectors(),
      api.runtimeSkillConnectors(skillId),
      api.runtimeSkillTools(skillId),
    ]);
    const connectorResult = initial[0];
    const connectorBindingResult = initial[1];
    const toolBindingResult = initial[2];
    const errors: string[] = [];
    if (connectorResult.status === "fulfilled") setConnectors(connectorOptions(connectorResult.value));
    else errors.push(errorMessage(connectorResult.reason, "无法读取连接器目录"));
    if (connectorBindingResult.status === "fulfilled") setConnectorBindings(connectorBindingResult.value);
    else errors.push(errorMessage(connectorBindingResult.reason, "无法读取 Skill 连接器绑定"));
    if (toolBindingResult.status === "fulfilled") setToolBindings(toolBindingResult.value);
    else errors.push(errorMessage(toolBindingResult.reason, "无法读取 Skill 工具绑定"));

    if (connectorResult.status === "fulfilled") {
      const catalog = connectorOptions(connectorResult.value);
      const policyResults = await Promise.allSettled(catalog.map((connector) => api.runtimeConnectorPolicies(connector.id)));
      const received: RuntimeToolPolicy[] = [];
      policyResults.forEach((result, index) => {
        if (result.status === "fulfilled") received.push(...result.value);
        else errors.push(`${catalog[index].label}：${errorMessage(result.reason, "无法读取工具策略")}`);
      });
      setPolicies(received);
    }
    if (errors.length) setLoadingError(errors.join("；"));
    setLoading(false);
  }, [skillId]);

  useEffect(() => {
    void load();
  }, [load]);

  const connectorsById = useMemo(() => new Map(connectors.map((connector) => [connector.id, connector])), [connectors]);
  const connectorBindingById = useMemo(() => new Map(connectorBindings.map((binding) => [binding.connector_id, binding])), [connectorBindings]);
  const toolBindingByKey = useMemo(() => new Map(toolBindings.map((binding) => [bindingKey(binding.connector_id, binding.tool_name), binding])), [toolBindings]);
  const policiesByConnector = useMemo(() => {
    const grouped = new Map<string, RuntimeToolPolicy[]>();
    for (const policy of policies) grouped.set(policy.connector_id, [...(grouped.get(policy.connector_id) || []), policy]);
    grouped.forEach((rows) => rows.sort((left, right) => left.tool_name.localeCompare(right.tool_name)));
    return grouped;
  }, [policies]);

  const saveConnector = async (connectorId: string, enabled: boolean) => {
    const current = connectorBindingById.get(connectorId);
    const previous = connectorBindings;
    const optimistic: RuntimeSkillConnector = {
      skill_id: skillId,
      connector_id: connectorId,
      enabled,
      version: current ? current.version + 1 : 1,
    };
    setConnectorBindings((rows) => [...rows.filter((row) => row.connector_id !== connectorId), optimistic]);
    setBusyKey(`connector:${connectorId}`);
    setWriteError("");
    try {
      const saved = await api.saveRuntimeSkillConnector(skillId, connectorId, { enabled, expected_version: current?.version ?? 0 });
      setConnectorBindings((rows) => [...rows.filter((row) => row.connector_id !== connectorId), saved]);
      setNotice(enabled
        ? "连接器已显式挂到该 Skill。还必须逐项选择已审批工具；未来新增工具不会自动获得权限。"
        : "连接器已从该 Skill 停用；已有逐工具记录会保留，重新启用后仍需审阅。 ");
    } catch (cause) {
      setConnectorBindings(previous);
      setWriteError(versionConflictMessage(cause) || errorMessage(cause, "Skill 连接器绑定未保存"));
    } finally {
      setBusyKey("");
    }
  };

  const saveTool = async (policy: RuntimeToolPolicy, enabled: boolean) => {
    const key = bindingKey(policy.connector_id, policy.tool_name);
    const current = toolBindingByKey.get(key);
    const previous = toolBindings;
    const optimistic: RuntimeSkillTool = {
      skill_id: skillId,
      connector_id: policy.connector_id,
      tool_name: policy.tool_name,
      enabled,
      version: current ? current.version + 1 : 1,
    };
    setToolBindings((rows) => [...rows.filter((row) => bindingKey(row.connector_id, row.tool_name) !== key), optimistic]);
    setBusyKey(`tool:${key}`);
    setWriteError("");
    try {
      const saved = await api.saveRuntimeSkillTool(skillId, policy.connector_id, policy.tool_name, {
        enabled,
        expected_version: current?.version ?? 0,
      });
      setToolBindings((rows) => [...rows.filter((row) => bindingKey(row.connector_id, row.tool_name) !== key), saved]);
      setNotice(enabled
        ? `工具“${policy.tool_name}”已精确挂到该 Skill。`
        : `工具“${policy.tool_name}”已从该 Skill 移除。`);
    } catch (cause) {
      setToolBindings(previous);
      setWriteError(versionConflictMessage(cause) || errorMessage(cause, "Skill 工具绑定未保存"));
    } finally {
      setBusyKey("");
    }
  };

  return (
    <section className="skill-connector-bindings" aria-labelledby="skill-connector-bindings-heading" data-skill-tool-bindings={skillId}>
      <div className="runtime-section-heading">
        <div>
          <h3 id="skill-connector-bindings-heading">工具挂载</h3>
          <p className="muted">Skill → 连接器 → 已审批工具。连接器勾选不授予未来工具；每个工具必须单独选择。</p>
        </div>
        <button type="button" className="btn sm" onClick={() => void load()} disabled={loading}>刷新</button>
      </div>
      {loading && <p className="muted" role="status">正在读取连接器、审批工具与 Skill 挂载…</p>}
      {loadingError && <div className="runtime-state runtime-state-error" role="alert"><strong>无法完整加载工具挂载</strong><span>{loadingError}</span><button type="button" className="btn sm" onClick={() => void load()}>重试</button></div>}
      {notice && <p className="runtime-notice" role="status">{notice}</p>}
      {writeError && <p className="error" role="alert">{writeError}</p>}
      {!loading && !connectors.length && !loadingError && <div className="runtime-state"><strong>暂无连接器</strong><span>请先在“连接器枢纽”创建并保存连接器配置。</span></div>}
      <div className="skill-binding-list">
        {connectors.map((connector) => {
          const binding = connectorBindingById.get(connector.id);
          const mounted = binding?.enabled === true;
          const policiesForConnector = policiesByConnector.get(connector.id) || [];
          const approved = policiesForConnector.filter((policy) => policy.enabled);
          const uncheckedApproved = approved.filter((policy) => !toolBindingByKey.get(bindingKey(policy.connector_id, policy.tool_name))?.enabled);
          return (
            <article className="skill-binding-connector" key={connector.id} data-skill-connector={connector.id} data-mounted={mounted}>
              <div className="skill-binding-connector-head">
                <div>
                  <strong>{connector.label}</strong>
                  <p className="muted"><code>{connector.id}</code> · {connector.enabled ? "连接器已启用" : "连接器已停用"} · 已审批工具 {approved.length}</p>
                </div>
                <label className="check skill-binding-toggle">
                  <input
                    type="checkbox"
                    checked={mounted}
                    disabled={!connector.enabled || busyKey === `connector:${connector.id}`}
                    onChange={(event) => void saveConnector(connector.id, event.target.checked)}
                  />
                  {busyKey === `connector:${connector.id}` ? "保存中…" : "挂载此连接器"}
                </label>
              </div>
              {!connector.enabled && <p className="runtime-l3-notice">该连接器已停用，不能向 Skill 提供工具。请在连接器详情恢复并重新验证。</p>}
              {mounted && !approved.length && <div className="runtime-state"><strong>没有可挂载的已审批工具</strong><span>请先在连接器详情发现工具并逐项审批。未审批工具不能通过本页挂载。</span></div>}
              {mounted && approved.length > 0 && (
                <div className="skill-tool-list">
                  {approved.map((policy) => {
                    const key = bindingKey(policy.connector_id, policy.tool_name);
                    const toolBinding = toolBindingByKey.get(key);
                    const selected = toolBinding?.enabled === true;
                    const isBusy = busyKey === `tool:${key}`;
                    return (
                      <label key={`${key}:${toolBinding?.version ?? 0}`} className="skill-tool-choice" data-skill-tool={policy.tool_name}>
                        <input type="checkbox" checked={selected} disabled={isBusy} onChange={(event) => void saveTool(policy, event.target.checked)} />
                        <span className="skill-tool-choice-copy"><strong>{policy.tool_name}</strong><small>{riskLabel(policy.risk)} · {policy.access} · 策略 v{policy.version}</small>{policy.risk === "L3" && <small className="runtime-l3-notice">L3 仍经确认与 Gateway；不能直接执行。</small>}</span>
                        <span className="muted">{isBusy ? "保存中…" : selected ? "已挂载" : "未挂载"}</span>
                      </label>
                    );
                  })}
                  {uncheckedApproved.length > 0 && <p className="muted">尚有 {uncheckedApproved.length} 个已审批工具未挂载；它们不会自动出现给模型。</p>}
                </div>
              )}
            </article>
          );
        })}
      </div>
      {!loading && connectors.length > 0 && !policies.length && !loadingError && <p className="muted">尚未有任何已审批工具。连接器被挂载不等于工具可用。</p>}
      {!loading && connectorBindings.some((binding) => !connectorsById.has(binding.connector_id)) && <p className="runtime-l3-notice">检测到一个历史连接器绑定在当前目录中不可见；未将其自动迁移或扩展到任何工具。</p>}
    </section>
  );
}
