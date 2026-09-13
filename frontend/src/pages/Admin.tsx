import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { FUNNEL, HubTile, skillFunnel, skillKind, type SkillRow } from "./SkillHub";

type AdminSkill = SkillRow & {
  grants?: { org: string[]; team: string[]; user: string[] };
  funnel?: string;
  summary?: string;
  source?: "bundled" | "published";
  aliases?: string[];
};

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
  const [chip, setChip] = useState("reach");
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
    try {
      await api.saveSkillGrants(grantId, grantDraft);
      await load();
      setGrantId(null);
    } catch (e) {
      setSopErr(String(e));
    }
  };

  const createSkill = async () => {
    setSopErr("");
    setCreating(true);
    try {
      await api.createAdminSkill({
        ...createDraft,
        aliases: createDraft.aliases,
      });
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
    try {
      await api.patchAdminSkill(s.id, { in_market: !s.in_market });
      await load();
    } catch (e) {
      setSopErr(e instanceof Error ? e.message : String(e));
    }
  };

  const removeSkill = async (s: AdminSkill) => {
    if (s.source !== "published") return;
    setSopErr("");
    try {
      await api.deleteAdminSkill(s.id);
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
      if (skillFunnel(s) !== chip) return false;
      if (!needle) return true;
      return (s.title + (s.summary || "")).toLowerCase().includes(needle);
    });
  }, [skills, chip, needle]);

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
          <div className="panel" data-sop-policy>
            <p className="muted">{data?.sop?.note || "技能说明在本页维护。运营在技能页只能选用动作。"}</p>
            <p className="muted">新建技能会写入运行时目录，下一轮 Codex turn 即可 extraRoots / config/write 生效。</p>
          </div>
          {sopErr && <p className="error">{sopErr}</p>}
          <form
            className="panel sop-editor"
            data-skill-create
            onSubmit={(e) => {
              e.preventDefault();
              void createSkill();
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
          <label className="hub-search-wrap" style={{ width: 240 }}>
            <input className="hub-search" placeholder="搜索技能" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <div className="hub-chips" role="tablist" aria-label="建联进度">
            {FUNNEL.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                className={"hub-chip" + (chip === f.id ? " on" : "")}
                data-funnel-tab={f.id}
                onClick={() => setChip(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <section className="skill-funnel" data-funnel={chip} data-admin-skills>
            <h2 className="hub-section-title">
              {FUNNEL.find((f) => f.id === chip)?.label}
              <span className="hub-section-hint">{FUNNEL.find((f) => f.id === chip)?.hint}</span>
            </h2>
            <div className="hub-grid">
              {shown.map((s) => (
                <HubTile
                  key={s.id}
                  id={s.id}
                  title={s.title}
                  kind={skillKind(s)}
                  summary={s.summary || s.title}
                  dataKey="data-skill"
                  plusLabel={"编辑 " + s.title}
                  sopMark
                  badge={s.in_market ? undefined : "未上架"}
                  onPlus={() => void openSop(s)}
                  actions={
                    <span className="hub-tile-actions">
                      <button type="button" className="btn" data-skill-sop={s.id} onClick={() => void openSop(s)}>
                        编辑说明
                      </button>
                      <button type="button" className="btn" data-skill-grant={s.id} onClick={() => openGrant(s)}>
                        分配
                      </button>
                      <button type="button" className="btn" data-skill-market={s.id} onClick={() => void toggleMarket(s)}>
                        {s.in_market ? "下架" : "上架"}
                      </button>
                      {s.source === "published" && (
                        <button type="button" className="btn" data-skill-delete={s.id} onClick={() => void removeSkill(s)}>
                          删除
                        </button>
                      )}
                    </span>
                  }
                />
              ))}
              {chip === "settle" && (
                <HubTile
                  id="attribution_review"
                  title="归因复盘"
                  kind="暂未开放"
                  summary="本期还不能做转化归因。超时或失联请先用风险扫描。"
                  dataKey="data-skill"
                  plusLabel="未开放"
                  disabled
                  onPlus={() => undefined}
                />
              )}
            </div>
          </section>
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
                <button type="button" className="btn" data-grant-save onClick={() => void saveGrant()}>
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
