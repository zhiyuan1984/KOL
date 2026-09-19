import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { storePending } from "../components/ChatBlocks";
import { rememberJourney } from "../journey";
import { skillKind, type SkillRow } from "./SkillHub";

// 分组配置
const GROUPS: { id: string; label: string; hint: string; funnel: string[] }[] = [
  { id: "reach", label: "建联阶段", hint: "寻找目标达人，建立初步联系", funnel: ["reach"] },
  { id: "intent", label: "意向评估", hint: "评估达人质量与合作可能性", funnel: ["intent"] },
  { id: "biz", label: "报价与寄样", hint: "推进合作，处理报价与寄样流程", funnel: ["biz", "sample"] },
  { id: "settle", label: "成交与沉淀", hint: "完善合作并沉淀数据资产", funnel: ["settle"] },
  { id: "content", label: "内容发布", hint: "内容发布与效果追踪", funnel: ["content"] },
  { id: "exception", label: "异常旁路", hint: "风险扫描与异常处理", funnel: ["exception"] },
];

const TABS = [
  { id: "all", label: "全部" },
  { id: "frequent", label: "常用" },
  { id: "recent", label: "最近使用" },
  { id: "recommend", label: "推荐" },
  { id: "reach", label: "建联" },
  { id: "intent", label: "意向" },
  { id: "biz", label: "报价" },
  { id: "sample", label: "寄样" },
  { id: "settle", label: "成交" },
  { id: "content", label: "数据分析" },
];

const USAGE_KEY = "skill:usage";
const RECENT_KEY = "skill:recent";

