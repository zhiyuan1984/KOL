import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type KnowledgeRow } from "../api";
import {
  HIDE_REASONS,
  brandLabel,
  formatKbTime,
  hideReasonLabel,
  jobStatusLabel,
  kindLabel,
  proposalKindLabel,
  proposalStatusLabel,
  skillLabel,
  statusLabel,
  versionLine,
} from "../knowledgeCopy";
import { knowledgeArchiveConfirm, knowledgeHardDeleteConfirm } from "../adminConfirm";
import { useAdminConfirm } from "../components/ConfirmDialog";

type Row = Record<string, unknown>;

const BRANDS = ["LT", "RO", "PQ"] as const;

export default function AdminKnowledge() {
  const [rows, setRows] = useState<KnowledgeRow[]>([]);
  const [raw, setRaw] = useState<Row[]>([]);
  const [jobs, setJobs] = useState<Row[]>([]);
  const [review, setReview] = useState<KnowledgeRow[]>([]);
  const [stats, setStats] = useState<Row>({});
  const [proposals, setProposals] = useState<Row[]>([]);
  const [versionsById, setVersionsById] = useState<Record<string, Row[]>>({});
  const [openVersions, setOpenVersions] = useState("");
  const [editId, setEditId] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editBodyEn, setEditBodyEn] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(() => {
    void Promise.all([
      api.adminKnowledge().then(setRows),
      api.adminKnowledgeRaw().then(setRaw),
      api.adminKnowledgeJobs().then(setJobs),
      api.adminKnowledgeReview().then(setReview),
      api.adminKnowledgeStats().then(setStats),
      api.adminKnowledgeProposals().then(setProposals),
    ]).catch((e) => setError(e instanceof Error ? e.message : "无法加载知识"));
  }, []);

  useEffect(load, [load]);

  const run = async (fn: () => Promise<unknown>, message: string) => {
    setError("");
    try {
      await fn();
      setNotice(message);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    }
  };

  const fillEdit = (row: KnowledgeRow) => {
    setEditId(row.id);
    setEditTitle(row.title);
    setEditSubject(row.subject || "");
    setEditBody(row.body || "");
    setEditBodyEn(row.body_en || "");
  };

  const toggleVersions = async (id: string) => {
    if (openVersions === id) {
      setOpenVersions("");
      return;
    }
    const list = await api.knowledgeVersions(id);
    setVersionsById((cur) => ({ ...cur, [id]: list }));
    setOpenVersions(id);
  };

  const byReason = (stats.by_reason || {}) as Record<string, { label?: string; count?: number }>;
  const drafts = useMemo(() => rows.filter((row) => row.status === "draft"), [rows]);
  const published = useMemo(() => rows.filter((row) => row.status === "published"), [rows]);
  const archived = useMemo(() => rows.filter((row) => row.status === "archived"), [rows]);
  const editing = rows.find((row) => row.status === "pending_review" || row.status === "draft");
  const { ask, dialog } = useAdminConfirm();

  return (
    <section className="admin-kb" data-admin-knowledge>
      {dialog}
      {notice && <p className="admin-receipt status-ok" data-admin-receipt role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      <header className="kb-hero kb-hero-admin">
        <div className="page-kicker">知识生命周期</div>
        <h2>原文进库 → 抽出待审 → 发布给运营 → 看反馈，提案隔离</h2>
        <p className="kb-lead">删除 = 归档。彻底删除仅未发布草稿。已被已发送邮件引用的不能彻底删除。批准隔离提案也不会改线上技能说明。邮件模板发布后，运营启用才会进入 Codex harness。</p>
      </header>

      <article className="panel kb-step">
        <div className="kb-step-head">
          <span className="kb-step-n">1</span>
          <div>
            <h2>收录原文</h2>
            <p className="muted">上传 md / txt / eml / pdf / docx，或失败会话自动入库。原文不上线，也不改线上技能说明。</p>
          </div>
        </div>
        <label className="kb-upload">
          <span>选择文件写入原文库</span>
          <input
            type="file"
            accept=".md,.txt,.eml,.pdf,.docx"
            data-kb-upload
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void run(() => api.uploadKnowledgeRaw(file), "已写入原文库，尚未抽取");
              e.currentTarget.value = "";
            }}
          />
        </label>
        {raw.map((item) => (
          <article className="admin-row" key={String(item.id)}>
            <div>
              <strong>{String(item.filename || item.source)}</strong>
              <p className="muted">{String(item.source)} · {formatKbTime(String(item.created_at || ""))}</p>
            </div>
            <button className="btn work" type="button" onClick={() => void run(() => api.extractKnowledge(String(item.id)), "已抽取为待审页，未发布")}>抽取成待审页</button>
          </article>
        ))}
        {!raw.length && <p className="muted">暂无原文。失败会话（催大纲缺创作者、报价被拦）会自动出现在这里。</p>}
      </article>

      <article className="panel kb-step">
        <div className="kb-step-head">
          <span className="kb-step-n">2</span>
          <div>
            <h2>抽取成待审页</h2>
            <p className="muted">抽取只生成待审批草稿，不会自动发布，也不会改线上邮件。</p>
          </div>
        </div>
        {jobs.map((job) => (
          <p key={String(job.id)} className="muted">
            {jobStatusLabel(String(job.status))} · {job.result_knowledge_id ? "已生成待审页" : String(job.error || "等待结果")} · {formatKbTime(String(job.created_at || ""))}
          </p>
        ))}
        {!jobs.length && <p className="muted">还没有抽取任务。</p>}
      </article>

      <article className="panel kb-step">
        <div className="kb-step-head">
          <span className="kb-step-n">3</span>
          <div>
            <h2>编辑 / 审批发布</h2>
            <p className="muted">待审页要人点「审批发布」才会进运营知识库。编辑会写成新版本，旧版留档。</p>
          </div>
        </div>

        <h3 className="kb-subhead">待审批</h3>
        {review.map((row) => (
          <article className="admin-row" key={row.id}>
            <div>
              <strong>{row.title}</strong>
              <p className="muted">{kindLabel(row.kind)} · {statusLabel(row.status)} · {brandLabel(row.brand)}</p>
            </div>
            <div className="chip-row">
              <button className="btn" type="button" onClick={() => fillEdit(row)}>填入编辑</button>
              <button className="btn work" type="button" onClick={() => void run(() => api.approveKnowledge(row.id), "已发布。运营启用后，写合作邮件会按本版英文正文走 Codex")}>审批发布</button>
            </div>
          </article>
        ))}
        {!review.length && <p className="muted">队列为空。</p>}

        {drafts.length > 0 && (
          <>
            <h3 className="kb-subhead">草稿</h3>
            {drafts.map((row) => (
              <article className="admin-row" key={row.id} data-admin-knowledge-id={row.id}>
                <div>
                  <strong>{row.title}</strong>
                  <p className="muted">{kindLabel(row.kind)} · {statusLabel(row.status)}</p>
                </div>
                <div className="chip-row">
                  <button className="btn" type="button" onClick={() => fillEdit(row)}>填入编辑</button>
                  <button className="btn work" type="button" onClick={() => void run(() => api.approveKnowledge(row.id), "已审批发布")}>审批发布</button>
                  <button
                    className="btn danger"
                    type="button"
                    data-kb-hard-delete={row.id}
                    onClick={() => ask(knowledgeHardDeleteConfirm(row.title), () => run(() => api.deleteKnowledge(row.id), "草稿已删除"))}
                  >
                    彻底删除
                  </button>
                </div>
              </article>
            ))}
          </>
        )}

        <form className="settings-form kb-inline-form" onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          void run(() => api.createKnowledge({
            title: String(d.get("title") || ""),
            body: String(d.get("body") || ""),
            kind: String(d.get("kind") || "policy"),
            skill_id: String(d.get("skill_id") || ""),
            brand: String(d.get("brand") || "*"),
            subject: String(d.get("subject") || ""),
            body_en: String(d.get("body_en") || ""),
            placeholders: String(d.get("placeholders") || "").split(/\s+/).filter(Boolean),
            stage_codes: String(d.get("stage_codes") || "").split(/\s+/).filter(Boolean),
            status: "draft",
          }), "草稿已创建，尚未发布");
        }}>
          <h3 className="kb-subhead">手工新建草稿</h3>
          <label className="field">标题<input name="title" required /></label>
          <label className="field">类型
            <select name="kind">
              <option value="mail_template">邮件模板</option>
              <option value="policy">口径</option>
              <option value="pattern">写法样例</option>
              <option value="glossary">用词</option>
            </select>
          </label>
          <label className="field">绑定技能
            <select name="skill_id">
              <option value="">不绑定</option>
              <option value="email_compose">写合作邮件</option>
              <option value="confirm_stage">提出阶段变更</option>
              <option value="reply_analysis">回复分析</option>
              <option value="creator_discovery">达人发现</option>
              <option value="creator_profile">达人画像</option>
              <option value="risk_scan">超时/风险扫描</option>
            </select>
          </label>
          <label className="field">品牌
            <select name="brand" defaultValue="*">
              <option value="*">全品牌</option>
              <option value="LT">LiTime</option>
              <option value="RO">Renogy</option>
              <option value="PQ">PowerQueen</option>
            </select>
          </label>
          <label className="field">主题<input name="subject" /></label>
          <label className="field">正文 / wiki<textarea name="body" rows={3} /></label>
          <label className="field">英文正文<textarea name="body_en" rows={3} /></label>
          <label className="field">待填空<input name="placeholders" placeholder="[红人] [金额USD]" /></label>
          <label className="field">适用阶段<input name="stage_codes" placeholder="TESTING CONTENT_PLANNING" /></label>
          <p className="muted">邮件模板：运营启用后，该阶段写合作邮件以本版英文正文为 Codex 底稿。不改线上技能说明。</p>
          <button className="btn work">保存草稿</button>
        </form>

        <form className="settings-form kb-inline-form" onSubmit={(e) => {
          e.preventDefault();
          void run(() => api.editKnowledge(editId, {
            title: editTitle,
            body: editBody,
            subject: editSubject,
            body_en: editBodyEn,
          }), "已写入新版本，旧版仍可在资产里点开");
        }}>
          <h3 className="kb-subhead">编辑为新版本</h3>
          <p className="muted">{editId ? `正在编辑：${editTitle || "已选中的知识"}` : (editing ? "点待审或草稿的「填入编辑」，或在下方已发布资产里选一份。" : "从待审 / 已发布资产点「填入编辑」。")}</p>
          <label className="field">标题<input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} required /></label>
          <label className="field">主题<input value={editSubject} onChange={(e) => setEditSubject(e.target.value)} /></label>
          <label className="field">正文<textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={3} /></label>
          <label className="field">英文正文<textarea value={editBodyEn} onChange={(e) => setEditBodyEn(e.target.value)} rows={3} /></label>
          <button className="btn work" disabled={!editId}>保存为新版本</button>
        </form>
      </article>

      <article className="panel kb-step">
        <div className="kb-step-head">
          <span className="kb-step-n">4</span>
          <div>
            <h2>已发布资产</h2>
            <p className="muted">运营启用后才会进 Codex 写信。归档后新会话选不到，已发信仍留着当时的版本号。</p>
          </div>
        </div>
        {published.map((row) => (
          <article className={"kb-asset" + (openVersions === row.id ? " is-open" : "")} key={row.id} data-admin-knowledge-id={row.id}>
            <div className="kb-asset-head">
              <div>
                <strong>{row.title}</strong>
                <p className="kb-card-meta">
                  <span className="chip">{kindLabel(row.kind)}</span>
                  <span className="chip">{statusLabel(row.status)}</span>
                  <span className="chip">{brandLabel(row.brand)}</span>
                  <span className="chip">{skillLabel(row.skill_id)}</span>
                  <span className="chip">第 {row.current_version || 1} 版</span>
                  <span className={"chip" + ((row.cite_count || 0) > 0 ? " chip-ok" : "")}>被 {row.cite_count || 0} 人启用</span>
                  {row.kind === "mail_template" && Array.isArray(row.stage_codes) && row.stage_codes.length > 0 && (
                    <span className="chip">{row.stage_codes.join(" / ")}</span>
                  )}
                </p>
              </div>
              <div className="chip-row">
                <button className={"btn" + (editId === row.id ? " is-on" : "")} type="button" onClick={() => fillEdit(row)}>填入编辑</button>
                <button
                  className={"btn" + (openVersions === row.id ? " is-on" : "")}
                  type="button"
                  aria-pressed={openVersions === row.id}
                  onClick={() => void toggleVersions(row.id).catch((e) => setError(e instanceof Error ? e.message : "无法加载版本"))}
                >
                  {openVersions === row.id ? "收起版本" : "查看版本"}
                </button>
                <button
                  className="btn danger"
                  type="button"
                  data-kb-archive={row.id}
                  onClick={() => ask(knowledgeArchiveConfirm(row.title, row.current_version), () => run(() => api.archiveKnowledge(row.id), "已归档，运营首页不再出现"))}
                >
                  归档
                </button>
              </div>
            </div>
            {openVersions === row.id && (
              <ul className="kb-versions">
                {(versionsById[row.id] || []).map((ver) => (
                  <li key={String(ver.id)}>{versionLine(ver)}</li>
                ))}
                {!(versionsById[row.id] || []).length && <li className="muted">还没有版本记录。</li>}
              </ul>
            )}
            {row.kind === "mail_template" && (
              <div className="kb-transfer">
                <p className="kb-result">
                  复制到另一品牌邮箱：按 LiTime / Renogy / PowerQueen 的发件箱白名单再存一份。会生成<strong>待审批提案</strong>，不会立刻改线上邮件，也不会改线上技能说明。
                </p>
                <div className="chip-row">
                  {BRANDS.filter((brand) => brand !== row.brand).map((brand) => (
                    <button
                      key={brand}
                      className="btn"
                      type="button"
                      onClick={() => void run(() => api.transferKnowledgeBrand(row.id, brand), `已提交复制到 ${brandLabel(brand)} 的待审提案`)}
                    >
                      复制到 {brandLabel(brand)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </article>
        ))}
        {!published.length && <p className="muted">还没有已发布资产。</p>}

        {archived.length > 0 && (
          <>
            <h3 className="kb-subhead">已归档</h3>
            {archived.map((row) => (
              <article className="admin-row" key={row.id} data-admin-knowledge-id={row.id}>
                <div>
                  <strong>{row.title}</strong>
                  <p className="muted">{kindLabel(row.kind)} · {statusLabel(row.status)} · 第 {row.current_version || 1} 版</p>
                </div>
                <button
                  className={"btn" + (openVersions === row.id ? " is-on" : "")}
                  type="button"
                  aria-pressed={openVersions === row.id}
                  onClick={() => void toggleVersions(row.id).catch((e) => setError(e instanceof Error ? e.message : "无法加载版本"))}
                >
                  {openVersions === row.id ? "收起版本" : "查看版本"}
                </button>
              </article>
            ))}
          </>
        )}
      </article>

      <article className="panel kb-step">
        <div className="kb-step-head">
          <span className="kb-step-n">5</span>
          <div>
            <h2>运营反馈</h2>
            <p className="muted">数字 = 有多少次「对本账号隐藏」选了这个原因。不是拦截次数，也不改已发信。</p>
          </div>
        </div>
        <div className="kb-stat-grid">
          {HIDE_REASONS.map((reason) => {
            const value = byReason[reason.code] || {};
            return (
              <div className="kb-stat" key={reason.code}>
                <strong>{Number(value.count || 0)}</strong>
                <p>{hideReasonLabel(reason.code)}</p>
                <span>{reason.result}</span>
              </div>
            );
          })}
        </div>
        <p className="muted">合计 {Number(stats.total || 0)} 次隐藏（按账号计，不是全员下线）。</p>
      </article>

      <article className="panel kb-step">
        <div className="kb-step-head">
          <span className="kb-step-n">6</span>
          <div>
            <h2>隔离提案</h2>
            <p className="muted">演化走隔离队列。批准只留档，不会改线上技能说明，也不会立刻改线上邮件。</p>
          </div>
        </div>
        <form className="settings-form kb-inline-form" onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          void run(() => api.proposeKnowledgeEvolve({
            kind: String(d.get("kind") || "skill_patch"),
            skill_id: String(d.get("skill_id") || ""),
            knowledge_id: String(d.get("knowledge_id") || ""),
            to_brand: String(d.get("to_brand") || ""),
            proposed_diff: String(d.get("proposed_diff") || ""),
          }), "隔离提案已入队，未改线上技能说明");
        }}>
          <label className="field">类型
            <select name="kind">
              <option value="skill_patch">技能补丁（隔离）</option>
              <option value="template_patch">模板补丁（隔离）</option>
              <option value="brand_transfer">复制到另一品牌邮箱</option>
            </select>
          </label>
          <label className="field">绑定技能
            <select name="skill_id">
              <option value="">不绑定</option>
              <option value="email_compose">写合作邮件</option>
              <option value="confirm_stage">提出阶段变更</option>
              <option value="reply_analysis">回复分析</option>
              <option value="creator_discovery">达人发现</option>
              <option value="creator_profile">达人画像</option>
              <option value="risk_scan">超时/风险扫描</option>
            </select>
          </label>
          <label className="field">关联知识
            <select name="knowledge_id">
              <option value="">不指定</option>
              {rows.map((row) => <option key={row.id} value={row.id}>{row.title}</option>)}
            </select>
          </label>
          <label className="field">目标品牌
            <select name="to_brand">
              <option value="">不指定</option>
              <option value="LT">LiTime</option>
              <option value="RO">Renogy</option>
              <option value="PQ">PowerQueen</option>
            </select>
          </label>
          <label className="field">提案说明<textarea name="proposed_diff" rows={3} /></label>
          <button className="btn work">提交隔离提案</button>
        </form>
        {proposals.map((p) => (
          <article className="admin-row" key={String(p.id)}>
            <div>
              <strong>{proposalKindLabel(String(p.kind))}</strong>
              <p className="muted">{proposalStatusLabel(String(p.status))}{String(p.profile) === "shadow" ? " · 隔离队列" : p.profile ? ` · ${p.profile}` : ""} · {String(p.reject_reason || p.proposed_diff || "").replace(/SKILL\.md/g, "线上技能说明").replace(/生产 /g, "线上")}</p>
            </div>
            {p.status === "pending" && (
              <div className="chip-row">
                <button className="btn work" type="button" onClick={() => void run(() => api.reviewKnowledgeProposal(String(p.id), "approve"), "已批准（未改线上技能说明）")}>批准</button>
                <button className="btn" type="button" onClick={() => void run(() => api.reviewKnowledgeProposal(String(p.id), "reject", "否决保留"), "已否决并留档")}>否决</button>
              </div>
            )}
          </article>
        ))}
        {!proposals.length && <p className="muted">暂无隔离提案。</p>}
      </article>
    </section>
  );
}
