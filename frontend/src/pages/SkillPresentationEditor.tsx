import { useEffect, useState } from "react";
import { api } from "../api";
import { SKILL_ICON_LIBRARY } from "../skillIcons";
import { FUNNEL } from "./SkillHub";

type PresentationSkill = {
  id: string;
  category?: string;
  funnel?: string;
  aliases?: string[];
  icon?: string | null;
  badge?: string | null;
  starter?: string | null;
  next_actions?: Array<Record<string, unknown>>;
  source?: string;
};

type Fields = { icon: string; badge: string; category: string; funnel: string; aliases: string; starter: string; next_actions: string };

function fieldsOf(skill: PresentationSkill, patch: Record<string, unknown> = {}): Fields {
  const aliases = patch.aliases ?? skill.aliases ?? [];
  return {
    icon: String(patch.icon ?? skill.icon ?? ""),
    badge: String(patch.badge ?? skill.badge ?? ""),
    category: String(patch.category ?? skill.category ?? ""),
    funnel: String(patch.funnel ?? skill.funnel ?? "reach"),
    aliases: Array.isArray(aliases) ? aliases.map(String).join("，") : String(aliases),
    starter: String(patch.starter ?? skill.starter ?? ""),
    next_actions: JSON.stringify(patch.next_actions ?? skill.next_actions ?? [], null, 2),
  };
}

/**
 * 展示元数据（作者声明，写入技能 md）：图标、来源徽章、分类、漏斗、常见说法、填空模板、下一步动作。
 * 保存只形成草稿；发布时才生效。内置技能的这些字段经覆盖层发布，运行契约仍随代码发布。
 */
export function SkillPresentationEditor({ skill, onSaved }: { skill: PresentationSkill; onSaved: () => Promise<void> | void }) {
  const [initial, setInitial] = useState<Fields>(() => fieldsOf(skill));
  const [fields, setFields] = useState<Fields>(() => fieldsOf(skill));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    void api.adminSkillDraft(skill.id).then((draft) => {
      if (!active) return;
      const next = fieldsOf(skill, draft.patch);
      setInitial(fieldsOf(skill));
      setFields(next);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [skill]);

  const set = (key: keyof Fields) => (value: string) => setFields((current) => ({ ...current, [key]: value }));

  async function save() {
    setBusy(true);
    setNotice("");
    try {
      const patch: Record<string, unknown> = {};
      for (const key of ["icon", "badge", "category", "funnel", "starter"] as const) {
        if (fields[key] !== initial[key] && fields[key].trim()) patch[key] = fields[key].trim();
      }
      if (fields.aliases !== initial.aliases) patch.aliases = fields.aliases.split(/[,，]/).map((item) => item.trim()).filter(Boolean);
      if (fields.next_actions !== initial.next_actions) {
        try { patch.next_actions = JSON.parse(fields.next_actions); }
        catch { setNotice("下一步动作必须是 JSON 数组。"); return; }
      }
      if (!Object.keys(patch).length) { setNotice("没有改动。"); return; }
      await api.saveAdminSkillDraft(skill.id, patch);
      setNotice("展示信息已保存为未发布草稿；发布后员工端才会看到。");
      await onSaved();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "保存展示信息失败");
    } finally {
      setBusy(false);
    }
  }

  return <section className="skill-detail-card" aria-labelledby="skill-presentation-heading" data-skill-presentation>
    <div className="skill-section-head"><div><h3 id="skill-presentation-heading">展示信息</h3><p>写入技能文件头部；{skill.source === "bundled" ? "内置技能的展示信息可在此覆盖，运行契约仍随平台发布。" : "保存后先形成未发布草稿。"}</p></div></div>
    <label className="skill-content-field">图标<select value={fields.icon} onChange={(event) => set("icon")(event.target.value)}><option value="">通用图标</option>{Object.keys(SKILL_ICON_LIBRARY).map((key) => <option key={key} value={key}>{key}</option>)}</select></label>
    <label className="skill-content-field">来源徽章<input value={fields.badge} maxLength={12} placeholder="如：达人库、AI 助理、平台内置" onChange={(event) => set("badge")(event.target.value)} /></label>
    <label className="skill-content-field">分类<input value={fields.category} maxLength={20} onChange={(event) => set("category")(event.target.value)} /></label>
    <label className="skill-content-field">业务漏斗<select value={fields.funnel} onChange={(event) => set("funnel")(event.target.value)}>{FUNNEL.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}</select></label>
    <label className="skill-content-field">常见说法（逗号分隔）<input value={fields.aliases} onChange={(event) => set("aliases")(event.target.value)} /></label>
    <label className="skill-content-field">填空模板<input value={fields.starter} maxLength={300} placeholder="如：达人画像 [达人昵称或主页]" onChange={(event) => set("starter")(event.target.value)} /></label>
    <label className="skill-content-field">下一步动作（JSON）<textarea value={fields.next_actions} rows={5} spellCheck={false} onChange={(event) => set("next_actions")(event.target.value)} /></label>
    <div className="skill-contract-actions"><button type="button" className="skill-governance-secondary" disabled={busy} onClick={() => void save()}>{busy ? "保存中…" : "保存展示信息草稿"}</button><span role="status">{notice || "未发布草稿不会改变员工当前看到的内容。"}</span></div>
  </section>;
}