function loadUsage(): Record<string, number> {
  try {
    const raw = localStorage.getItem(USAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveUsage(usage: Record<string, number>) {
  localStorage.setItem(USAGE_KEY, JSON.stringify(usage));
}

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRecent(recent: string[]) {
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
}

function recordUsage(skillId: string) {
  const usage = loadUsage();
  usage[skillId] = (usage[skillId] || 0) + 1;
  saveUsage(usage);

  const recent = loadRecent().filter((id) => id !== skillId);
  recent.unshift(skillId);
  saveRecent(recent.slice(0, 20));
}

// 推荐技能（静态规则）
const RECOMMENDED_IDS = ["creator_discovery", "creator_profile", "creator_scoring", "today_plan"];

// 场景标签映射
const SCENE_TAGS: Record<string, string[]> = {
  creator_discovery: ["建联阶段", "私信触达"],
  creator_profile: ["建联阶段", "达人分析"],
  creator_scoring: ["意向评估", "评分排序"],
  creator_outreach: ["建联阶段", "私信触达", "加微信话术"],
  email_compose: ["报价", "邮件沟通"],
  today_plan: ["日常运营", "任务规划"],
  reply_analysis: ["意向评估", "邮件分析"],
  deal_memory: ["成交", "商务谈判"],
};

// 输入/输出描述
const IO_MAP: Record<string, { inputs: string[]; outputs: string[] }> = {
  creator_outreach: {
    inputs: ["达人名称", "平台（如小红书/抖音）", "粉丝量", "合作目标（如寄样、推广、长期合作）"],
    outputs: ["首轮私信话术", "跟进话术", "微信添加文案"],
  },
  creator_discovery: {
    inputs: ["关键词", "平台", "粉丝量范围"],
    outputs: ["候选达人列表", "达人基础信息"],
  },
  creator_profile: {
    inputs: ["达人UID或昵称"],
    outputs: ["达人详情", "平台数据", "负责人信息"],
  },
  creator_scoring: {
    inputs: ["达人UID列表"],
    outputs: ["影响力评分", "合作适配度评分"],
  },
};

function SkillCard({
  skill,
  onUse,
  onNewSession,
  isFrequent,
}: {
  skill: SkillRow;
  onUse: (skill: SkillRow) => void;
  onNewSession: (skill: SkillRow) => void;
  isFrequent: boolean;
}) {
  return (
    <div className="skill-card" data-skill-id={skill.id}>
      <div className="skill-card-icon">
        {skill.title.slice(0, 1)}
        {isFrequent && <span className="skill-frequent-star">★</span>}
      </div>
      <div className="skill-card-body">
        <div className="skill-card-title">
          {skill.title}
          <span className="skill-card-source">{skill.source === "published" ? "自建" : "Starry KOL"}</span>
        </div>
        <p className="skill-card-desc">{skill.summary || skill.title}</p>
        <div className="skill-card-actions">
          <button type="button" className="skill-btn skill-btn-primary" onClick={() => onUse(skill)}>
            <span className="skill-btn-icon">+</span>
            插入当前会话
          </button>
          <button type="button" className="skill-btn skill-btn-secondary" onClick={() => onNewSession(skill)}>
            新建会话
          </button>
        </div>
      </div>
    </div>
  );
}

function PreviewPanel({ skill }: { skill: SkillRow | null }) {
  if (!skill) {
    return (
      <div className="skill-preview-empty">
        <p>点击左侧技能卡片查看详情</p>
      </div>
    );
  }

  const scenes = SCENE_TAGS[skill.id] || [skill.funnel || "通用"];
  const io = IO_MAP[skill.id] || { inputs: ["相关参数"], outputs: ["分析结果"] };

  return (
    <div className="skill-preview">
      <div className="skill-preview-header">
        <h3>预览</h3>
        <button type="button" className="skill-preview-expand" aria-label="展开">
          ⤢
        </button>
      </div>
      <div className="skill-preview-body">
        <div className="skill-preview-title">
          <h2>{skill.title}</h2>
          <span className="skill-preview-tag">{skillKind(skill)}</span>
          <span className="skill-preview-agent">KOL Agent</span>
        </div>
        <p className="skill-preview-desc">{skill.summary || skill.title}</p>

        <div className="skill-preview-section">
          <h4>适用场景</h4>
          <div className="skill-preview-tags">
            {scenes.map((s) => (
              <span key={s} className="skill-preview-tag-item">{s}</span>
            ))}
          </div>
        </div>

        <div className="skill-preview-section">
          <h4>输入内容</h4>
          <p className="skill-preview-hint">提供以下信息，生成更个性化的话术：</p>
          <div className="skill-preview-tags">
            {io.inputs.map((s) => (
              <span key={s} className="skill-preview-tag-item">{s}</span>
            ))}
          </div>
        </div>

        <div className="skill-preview-section">
          <h4>输出结果</h4>
          <div className="skill-preview-tags">
            {io.outputs.map((s) => (
              <span key={s} className="skill-preview-tag-item">{s}</span>
            ))}
          </div>
        </div>

        <div className="skill-preview-section">
          <h4>内容示例</h4>
          <div className="skill-preview-example">
            <p>Hi@夏天的旅行日记 👋</p>
            <p>我是 LiTime 的产品运营，关注到你分享的户外生活内容，非常喜欢！我们正在做一款适合户外场景的便携装备，想和你合作体验。不知道你是否有兴趣？期待你的回复~</p>
          </div>
        </div>
      </div>
      <div className="skill-preview-footer">
        <button type="button" className="skill-btn skill-btn-primary skill-btn-large">
          <span className="skill-btn-icon">+</span>
          插入当前会话
        </button>
        <button type="button" className="skill-btn skill-btn-secondary skill-btn-large">
          查看详情
        </button>
      </div>
    </div>
  );
}

export function SkillCatalog() {
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("all");
  const [selectedSkill, setSelectedSkill] = useState<SkillRow | null>(null);
  const [usage, setUsage] = useState<Record<string, number>>(() => loadUsage());
  const [recent, setRecent] = useState<string[]>(() => loadRecent());
  const nav = useNavigate();
  const location = useLocation();

  useEffect(() => {
    setLoading(true);
    api.skills()
      .then((data: unknown) => {
        setSkills(Array.isArray(data) ? (data as SkillRow[]) : []);
        setErr("");
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "无法加载技能目录"))
      .finally(() => setLoading(false));
  }, []);

  const filteredSkills = useMemo(() => {
    let list = skills;

    // 标签筛选
    if (tab === "frequent") {
      list = list.filter((s) => (usage[s.id] || 0) > 0).sort((a, b) => (usage[b.id] || 0) - (usage[a.id] || 0));
    } else if (tab === "recent") {
      list = recent.map((id) => skills.find((s) => s.id === id)).filter(Boolean) as SkillRow[];
    } else if (tab === "recommend") {
      list = list.filter((s) => RECOMMENDED_IDS.includes(s.id));
    } else if (tab !== "all") {
      list = list.filter((s) => s.funnel === tab);
    }

    // 搜索
    const needle = q.trim().toLowerCase();
    if (needle) {
      list = list.filter((s) =>
        s.title.toLowerCase().includes(needle) ||
        (s.summary || "").toLowerCase().includes(needle) ||
        (s.label || "").toLowerCase().includes(needle)
      );
    }

    return list;
  }, [skills, tab, q, usage, recent]);

  const frequentSkills = useMemo(() => {
    return skills
      .filter((s) => (usage[s.id] || 0) > 0)
      .sort((a, b) => (usage[b.id] || 0) - (usage[a.id] || 0))
      .slice(0, 4);
  }, [skills, usage]);

  const groupedSkills = useMemo(() => {
    const groups: Record<string, SkillRow[]> = {};
    for (const group of GROUPS) {
      groups[group.id] = filteredSkills.filter((s) => group.funnel.includes(s.funnel || ""));
    }
    return groups;
  }, [filteredSkills]);

  const useSkill = async (skill: SkillRow) => {
    recordUsage(skill.id);
    setUsage(loadUsage());
    setRecent(loadRecent());

    // 如果当前在会话页面，直接发送消息
    const sessionMatch = location.pathname.match(/^\/s\/([^/]+)/);
    if (sessionMatch) {
      const sessionId = sessionMatch[1];
      try {
        await api.postMessage(sessionId, { text: `@${skill.label || skill.title}`, intent: skill.id });
        window.location.reload();
      } catch (e) {
        setErr(String(e));
      }
      return;
    }

    // 否则创建新会话
    try {
      const prompt = `@${skill.label || skill.title}`;
      const ses = await api.createSession(prompt.slice(0, 24));
      storePending(ses.id, { text: prompt, intent: skill.id });
      rememberJourney({ kind: "skill", skillId: skill.id, skillLabel: skill.label || skill.title });
      nav(`/s/${ses.id}`);
    } catch (e) {
      setErr(String(e));
    }
  };

  const newSession = async (skill: SkillRow) => {
    recordUsage(skill.id);
    setUsage(loadUsage());
    setRecent(loadRecent());

    try {
      const prompt = `@${skill.label || skill.title}`;
      const ses = await api.createSession(prompt.slice(0, 24));
      storePending(ses.id, { text: prompt, intent: skill.id });
      rememberJourney({ kind: "skill", skillId: skill.id, skillLabel: skill.label || skill.title });
      nav(`/s/${ses.id}`);
    } catch (e) {
      setErr(String(e));
    }
  };

  return (
    <div className="skill-catalog-page" data-skill-catalog>
      <header className="skill-catalog-header">
        <div>
          <h1>技能目录</h1>
          <p className="skill-catalog-subtitle">按业务阶段查找并调用技能，可直接插入当前会话。</p>
        </div>
        <label className="skill-search-wrap">
          <svg viewBox="0 0 24 24" aria-hidden>
            <circle cx="11" cy="11" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
            <path d="M16 16.4 20 20.4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
          <input
            className="skill-search"
            placeholder="搜索技能 / SOP / 场景"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
      </header>

      <div className="skill-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`skill-tab${tab === t.id ? " on" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {err && <p className="error" role="alert">{err}</p>}
      {loading && !err && <p className="muted">正在加载技能…</p>}

      <div className="skill-catalog-main">
        <div className="skill-catalog-content">
          {frequentSkills.length > 0 && tab === "all" && !q && (
            <section className="skill-group">
              <div className="skill-group-header">
                <span className="skill-group-icon">★</span>
                <h2>常用技能</h2>
                <span className="skill-group-hint">你经常使用的技能，点击即可快速调用</span>
                <Link to="/skills?tab=frequent" className="skill-group-more">查看全部</Link>
              </div>
              <div className="skill-grid">
                {frequentSkills.map((s) => (
                  <SkillCard
                    key={s.id}
                    skill={s}
                    onUse={(skill) => { setSelectedSkill(skill); void useSkill(skill); }}
                    onNewSession={(skill) => { setSelectedSkill(skill); void newSession(skill); }}
                    isFrequent
                  />
                ))}
              </div>
            </section>
          )}

          {GROUPS.map((group) => {
            const groupSkills = groupedSkills[group.id] || [];
            if (groupSkills.length === 0) return null;
            return (
              <section key={group.id} className="skill-group">
                <div className="skill-group-header">
                  <span className={`skill-group-icon skill-group-icon-${group.id}`}>
                    {group.id === "reach" ? "✈" : group.id === "intent" ? "📊" : group.id === "biz" ? "📦" : group.id === "settle" ? "🏆" : "📌"}
                  </span>
                  <h2>{group.label}</h2>
                  <span className="skill-group-hint">{group.hint}</span>
                  <Link to={`/skills?tab=${group.id}`} className="skill-group-more">查看全部</Link>
                </div>
                <div className="skill-grid">
                  {groupSkills.map((s) => (
                    <SkillCard
                      key={s.id}
                      skill={s}
                      onUse={(skill) => { setSelectedSkill(skill); void useSkill(skill); }}
                      onNewSession={(skill) => { setSelectedSkill(skill); void newSession(skill); }}
                      isFrequent={(usage[s.id] || 0) > 0}
                    />
                  ))}
                </div>
              </section>
            );
          })}

          {!loading && filteredSkills.length === 0 && (
            <p className="muted">没有匹配的技能</p>
          )}
        </div>

        <aside className="skill-catalog-preview">
          <PreviewPanel skill={selectedSkill} />
        </aside>
      </div>
    </div>
  );
}
