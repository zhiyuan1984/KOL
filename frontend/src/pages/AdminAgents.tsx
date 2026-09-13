import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type AgentManifestView } from "../api";
import {
  accessFor,
  connectorGrantsOf,
  publicConnectorView,
  publishStatusLabel,
  rowTitle,
  type AdminRow,
} from "../adminGovernance";
import { profileNameLabel } from "../labels";

type Profile = {
  id: string;
  name: string;
  responsibilities: string[];
  defaultWritableScope: string;
};

export function AdminAgents({
  users,
  connectors,
  exams,
  assignments,
}: {
  users: AdminRow[];
  connectors: AdminRow[];
  exams: AdminRow[];
  assignments: AdminRow[];
}) {
  const [manifest, setManifest] = useState<AgentManifestView | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      api.agentManifest().catch(() => null),
      api.profiles().catch(() => []),
    ]).then(([pack, profileRows]) => {
      if (cancelled) return;
      setManifest(pack);
      setProfiles(Array.isArray(profileRows) ? profileRows as Profile[] : []);
    }).catch((e) => {
      if (!cancelled) setLoadError(e instanceof Error ? e.message : "无法加载数字员工治理数据");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const publish = publishStatusLabel(manifest);
  const connectorRows = connectors.map(publicConnectorView).filter((row) => row.id);
  const entries = manifest?.entries || [];

  return (
    <section className="admin-govern" data-admin-page="agents">
      <div className="panel">
        <div className="admin-section-head">
          <div>
            <h2>数字员工治理</h2>
            <p className="muted">只回答组织里的数字能力是否可被员工开工。开工请走员工导航，不在本页提交任务。</p>
          </div>
        </div>
        {loadError && <p className="error" role="alert">{loadError}</p>}
        <dl className="admin-kv" data-admin-publish>
          <div><dt>发布包</dt><dd>{manifest?.id || "—"}{manifest?.version ? ` · ${manifest.version}` : ""}</dd></div>
          <div>
            <dt>发布状态</dt>
            <dd>
              <span className={"admin-status is-" + (publish.key === "published" ? "configured" : "unattached")}>
                {publish.label}
              </span>
            </dd>
          </div>
          <div>
            <dt>员工能否提交</dt>
            <dd>
              {publish.canSubmit === null ? "未声明" : publish.canSubmit ? "可以提交" : "不可提交"}
            </dd>
          </div>
        </dl>
        <div className="admin-todo" data-todo="agent-publish-write">
          TODO：发布状态写入仍走 <code>agents/kol/manifest.yaml</code>；没有 <code>PATCH /api/admin/agents</code>，本页不编造开关。
        </div>
      </div>

      <div className="panel">
        <h2>可写范围</h2>
        <p className="muted">只读展示 profiles 声明。不把范围画成 Pipeline 资产板。</p>
        <div className="admin-table-wrap">
          <table className="admin-table" data-admin-writable-scope>
            <thead>
              <tr>
                <th>能力域</th>
                <th>职责</th>
                <th>可写声明</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((profile) => (
                <tr key={profile.id} data-admin-profile={profile.id}>
                  <td><strong>{profileNameLabel(profile.name || profile.id)}</strong></td>
                  <td className="muted">{(profile.responsibilities || []).join(" / ")}</td>
                  <td>{profile.defaultWritableScope || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!profiles.length && <p className="muted">未读取到能力域声明。</p>}
        <div className="admin-todo" data-todo="writable-scope-write">
          TODO：可写范围没有管理端写入 API，变更需改 profiles 配置。
        </div>
      </div>

      <div className="panel">
        <h2>考试闸门</h2>
        <p className="muted">现有 API 能看到考试与员工分配，看不到「哪场考试挡住哪个 Agent」。</p>
        <div className="admin-table-wrap">
          <table className="admin-table" data-admin-exam-gates>
            <thead>
              <tr>
                <th>考试</th>
                <th>分配</th>
                <th>待完成</th>
              </tr>
            </thead>
            <tbody>
              {exams.map((exam) => {
                const examId = String(exam.id || "");
                const rows = assignments.filter((row) => String(row.exam_id) === examId);
                const pending = rows.filter((row) => !row.passed && String(row.status) !== "completed");
                return (
                  <tr key={examId}>
                    <td>
                      <strong>{rowTitle(exam)}</strong>
                      <p className="muted">{String(exam.description || exam.status || "")}</p>
                    </td>
                    <td>{rows.length}</td>
                    <td>{pending.length ? pending.map((row) => String(row.user_name || row.user_id)).join("、") : "无"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!exams.length && <p className="muted">暂无考试。</p>}
        <div className="admin-todo" data-todo="exam-agent-binding">
          TODO：考试 ↔ Agent 绑定字段未提供。分配考试请用「考试与分配」页；本页不做第二份答题。
        </div>
        <Link className="btn ghost sm" to="/admin/exams">去分配考试</Link>
      </div>

      <div className="panel">
        <h2>连接器授权矩阵</h2>
        <p className="muted">
          现有 API 是员工 × 连接器的 read/write。Agent × 连接器矩阵后端尚未提供。
          {entries.length ? ` 发布包入口：${entries.map((entry) => entry.title).join("、")}。` : ""}
        </p>
        <div className="admin-table-wrap admin-matrix">
          <table className="admin-table" data-admin-grant-matrix>
            <thead>
              <tr>
                <th>员工</th>
                {connectorRows.map((connector) => (
                  <th key={connector.id}>{connector.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={String(user.id)}>
                  <td>
                    <strong>{rowTitle(user)}</strong>
                    <p className="muted">{connectorGrantsOf(user).length} 项授予</p>
                  </td>
                  {connectorRows.map((connector) => {
                    const access = accessFor(user, connector.id);
                    return (
                      <td key={connector.id} data-matrix-cell={`${user.id}:${connector.id}`}>
                        {access ? access : "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(!users.length || !connectorRows.length) && <p className="muted">还没有可展示的员工或连接器。</p>}
        <div className="admin-todo" data-todo="agent-connector-matrix">
          TODO：没有 Agent × 连接器授权 API。单元格不深链员工 <code>/agents</code> 开工台。
        </div>
        <Link className="btn ghost sm" to="/admin/connectors">去连接器枢纽改授权</Link>
      </div>
    </section>
  );
}
