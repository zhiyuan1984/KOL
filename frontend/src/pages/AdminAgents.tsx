import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type AgentManifestView } from "../api";
import { publishStatusLabel, rowTitle, type AdminRow } from "../adminGovernance";
import { profileNameLabel } from "../labels";

type Profile = {
  id: string;
  name: string;
  responsibilities: string[];
  defaultWritableScope: string;
};

export function AdminAgents({
  exams,
  assignments,
}: {
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

      <div className="panel" data-admin-skill-authorization>
        <h2>授权模型</h2>
        <p className="muted">
          <strong>人员授权只对技能。</strong>连接器不按人授权：先给员工授予技能（<code>user_skill_grants</code>），
          再由技能声明用哪些工具（技能 × 连接器 / 技能 × 工具绑定）。
          {entries.length ? ` 发布包入口：${entries.map((entry) => entry.title).join("、")}。` : ""}
        </p>
        <p className="muted">
          已退役：员工 × 连接器 read/write、连接器级组织范围、逐工具范围。这些入口不再提供，历史数据保留可回溯。
        </p>
        <Link className="btn ghost sm" to="/admin/skills">去技能页配置绑定</Link>
      </div>
    </section>
  );
}
