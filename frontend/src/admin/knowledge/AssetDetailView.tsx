import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import {
  knowledgeArchiveConfirm,
  knowledgeHardDeleteConfirm,
  knowledgePublishConfirm,
  knowledgeRollbackConfirm,
} from "../../adminConfirm";
import { useAdminConfirm } from "../../components/ConfirmDialog";
import VersionDiff from "../../components/VersionDiff";
import {
  KB_ADMIN_ACTION,
  KB_ADMIN_EMPTY,
  brandLabel,
  formatKbTime,
  kindLabel,
  skillLabel,
  statusLabel,
  versionLine,
} from "../../knowledgeCopy";
import {
  KB_BRANDS,
  KB_KINDS,
  KB_LANGS,
  errorStatus,
  hasGrantRow,
  kbSkillNames,
  listText,
  splitList,
  textValue,
  useKbData,
  type KbAssetRow,
  type KbFeed,
  type Row,
} from "./shared";

type Grants = { org: string[]; team: string[]; user: string[] };
type VersionRow = Row & { version?: number };

const EMPTY_GRANTS: Grants = { org: [], team: [], user: [] };

function blob(value: unknown): string {
  return String(value ?? "");
}

/** 资产详情：这份资产的治理状态与影响面？—— 主行动按状态唯一渲染。 */
export default function AssetDetailView({ id, notify, fail }: KbFeed & { id: string }) {
  const { ask, dialog } = useAdminConfirm();
  const load = useCallback(async () => {
    const assets = await api.adminKnowledgeAssets() as KbAssetRow[];
    const row = assets.find((item) => item.id === id) || null;
    if (!row) return { row: null, versions: [] as VersionRow[], grants: EMPTY_GRANTS };
    const [versions, grants] = await Promise.all([
      api.knowledgeVersions(id) as Promise<VersionRow[]>,
      api.adminKnowledgeGrants(id),
    ]);
    return { row, versions, grants };
  }, [id]);
  const { data, error, loading, reload } = useKbData(load, [id]);

  const [editing, setEditing] = useState(false);
  const [openVersion, setOpenVersion] = useState(0);
  const [bodies, setBodies] = useState<Record<number, Row>>({});
  const [compare, setCompare] = useState<number[]>([]);
  const [orgText, setOrgText] = useState("");
  const [teamText, setTeamText] = useState("");
  const [userText, setUserText] = useState("");

  const row = data?.row || null;
  const versions = data?.versions || [];
  const grants = data?.grants || EMPTY_GRANTS;

  useEffect(() => {
    setOrgText((data?.grants || EMPTY_GRANTS).org.join("、"));
    setTeamText((data?.grants || EMPTY_GRANTS).team.join("、"));
    setUserText((data?.grants || EMPTY_GRANTS).user.join("、"));
  }, [data]);

  useEffect(() => {
    setEditing(false);
    setCompare([]);
    setOpenVersion(0);
  }, [id]);

  const run = async (fn: () => Promise<unknown>, message: string) => {
    try {
      await fn();
      notify(message);
      reload();
    } catch (cause) {
      fail(cause);
    }
  };

  const loadBody = async (version: number) => {
    if (bodies[version]) return;
    try {
      const body = await api.adminKnowledgeVersion(id, version);
      setBodies((current) => ({ ...current, [version]: body }));
    } catch (cause) {
      fail(cause, "无法加载该版本全文");
    }
  };

  const toggleVersion = (version: number) => {
    if (openVersion === version) {
      setOpenVersion(0);
      return;
    }
    setOpenVersion(version);
    void loadBody(version);
  };

  const toggleCompare = (version: number) => {
    const next = compare.includes(version)
      ? compare.filter((item) => item !== version)
      : [...compare, version].slice(-2);
    setCompare(next);
    next.forEach((item) => void loadBody(item));
  };

  const diffPair = useMemo(() => {
    if (compare.length !== 2) return null;
    const [leftVersion, rightVersion] = [...compare].sort((a, b) => a - b);
    const left = bodies[leftVersion];
    const right = bodies[rightVersion];
    if (!left || !right) return null;
    return { leftVersion, rightVersion, left, right };
  }, [compare, bodies]);

  if (!row && loading) {
    return <p className="muted" role="status">正在加载资产详情…</p>;
  }
  if (!row) {
    return (
      <article className="panel" data-admin-kb-detail-missing>
        <p className="muted">{error || KB_ADMIN_EMPTY.detailMissing}</p>
        <Link className="kbadmin-action-link" to="/admin/knowledge/assets">返回资产目录</Link>
      </article>
    );
  }

  const refs = kbSkillNames(row.ref_skills);
  const needsApproval = row.status === "draft" || row.status === "pending_review";
  const rowVersion = Number(row.current_version || 1);
  const approve = async (reason: string) => {
    void reason;
    try {
      await api.approveKnowledge(row.id, rowVersion);
      notify("已审批发布，员工可见性按下一次解析生效。");
      reload();
    } catch (cause) {
      if (errorStatus(cause) === 409) {
        reload();
        throw new Error("内容已变，请刷新后重新审核");
      }
      throw cause;
    }
  };
  const openEdit = () => setEditing(true);
  const saveEdit = (form: HTMLFormElement) => {
    const data2 = new FormData(form);
    void run(
      () => api.editKnowledge(row.id, {
        title: String(data2.get("title") || "").trim(),
        kind: String(data2.get("kind") || row.kind || "policy"),
        brand: String(data2.get("brand") || row.brand || "*"),
        lang: String(data2.get("lang") || row.lang || "en"),
        subject: String(data2.get("subject") || ""),
        body: String(data2.get("body") || ""),
        body_en: String(data2.get("body_en") || ""),
        tags: String(data2.get("tags") || ""),
        stage_codes: splitList(String(data2.get("stage_codes") || "")),
      }).then(() => setEditing(false)),
      "已写入新版本草稿，旧版本仍留档；需重新审批才生效。",
    );
  };

  return (
    <>
      {dialog}
      {error && <p className="error" role="alert">{error}</p>}
      <p className="admin-crumb">
        <Link to="/admin/knowledge/assets">知识资产</Link> / {row.title}
      </p>

      <article className="panel" data-admin-kb-detail-meta>
        <div className="admin-section-head">
          <div>
            <h2>{row.title}</h2>
            <p className="muted">{row.id} · {kindLabel(row.kind)} · {statusLabel(row.status)} · 第 {rowVersion} 版</p>
          </div>
          <div className="kbadmin-primary-slot" data-admin-kb-primary={needsApproval ? "approve" : "edit"}>
            {needsApproval ? (
              <button
                className={editing ? "btn ghost" : "btn work"}
                type="button"
                data-admin-kb-approve
                onClick={() => ask(
                  knowledgePublishConfirm(row.title, rowVersion),
                  approve,
                )}
              >
                {KB_ADMIN_ACTION.approve}
              </button>
            ) : (
              <button
                className={editing ? "btn ghost" : "btn work"}
                type="button"
                data-admin-kb-edit
                aria-expanded={editing}
                onClick={() => (editing ? setEditing(false) : openEdit())}
              >
                {editing ? "收起编辑" : "编辑为新版本"}
              </button>
            )}
          </div>
        </div>

        <dl className="admin-kv">
          <div><dt>状态</dt><dd>{statusLabel(row.status)}</dd></div>
          <div><dt>类型</dt><dd>{kindLabel(row.kind)}</dd></div>
          <div><dt>品牌 / 语言</dt><dd>{brandLabel(row.brand)} · {row.lang || "en"}</dd></div>
          <div><dt>适用阶段</dt><dd>{listText((row.stage_codes || []).join(" / ")) || "全阶段"}</dd></div>
          <div><dt>标签</dt><dd>{listText(row.tags) || "—"}</dd></div>
          <div><dt>更新</dt><dd>{formatKbTime(row.updated_at) || "—"}</dd></div>
          <div><dt>创建</dt><dd>{row.created_by || "—"} · {formatKbTime(row.created_at) || "—"}</dd></div>
          <div><dt>审批</dt><dd>{row.approved_at ? `${textValue((row as unknown as Row).approved_by) || "—"} · ${formatKbTime(row.approved_at)}` : "尚未审批"}</dd></div>
          <div><dt>到期</dt><dd>{textValue(row.expires_at) || "未设置"}</dd></div>
        </dl>

        <h3 className="kb-subhead">主题</h3>
        <p>{row.subject || "（空）"}</p>
        <h3 className="kb-subhead">正文</h3>
        <pre className="kbadmin-body">{row.body || "（空）"}</pre>
        <h3 className="kb-subhead">英文正文</h3>
        <pre className="kbadmin-body">{row.body_en || "（空）"}</pre>

        {editing ? (
          <form
            className="settings-form kbadmin-form"
            data-admin-kb-edit-form
            onSubmit={(event) => {
              event.preventDefault();
              saveEdit(event.currentTarget);
            }}
          >
            <h3 className="kb-subhead">编辑为新版本</h3>
            <div className="kbadmin-form-grid">
              <label className="field">标题<input name="title" defaultValue={row.title} required /></label>
              <label className="field">类型
                <select name="kind" defaultValue={row.kind || "policy"}>
                  {KB_KINDS.map((value) => <option key={value} value={value}>{kindLabel(value)}</option>)}
                </select>
              </label>
              <label className="field">品牌
                <select name="brand" defaultValue={row.brand || "*"}>
                  <option value="*">全品牌</option>
                  {KB_BRANDS.map((value) => <option key={value} value={value}>{brandLabel(value)}</option>)}
                </select>
              </label>
              <label className="field">语言
                <select name="lang" defaultValue={row.lang || "en"}>
                  {KB_LANGS.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <label className="field">主题<input name="subject" defaultValue={row.subject || ""} /></label>
              <label className="field">标签<input name="tags" defaultValue={String(row.tags || "")} /></label>
            </div>
            <label className="field">正文<textarea name="body" rows={3} defaultValue={row.body || ""} /></label>
            <label className="field">英文正文<textarea name="body_en" rows={3} defaultValue={row.body_en || ""} /></label>
            <label className="field">适用阶段（空格分隔）<input name="stage_codes" defaultValue={(row.stage_codes || []).join(" ")} /></label>
            <p className="muted">保存写新版本草稿；发布前员工看不到这一版。</p>
            <button className="btn work" data-admin-kb-edit-submit>{KB_ADMIN_ACTION.saveVersion}</button>
          </form>
        ) : null}

        <div className="admin-actions kbadmin-secondary-actions">
          <button
            className="btn ghost"
            type="button"
            data-kb-archive={row.id}
            disabled={row.status !== "published"}
            onClick={() => ask(
              knowledgeArchiveConfirm(row.title, rowVersion),
              () => run(() => api.archiveKnowledge(row.id), "已归档：新的运行不再解析到这份知识。"),
            )}
          >
            {KB_ADMIN_ACTION.archive}
          </button>
          <button
            className="btn danger"
            type="button"
            data-kb-hard-delete={row.id}
            disabled={row.status !== "draft"}
            onClick={() => ask(
              knowledgeHardDeleteConfirm(row.title),
              () => run(() => api.deleteKnowledge(row.id), "草稿已删除。"),
            )}
          >
            彻底删除（仅草稿）
          </button>
          {row.kind === "mail_template" ? KB_BRANDS.filter((brand) => brand !== row.brand).map((brand) => (
            <button
              key={brand}
              className="btn ghost sm"
              type="button"
              onClick={() => void run(
                () => api.transferKnowledgeBrand(row.id, brand),
                `已提交复制到 ${brandLabel(brand)} 的待审提案。`,
              )}
            >
              复制到 {brandLabel(brand)}
            </button>
          )) : null}
        </div>
        <p className="muted admin-note">
          归档与删除是不同副作用：归档只从解析与员工面移除，彻底删除只对未发布草稿开放。
        </p>
      </article>

      <article className="panel" data-admin-kb-versions>
        <div className="admin-section-head">
          <div>
            <h2>版本时间线</h2>
            <p className="muted">勾选两个版本做只读对比；回滚是用历史版本生成新草稿，历史行不动。</p>
          </div>
          <span className="muted" role="status">{versions.length} 个版本</span>
        </div>
        {!versions.length && <p className="muted">{KB_ADMIN_EMPTY.versions}</p>}
        {versions.map((version) => {
          const number = Number(version.version || 0);
          const open = openVersion === number;
          const body = bodies[number];
          return (
            <article className="admin-row kbadmin-version" key={String(version.id || number)} data-admin-kb-version={number}>
              <div>
                <strong>第 {number} 版</strong>
                <p className="muted">{versionLine(version)}</p>
              </div>
              <div className="kbadmin-row-actions">
                <button
                  className="kbadmin-action-link"
                  type="button"
                  aria-expanded={open}
                  data-admin-kb-version-open={number}
                  onClick={() => toggleVersion(number)}
                >
                  {open ? KB_ADMIN_ACTION.collapseVersion : KB_ADMIN_ACTION.expandVersion}
                </button>
                <button
                  className="kbadmin-action-link"
                  type="button"
                  aria-pressed={compare.includes(number)}
                  data-admin-kb-version-compare={number}
                  onClick={() => toggleCompare(number)}
                >
                  {compare.includes(number) ? "取消对比" : "加入对比"}
                </button>
                <button
                  className="kbadmin-action-link kbadmin-action-danger"
                  type="button"
                  data-admin-kb-version-rollback={number}
                  disabled={number === rowVersion}
                  onClick={() => ask(
                    knowledgeRollbackConfirm(row.title, rowVersion, number),
                    () => run(
                      () => api.adminKnowledgeRollback(row.id, number),
                      `已按第 ${number} 版生成新草稿；需重新审批后才对员工生效。`,
                    ),
                  )}
                >
                  {KB_ADMIN_ACTION.rollback}
                </button>
              </div>
              {open ? (
                <div className="kbadmin-version-body" data-admin-kb-version-body={number}>
                  {body ? (
                    <>
                      <p className="muted">{listText(body.title)} · {kindLabel(String(body.kind || ""))} · {brandLabel(String(body.brand || ""))}</p>
                      <p className="muted">主题：{blob(body.subject) || "（空）"}</p>
                      <pre className="kbadmin-body">{blob(body.body) || "（空）"}</pre>
                      <pre className="kbadmin-body">{blob(body.body_en) || "（空）"}</pre>
                    </>
                  ) : (
                    <p className="muted">正在加载该版本全文…</p>
                  )}
                </div>
              ) : null}
            </article>
          );
        })}

        {compare.length === 2 ? (
          <section className="kbadmin-compare" data-admin-kb-compare>
            <div className="admin-section-head">
              <h3>版本对比</h3>
              <button className="kbadmin-action-link" type="button" onClick={() => setCompare([])}>
                {KB_ADMIN_ACTION.clearCompare}
              </button>
            </div>
            {diffPair ? (
              <VersionDiff
                left={diffPair.left}
                right={diffPair.right}
                leftLabel={`第 ${diffPair.leftVersion} 版`}
                rightLabel={`第 ${diffPair.rightVersion} 版`}
              />
            ) : (
              <p className="muted" role="status">正在加载所选版本全文…</p>
            )}
          </section>
        ) : (
          <p className="muted">{compare.length === 1 ? "再选一个版本即可对比。" : "选两个版本可做只读对比。"}</p>
        )}
      </article>

      <article className="panel" data-admin-kb-grants>
        <div className="admin-section-head">
          <div>
            <h2>范围与授权</h2>
            <p className="muted">按对象收窄；留空 = 已发布即可见；保存后按新范围生效。id 之间用逗号或顿号分隔。</p>
          </div>
        </div>
        <div className="kbadmin-form-grid">
          <label className="field">组织 id
            <input value={orgText} data-admin-kb-grant="org" onChange={(event) => setOrgText(event.target.value)} />
          </label>
          <label className="field">团队 id
            <input value={teamText} data-admin-kb-grant="team" onChange={(event) => setTeamText(event.target.value)} />
          </label>
          <label className="field">账号 id
            <input value={userText} data-admin-kb-grant="user" onChange={(event) => setUserText(event.target.value)} />
          </label>
        </div>
        <div className="admin-actions">
          <button
            className="btn ghost"
            type="button"
            data-admin-kb-grant-save
            onClick={() => void run(
              () => api.adminKnowledgeSetGrants(row.id, {
                org: splitList(orgText),
                team: splitList(teamText),
                user: splitList(userText),
              }),
              "范围已保存；按新范围生效。",
            )}
          >
            保存范围
          </button>
        </div>
        <p className="muted admin-note">
          {hasGrantRow(grants)
            ? `当前授权：组织 ${grants.org.length} · 团队 ${grants.team.length} · 账号 ${grants.user.length}。`
            : KB_ADMIN_EMPTY.grants}
        </p>
      </article>

      <article className="panel" data-admin-kb-refs>
        <div className="admin-section-head">
          <div>
            <h2>引用（会解析到这份知识的技能）</h2>
            <p className="muted">只列出启用中的绑定；专家与智能体范围校验属阶段 4，当前不宣称已引用。</p>
          </div>
          <span className="muted" role="status">{refs.length} 个技能</span>
        </div>
        {refs.length ? (
          <ul className="kbadmin-ref-list">
            {(row.ref_skills || []).map((skill) => (
              <li key={skill}>
                <strong>{skillLabel(skill)}</strong>
                <span className="muted"> {skill}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{KB_ADMIN_EMPTY.refs}</p>
        )}
      </article>
    </>
  );
}
