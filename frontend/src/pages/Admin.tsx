import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { FUNNEL, skillKind, type SkillRow } from "./SkillHub";
import {
  skillDeleteConfirm,
  skillGrantSaveConfirm,
  skillListConfirm,
  skillPublishConfirm,
  skillUnpublishConfirm,
} from "../adminConfirm";
import { useAdminConfirm } from "../components/ConfirmDialog";

type AdminSkill = SkillRow & {
  grants?: { org: string[]; team: string[]; user: string[] };
  funnel?: string;
  summary?: string;
  source?: "bundled" | "published";
  aliases?: string[];
  updated_at?: string | null;
  edited?: boolean;
};

function grantLine(grants?: { org: string[]; team: string[]; user: string[] }) {
  const org = grants?.org?.length || 0;
  const team = grants?.team?.length || 0;
  const user = grants?.user?.length || 0;
  if (!org && !team && !user) return "未分配";
  return `组织 ${org} · 团队 ${team} · 个人 ${user}`;
}

function lastEditLabel(skill: AdminSkill) {
  const raw = String(skill.updated_at || "").trim();
  if (raw) {
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleString("zh-CN", {
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    }
  }
  return skill.edited ? "已改说明" : "—";
}

type SkillMeta = {
  profiles: string[];
  outputs: string[];
  funnels: string[];
  mcp: string[];
};

type Directory = {
  orgs: { id: string; name: string }[];
  teams: { id: string; org_id: string; name: string }[];
  users: { id: string; handle: string; name: string; role: string }[];
};

type AdminPayload = {
  connectors: { id: string; label: string; status: string }[];
  hidden_connectors?: string[];
  not_in_kol_scope: string[];
  mailboxes: Record<string, string>;
  can_edit_skills?: boolean;
  logged_in?: boolean;
  sop?: { note: string };
};

export function Admin({ embedded = false }: { embedded?: boolean }) {
  const nav = useNavigate();
  const [data, setData] = useState<AdminPayload | null>(null);
  const [tab, setTab] = useState<"skills" | "connectors">("skills");
  const [q, setQ] = useState("");
  const [skills, setSkills] = useState<AdminSkill[]>([]);
  const [meta, setMeta] = useState<SkillMeta>({ profiles: [], outputs: [], funnels: [], mcp: [] });
  const [dir, setDir] = useState<Directory>({ orgs: [], teams: [], users: [] });
  const [editId, setEditId] = useState<string | null>(null);
  const [grantId, setGrantId] = useState<string | null>(null);
  const [grantDraft, setGrantDraft] = useState<{ org: string[]; team: string[]; user: string[] }>({
    org: [],
    team: [],
    user: [],
  });
  const [sopSummary, setSopSummary] = useState("");
  const [sopBody, setSopBody] = useState("");
  const [sopTitle, setSopTitle] = useState("");
  const [sopAliases, setSopAliases] = useState("");
  const [sopSaving, setSopSaving] = useState(false);
  const [sopErr, setSopErr] = useState("");
  const [sopNotice, setSopNotice] = useState("");
  const { ask, dialog } = useAdminConfirm();
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [loginErr, setLoginErr] = useState("");
  const [creating, setCreating] = useState(false);
  const [createDraft, setCreateDraft] = useState({
    id: "",
    title: "",
    description: "",
    category: "管理",
    profile: "commander",
    output: "task_result",
    funnel: "reach",
    aliases: "",
    in_market: true,
    body: "# 新技能\n\n写清意图、必填和禁止事项。\n\n## 禁止事项\n\n- 禁止发送消息。\n- 禁止修改阶段。\n",
  });
  const loggedIn = Boolean(data?.logged_in || data?.can_edit_skills);

  const load = async () => {
    const admin = (await api.admin()) as AdminPayload;
    setData(admin);
    if (admin.logged_in || admin.can_edit_skills) {
      const pack = (await api.adminSkills()) as { directory: Directory; skills: AdminSkill[]; meta?: SkillMeta };
      setDir(pack.directory);
      setSkills(pack.skills || []);
      if (pack.meta) setMeta(pack.meta);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const onLogin = async () => {
    setLoginErr("");
    try {
      await api.login(user, password);
      setPassword("");
      await load();
    } catch (e) {
      setLoginErr(e instanceof Error ? e.message : String(e));
    }
  };

  const onLogout = async () => {
    await api.logout();
    setSkills([]);
    setEditId(null);
    setGrantId(null);
    await load();
  };

  const openSop = async (s: AdminSkill) => {
    setSopErr("");
    setGrantId(null);
    setSopSaving(true);
    try {
      const detail = (await api.skill(s.id)) as SkillRow & { body?: string; summary?: string; aliases?: string[] };
      setSopTitle(detail.title || s.title);
      setSopSummary(detail.summary || s.summary || s.title);
      setSopBody(detail.body || "");
      setSopAliases((detail.aliases || s.aliases || []).join(", "));
      setEditId(s.id);
    } catch (e) {
      setSopErr(String(e));
    } finally {
      setSopSaving(false);
    }
  };

  const saveSop = async () => {
    if (!editId) return;
    setSopSaving(true);
    setSopErr("");
    try {
      const row = skills.find((r) => r.id === editId);
      if (row?.source === "published") {
        await api.patchAdminSkill(editId, {
          in_market: row.in_market,
          title: sopTitle,
          description: sopSummary,
          body: sopBody,
          aliases: sopAliases,
        });
      } else {
        await api.saveSkillSop(editId, { summary: sopSummary, body: sopBody });
      }
      await load();
      setEditId(null);
    } catch (e) {
      setSopErr(String(e));
    } finally {
      setSopSaving(false);
    }
  };

  const resetSop = async () => {
    if (!editId) return;
    setSopSaving(true);
    setSopErr("");
    try {
      const detail = (await api.resetSkillSop(editId)) as { summary: string; body: string };
      setSopSummary(detail.summary);
      setSopBody(detail.body);
      await load();
    } catch (e) {
      setSopErr(String(e));
    } finally {
      setSopSaving(false);
    }
  };

  const openGrant = (s: AdminSkill) => {
    setEditId(null);
    setGrantId(s.id);
    setGrantDraft({
      org: [...(s.grants?.org || [])],
      team: [...(s.grants?.team || [])],
      user: [...(s.grants?.user || [])],
    });
  };

  const saveGrant = async () => {
    if (!grantId) return;
    setSopErr("");
    setSopNotice("");
    try {
      await api.saveSkillGrants(grantId, grantDraft);
      setSopNotice(`技能「${skills.find((row) => row.id === grantId)?.title || grantId}」分配已保存`);
      await load();
      setGrantId(null);
    } catch (e) {
      setSopErr(String(e));
    }
  };

  const createSkill = async () => {
    setSopErr("");
    setSopNotice("");
    setCreating(true);
    try {
      await api.createAdminSkill({
        ...createDraft,
        aliases: createDraft.aliases,
      });
      setSopNotice(`技能「${createDraft.title || createDraft.id}」已发布`);
      setCreateDraft((cur) => ({ ...cur, id: "", title: "", description: "", aliases: "" }));
      await load();
    } catch (e) {
      setSopErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const toggleMarket = async (s: AdminSkill) => {
    setSopErr("");
    setSopNotice("");
    try {
      await api.patchAdminSkill(s.id, { in_market: !s.in_market });
      setSopNotice(s.in_market ? `技能「${s.title}」已下架` : `技能「${s.title}」已上架`);
      await load();
    } catch (e) {
      setSopErr(e instanceof Error ? e.message : String(e));
    }
  };

  const removeSkill = async (s: AdminSkill) => {
    if (s.source !== "published") return;
    setSopErr("");
    setSopNotice("");
    try {
      await api.deleteAdminSkill(s.id);
      setSopNotice(`技能「${s.title}」已删除`);
      await load();
    } catch (e) {
      setSopErr(e instanceof Error ? e.message : String(e));
    }
  };

  const toggle = (key: "org" | "team" | "user", id: string) => {
    setGrantDraft((cur) => {
      const has = cur[key].includes(id);
      return { ...cur, [key]: has ? cur[key].filter((x) => x !== id) : [...cur[key], id] };
    });
  };

  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => {
    return skills.filter((s) => {
      if (!needle) return true;
      return (s.id + s.title + (s.summary || "")).toLowerCase().includes(needle);
    });
  }, [skills, needle]);
  const publishedSkills = useMemo(() => shown.filter((s) => s.source === "published"), [shown]);

  if (!loggedIn) {
    return (
      <div className="hub-page" data-admin-page="login" data-skill-admin={embedded ? "embedded" : "standalone"}>
        {!embedded && (
          <>
            <div className="page-kicker">协作</div>
            <h1 style={{ marginTop: 0 }}>管理配置</h1>
          </>
        )}
        <form
          className="panel admin-login"
          data-admin-login
          onSubmit={(e) => {
            e.preventDefault();
            void onLogin();
          }}
        >
          <h3>产品经理登录</h3>
          <p className="muted">可用邮箱 sriphy.yan@amperetime.com、账号 鄢棽 / sriphy，或已保存的手机号。运营在技能页只选用动作，不能改技能说明。</p>
          {loginErr && <p className="error">{loginErr}</p>}
          <label className="sop-field">
            邮箱、手机或账号
            <input data-login-name value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" placeholder="sriphy.yan@amperetime.com" />
          </label>
          <label className="sop-field">
            密码
            <input
              data-login-password
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          <button type="submit" className="btn" data-login-submit>
            登录
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="hub-page" data-admin-page="ready" data-skill-admin={embedded ? "embedded" : "standalone"}>
      {!embedded && (
        <>
      <header className="hub-chrome">
        <div>
          <div className="page-kicker">协作</div>
          <h1 style={{ margin: 0 }}>管理配置</h1>
        </div>
        <div className="hub-tools">
          <span className="muted">产品经理 · 鄢棽</span>
          <button type="button" className="btn" data-logout onClick={() => void onLogout()}>
            退出
          </button>
        </div>
      </header>
      <div className="hub-chips" role="tablist" aria-label="管理分区">
        <button type="button" className={"hub-chip" + (tab === "skills" ? " on" : "")} data-admin-tab="skills" onClick={() => setTab("skills")}>
          技能
        </button>
        <button
          type="button"
          className="hub-chip"
          data-admin-tab="connectors"
          onClick={() => nav("/admin/connectors")}
        >
          连接器枢纽
        </button>
      </div>
        </>
      )}

      {(embedded || tab === "skills") && (
        <>
          {dialog}
          <div className="panel" data-sop-policy>
            <p className="muted">{data?.sop?.note || "技能说明在本页维护。运营在技能页只能选用动作。"}</p>
            <p className="muted">新建技能会写入运行时目录，下一轮 Codex turn 即可 extraRoots / config/write 生效。</p>
          </div>
          {sopNotice && <p className="admin-receipt status-ok" data-admin-receipt role="status">{sopNotice}</p>}
          {sopErr && <p className="error">{sopErr}</p>}
          <form
            className="panel sop-editor"
            data-skill-create
            onSubmit={(e) => {
              e.preventDefault();
              ask(skillPublishConfirm(createDraft.title, createDraft.id, createDraft.in_market), () => createSkill());
            }}
          >
            <h3>新建技能</h3>
            <label className="sop-field">
              主键
              <input
                data-skill-create-id
                value={createDraft.id}
                onChange={(e) => setCreateDraft((cur) => ({ ...cur, id: e.target.value }))}
                placeholder="daily_brief"
                required
                pattern="[a-z][a-z0-9_]{1,39}"
              />
            </label>
            <label className="sop-field">
              名称
              <input
                data-skill-create-title
                value={createDraft.title}
                onChange={(e) => setCreateDraft((cur) => ({ ...cur, title: e.target.value }))}
                required
                maxLength={80}
              />
            </label>
            <label className="sop-field">
              一句话
              <input
                data-skill-create-summary
                value={createDraft.description}
                onChange={(e) => setCreateDraft((cur) => ({ ...cur, description: e.target.value }))}
                maxLength={200}
              />
            </label>
            <label className="sop-field">
              分组
              <input
                value={createDraft.category}
                onChange={(e) => setCreateDraft((cur) => ({ ...cur, category: e.target.value }))}
              />
            </label>
            <label className="sop-field">
              Profile
              <select
                data-skill-create-profile
                value={createDraft.profile}
                onChange={(e) => setCreateDraft((cur) => ({ ...cur, profile: e.target.value }))}
              >
                {(meta.profiles.length ? meta.profiles : ["commander"]).map((id) => (
                  <option key={id} value={id}>{id}</option>
                ))}
              </select>
            </label>
            <label className="sop-field">
              漏斗
              <select
                data-skill-create-funnel
                value={createDraft.funnel}
                onChange={(e) => setCreateDraft((cur) => ({ ...cur, funnel: e.target.value }))}
              >
                {FUNNEL.map((f) => (
                  <option key={f.id} value={f.id}>{f.label}</option>
                ))}
              </select>
            </label>
            <label className="sop-field">
              别名
              <input
                value={createDraft.aliases}
                onChange={(e) => setCreateDraft((cur) => ({ ...cur, aliases: e.target.value }))}
                placeholder="逗号分隔"
              />
            </label>
            <label className="sop-field">
              <input
                type="checkbox"
                checked={createDraft.in_market}
                onChange={(e) => setCreateDraft((cur) => ({ ...cur, in_market: e.target.checked }))}
              />
              发布到员工技能目录
            </label>
            <label className="sop-field">
              技能说明
              <textarea
                data-skill-create-body
                value={createDraft.body}
                onChange={(e) => setCreateDraft((cur) => ({ ...cur, body: e.target.value }))}
                rows={8}
                required
              />
            </label>
            <div className="skill-card-actions">
              <button type="submit" className="btn work" disabled={creating} data-skill-create-save>
                {creating ? "发布中…" : "发布并写入 Codex"}
              </button>
            </div>
          </form>
          <section className="panel" data-admin-skills>
            <div className="admin-section-head">
              <div>
                <h2>技能治理</h2>
                <p className="muted">主键、上架、分配和最近改说明。漏斗分类只在员工目录使用。</p>
              </div>
              <label className="hub-search-wrap">
                <input className="hub-search" placeholder="搜索主键或名称" value={q} onChange={(e) => setQ(e.target.value)} />
              </label>
            </div>
            <div className="admin-table-wrap">
              <table className="admin-table" data-admin-skills-table>
                <thead>
                  <tr>
                    <th>主键</th>
                    <th>上架</th>
                    <th>分配</th>
                    <th>最近改说明</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((s) => (
                    <tr
                      key={s.id}
                      data-skill={s.id}
                      data-skill-source={s.source || "bundled"}
                    >
                      <td>
                        <strong>{s.id}</strong>
                        <p className="muted">{s.title} · {skillKind(s)}</p>
                      </td>
                      <td>
                        <span className={"admin-status is-" + (s.in_market ? "configured" : "unattached")}>
                          {s.in_market ? "已上架" : "未上架"}
                        </span>
                      </td>
                      <td>{grantLine(s.grants)}</td>
                      <td>{lastEditLabel(s)}</td>
                      <td className="admin-inline-actions">
                        <button type="button" className="btn sm" data-skill-sop={s.id} onClick={() => void openSop(s)}>
                          编辑说明
                        </button>
                        <button type="button" className="btn sm" data-skill-grant={s.id} onClick={() => openGrant(s)}>
                          分配
                        </button>
                        <button
                          type="button"
                          className="btn sm"
                          data-skill-market={s.id}
                          onClick={() => {
                            if (s.in_market) {
                              ask(skillUnpublishConfirm(s.title, s.id), () => toggleMarket(s));
                              return;
                            }
                            ask(skillListConfirm(s.title, s.id), () => toggleMarket(s));
                          }}
                        >
                          {s.in_market ? "下架" : "上架"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!shown.length && <p className="muted">没有匹配的技能。</p>}
          </section>
          {publishedSkills.length > 0 && (
            <section className="panel admin-danger-zone" data-admin-skill-danger>
              <h2>危险区</h2>
              <p className="muted">删除已发布技能包。内置技能不能删除。下架不会出现在这里。</p>
              {publishedSkills.map((s) => (
                <article className="admin-row" key={s.id} data-skill-danger={s.id}>
                  <div>
                    <strong>{s.id}</strong>
                    <p className="muted">{s.title}</p>
                  </div>
                  <button
                    type="button"
                    className="btn danger"
                    data-skill-delete={s.id}
                    onClick={() => ask(skillDeleteConfirm(s.title, s.id), () => removeSkill(s))}
                  >
                    删除
                  </button>
                </article>
              ))}
            </section>
          )}
          {editId && (
            <form
              className="panel sop-editor"
              data-sop-editor={editId}
              onSubmit={(e) => {
                e.preventDefault();
                void saveSop();
              }}
            >
              <h3>编辑说明 · {skills.find((r) => r.id === editId)?.title || "当前技能"}</h3>
              <p className="muted">
                {skills.find((r) => r.id === editId)?.source === "published"
                  ? "保存后会改写发布包并写入 Codex 运行时目录。"
                  : "保存后立即对运营生效，技能摘要会一起更新。仓库默认文件不变。"}
              </p>
              {skills.find((r) => r.id === editId)?.source === "published" && (
                <>
                  <label className="sop-field">
                    名称
                    <input data-sop-title value={sopTitle} onChange={(e) => setSopTitle(e.target.value)} maxLength={80} />
                  </label>
                  <label className="sop-field">
                    别名
                    <input data-sop-aliases value={sopAliases} onChange={(e) => setSopAliases(e.target.value)} placeholder="逗号分隔" />
                  </label>
                </>
              )}
              <label className="sop-field">
                一句话
                <input data-sop-summary value={sopSummary} onChange={(e) => setSopSummary(e.target.value)} maxLength={200} />
              </label>
              <label className="sop-field">
                技能说明
                <textarea data-sop-body value={sopBody} onChange={(e) => setSopBody(e.target.value)} rows={12} />
              </label>
              <div className="skill-card-actions">
                <button type="submit" className="btn" disabled={sopSaving} data-sop-save>
                  {sopSaving ? "保存中…" : "保存说明"}
                </button>
                <button type="button" className="btn" disabled={sopSaving} data-sop-reset onClick={() => void resetSop()}>
                  恢复默认
                </button>
                <button type="button" className="btn" onClick={() => setEditId(null)}>
                  取消
                </button>
              </div>
            </form>
          )}
          {grantId && (
            <div className="panel" data-grant-editor={grantId}>
              <h3>分配 · {skills.find((r) => r.id === grantId)?.title || grantId}</h3>
              <p className="muted">组织、团队、个人任一命中即可使用。个人技能和管理技能共用这一份授权。</p>
              <div className="grant-cols">
                <fieldset>
                  <legend>组织</legend>
                  {dir.orgs.map((o) => (
                    <label key={o.id}>
                      <input type="checkbox" checked={grantDraft.org.includes(o.id)} onChange={() => toggle("org", o.id)} />
                      {o.name}
                    </label>
                  ))}
                </fieldset>
                <fieldset>
                  <legend>团队</legend>
                  {dir.teams.map((t) => (
                    <label key={t.id}>
                      <input type="checkbox" checked={grantDraft.team.includes(t.id)} onChange={() => toggle("team", t.id)} />
                      {t.name}
                    </label>
                  ))}
                </fieldset>
                <fieldset>
                  <legend>个人</legend>
                  {dir.users.map((u) => (
                    <label key={u.handle}>
                      <input
                        type="checkbox"
                        data-grant-user={u.handle}
                        checked={grantDraft.user.includes(u.handle)}
                        onChange={() => toggle("user", u.handle)}
                      />
                      {u.name}
                    </label>
                  ))}
                </fieldset>
              </div>
              <div className="skill-card-actions">
                <button
                  type="button"
                  className="btn"
                  data-grant-save
                  onClick={() => {
                    const row = skills.find((item) => item.id === grantId);
                    ask(skillGrantSaveConfirm(row?.title || grantId || "", grantDraft), () => saveGrant());
                  }}
                >
                  保存分配
                </button>
                <button type="button" className="btn" onClick={() => setGrantId(null)}>
                  取消
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {!embedded && tab === "connectors" && (
        <div className="panel">
          <h3>连接器已并入治理枢纽</h3>
          <p className="muted">组织连接器目录、启停和授权只在管理端枢纽维护，不再在本页并列一份清单。</p>
          <button type="button" className="btn work" onClick={() => nav("/admin/connectors")}>打开连接器枢纽</button>
        </div>
      )}
    </div>
  );
}
