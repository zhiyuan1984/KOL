import { useCallback, useMemo, useState } from "react";
import { api } from "../../api";
import { knowledgeBindingDeleteConfirm } from "../../adminConfirm";
import { useAdminConfirm } from "../../components/ConfirmDialog";
import {
  KB_ADMIN_ACTION,
  KB_ADMIN_EMPTY,
  SKILL_OPTIONS,
  brandLabel,
  formatKbTime,
  kbSkipReasonLabel,
  kindLabel,
  skillLabel,
} from "../../knowledgeCopy";
import {
  KB_BRANDS,
  KB_KINDS,
  KB_LANGS,
  KB_STAGE_OPTIONS,
  asArray,
  selectorSummary,
  splitList,
  textValue,
  useKbData,
  type KbFeed,
  type Row,
} from "./shared";

type BindingDraft = {
  id: string;
  skill_id: string;
  ids: string;
  kinds: string;
  tags: string;
  stage_codes: string;
  brand: string;
  lang: string;
  enabled: boolean;
  note: string;
};

const EMPTY_DRAFT: BindingDraft = {
  id: "",
  skill_id: "email_compose",
  ids: "",
  kinds: "",
  tags: "",
  stage_codes: "",
  brand: "",
  lang: "",
  enabled: true,
  note: "",
};

function draftFromRow(row: Row): BindingDraft {
  const selector = (row.selector && typeof row.selector === "object" ? row.selector : {}) as Row;
  return {
    id: String(row.id || ""),
    skill_id: String(row.skill_id || ""),
    ids: asArray(selector.ids).join(" "),
    kinds: asArray(selector.kinds).join(" "),
    tags: asArray(selector.tags).join(" "),
    stage_codes: asArray(selector.stage_codes).join(" "),
    brand: textValue(selector.brand),
    lang: textValue(selector.lang),
    enabled: Boolean(Number(row.enabled ?? 1)),
    note: String(row.note || ""),
  };
}

function selectorFromDraft(draft: BindingDraft): Record<string, unknown> {
  const selector: Record<string, unknown> = {};
  const ids = splitList(draft.ids);
  const kinds = splitList(draft.kinds);
  const tags = splitList(draft.tags);
  const stages = splitList(draft.stage_codes);
  if (ids.length) selector.ids = ids;
  if (kinds.length) selector.kinds = kinds;
  if (tags.length) selector.tags = tags;
  if (stages.length) selector.stage_codes = stages;
  if (draft.brand.trim()) selector.brand = draft.brand.trim();
  if (draft.lang.trim()) selector.lang = draft.lang.trim();
  return selector;
}

/** 引用：哪些技能会拿到哪些知识、为什么？—— 保存不等于已注入。 */
export default function BindingsView({ notify, fail }: KbFeed) {
  const { ask, dialog } = useAdminConfirm();
  const load = useCallback(async () => {
    const [bindings, skills] = await Promise.all([
      api.adminKnowledgeBindings(),
      api.skills().catch(() => []),
    ]);
    return { bindings, skills };
  }, []);
  const { data, error, loading, reload } = useKbData(load);
  const [draft, setDraft] = useState<BindingDraft | null>(null);
  const [trialSkill, setTrialSkill] = useState("email_compose");
  const [trialUser, setTrialUser] = useState("");
  const [trialStage, setTrialStage] = useState("");
  const [trialBrand, setTrialBrand] = useState("");
  const [trial, setTrial] = useState<Row | null>(null);
  const [trialBusy, setTrialBusy] = useState(false);

  const bindings = data?.bindings || [];
  const skillOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const option of SKILL_OPTIONS) seen.set(option.id, option.label);
    for (const skill of data?.skills || []) {
      const id = String(skill.id || "");
      if (id) seen.set(id, skillLabel(id));
    }
    return [...seen.entries()].map(([id, label]) => ({ id, label }));
  }, [data?.skills]);

  const run = async (fn: () => Promise<unknown>, message: string) => {
    try {
      await fn();
      notify(message);
      reload();
    } catch (cause) {
      fail(cause);
    }
  };

  const save = async () => {
    if (!draft) return;
    const body: Record<string, unknown> = {
      skill_id: draft.skill_id,
      selector: selectorFromDraft(draft),
      enabled: draft.enabled,
      note: draft.note,
    };
    if (draft.id) body.id = draft.id;
    try {
      await api.adminKnowledgeBindingSave(body);
      notify(draft.id ? "绑定已更新；保存后下次运行生效，尚未注入。" : "绑定已新增；保存后下次运行生效，尚未注入。");
      setDraft(null);
      reload();
    } catch (cause) {
      fail(cause, "保存绑定失败");
    }
  };

  const runPreview = async () => {
    setTrialBusy(true);
    try {
      const result = await api.adminKnowledgeResolvePreview({
        skill_id: trialSkill,
        ...(trialUser.trim() ? { user_id: trialUser.trim() } : {}),
        ...(trialStage ? { stage_code: trialStage } : {}),
        ...(trialBrand ? { brand: trialBrand } : {}),
      });
      setTrial(result as unknown as Row);
    } catch (cause) {
      setTrial(null);
      fail(cause, "试算失败");
    } finally {
      setTrialBusy(false);
    }
  };

  const resolved = ((trial?.resolved as Row[]) || []);
  const skipped = ((trial?.skipped as Row[]) || []);

  return (
    <>
      {dialog}
      {error && <p className="error" role="alert">{error}</p>}
      {loading && !data && <p className="muted" role="status">正在加载绑定…</p>}

      <article className="panel" data-admin-kb-bindings>
        <div className="admin-section-head">
          <div>
            <h2>绑定表</h2>
            <p className="muted">保存后下次运行生效；保存不等于已注入。没有绑定时技能按「本人已启用 + 阶段优先」回退挑选。</p>
          </div>
          <button
            className={draft ? "btn ghost" : "btn work"}
            type="button"
            aria-expanded={Boolean(draft)}
            data-admin-kb-binding-toggle
            onClick={() => setDraft(draft ? null : { ...EMPTY_DRAFT })}
          >
            {draft ? "收起表单" : KB_ADMIN_ACTION.newBinding}
          </button>
        </div>

        {draft ? (
          <form
            className="settings-form kbadmin-form"
            data-admin-kb-binding-form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="kbadmin-form-grid">
              <label className="field">技能
                <select
                  value={draft.skill_id}
                  data-admin-kb-binding-skill
                  onChange={(event) => setDraft({ ...draft, skill_id: event.target.value })}
                >
                  {skillOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
              </label>
              <label className="field">显式 id（空格分隔）
                <input
                  value={draft.ids}
                  data-admin-kb-binding-field="ids"
                  onChange={(event) => setDraft({ ...draft, ids: event.target.value })}
                />
              </label>
              <label className="field">类型
                <select value={draft.kinds} onChange={(event) => setDraft({ ...draft, kinds: event.target.value })}>
                  <option value="">全部类型</option>
                  {KB_KINDS.map((kind) => <option key={kind} value={kind}>{kindLabel(kind)}</option>)}
                </select>
              </label>
              <label className="field">标签（空格分隔）
                <input value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} />
              </label>
              <label className="field">阶段（空格分隔）
                <input
                  value={draft.stage_codes}
                  placeholder="INITIAL_CONTACT"
                  onChange={(event) => setDraft({ ...draft, stage_codes: event.target.value })}
                />
              </label>
              <label className="field">品牌
                <select value={draft.brand} onChange={(event) => setDraft({ ...draft, brand: event.target.value })}>
                  <option value="">不限品牌</option>
                  {KB_BRANDS.map((brand) => <option key={brand} value={brand}>{brandLabel(brand)}</option>)}
                </select>
              </label>
              <label className="field">语言
                <select value={draft.lang} onChange={(event) => setDraft({ ...draft, lang: event.target.value })}>
                  <option value="">不限语言</option>
                  {KB_LANGS.map((lang) => <option key={lang} value={lang}>{lang}</option>)}
                </select>
              </label>
              <label className="field">启用
                <select
                  value={draft.enabled ? "1" : "0"}
                  onChange={(event) => setDraft({ ...draft, enabled: event.target.value === "1" })}
                >
                  <option value="1">启用</option>
                  <option value="0">停用（停用时不会解析）</option>
                </select>
              </label>
            </div>
            <label className="field">备注<input value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></label>
            <p className="muted">保存只写配置，不触发注入；下一次运行才按新选择器解析，并在审计里留下解析记录。</p>
            <button className="btn work" data-admin-kb-binding-submit>{KB_ADMIN_ACTION.saveBinding}</button>
          </form>
        ) : null}

        {bindings.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table" data-admin-kb-bindings-table>
              <thead>
                <tr>
                  <th>技能</th>
                  <th>选择器</th>
                  <th>启用</th>
                  <th>备注</th>
                  <th>更新</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {bindings.map((row: Row) => {
                  const selector = (row.selector && typeof row.selector === "object" ? row.selector : {}) as Row;
                  const enabled = Boolean(Number(row.enabled ?? 1));
                  return (
                    <tr key={String(row.id)} data-admin-kb-binding={String(row.id)} data-kb-binding-enabled={enabled ? "1" : "0"}>
                      <td>
                        <strong>{skillLabel(String(row.skill_id || ""))}</strong>
                        <p className="muted">{String(row.skill_id || "")}</p>
                      </td>
                      <td data-admin-kb-binding-selector={String(row.id)}>{selectorSummary(selector)}</td>
                      <td>{enabled ? "启用" : "已停用"}</td>
                      <td>{textValue(row.note) || "—"}</td>
                      <td>{formatKbTime(textValue(row.updated_at)) || "—"}</td>
                      <td>
                        <div className="kbadmin-row-actions">
                          <button
                            className="kbadmin-action-link"
                            type="button"
                            data-admin-kb-binding-edit={String(row.id)}
                            onClick={() => setDraft(draftFromRow(row))}
                          >
                            {KB_ADMIN_ACTION.edit}
                          </button>
                          <button
                            className="kbadmin-action-link"
                            type="button"
                            data-admin-kb-binding-toggle-enabled={String(row.id)}
                            onClick={() => void run(
                              () => api.adminKnowledgeBindingSave({ id: String(row.id), enabled: !enabled }),
                              enabled ? "已停用：下次运行不再解析到这些知识。" : "已启用：下次运行会解析到这些知识。",
                            )}
                          >
                            {enabled ? "停用" : "启用"}
                          </button>
                          <button
                            className="kbadmin-action-link kbadmin-action-danger"
                            type="button"
                            data-admin-kb-binding-delete={String(row.id)}
                            onClick={() => ask(
                              knowledgeBindingDeleteConfirm(
                                skillLabel(String(row.skill_id || "")),
                                selectorSummary(selector),
                              ),
                              () => run(() => api.adminKnowledgeBindingDelete(String(row.id)), "绑定已删除。"),
                            )}
                          >
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          !loading && <p className="muted">{KB_ADMIN_EMPTY.bindings}</p>
        )}
      </article>

      <article className="panel" data-admin-kb-preview>
        <div className="admin-section-head">
          <div>
            <h2>解析试算</h2>
            <p className="muted">按当前配置试算一次：只读，不写审计、不注入。留空的条件表示不限定。</p>
          </div>
        </div>
        <div className="kbadmin-toolbar">
          <label className="field">技能
            <select value={trialSkill} data-admin-kb-preview-skill onChange={(event) => setTrialSkill(event.target.value)}>
              {skillOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
          <label className="field">账号 id（可空）
            <input value={trialUser} data-admin-kb-preview-user onChange={(event) => setTrialUser(event.target.value)} />
          </label>
          <label className="field">阶段（可空）
            <select value={trialStage} data-admin-kb-preview-stage onChange={(event) => setTrialStage(event.target.value)}>
              <option value="">不限阶段</option>
              {KB_STAGE_OPTIONS.map((stage) => <option key={stage.code} value={stage.code}>{stage.label}</option>)}
            </select>
          </label>
          <label className="field">品牌（可空）
            <select value={trialBrand} data-admin-kb-preview-brand onChange={(event) => setTrialBrand(event.target.value)}>
              <option value="">不限品牌</option>
              {KB_BRANDS.map((brand) => <option key={brand} value={brand}>{brandLabel(brand)}</option>)}
            </select>
          </label>
          <button className="btn ghost" type="button" data-admin-kb-preview-run disabled={trialBusy} onClick={() => void runPreview()}>
            {trialBusy ? "试算中…" : KB_ADMIN_ACTION.preview}
          </button>
        </div>

        {trial ? (
          <div className="kbadmin-two-col">
            <section className="kbadmin-col" data-admin-kb-preview-resolved>
              <h3>命中 {resolved.length}</h3>
              {resolved.map((item) => (
                <p key={String(item.id)} data-admin-kb-resolved={String(item.id)}>
                  <strong>{textValue(item.title) || String(item.id)}</strong>
                  <span className="muted"> {String(item.id)} · v{Number(item.version || 1)} · {kindLabel(String(item.kind || ""))} · {brandLabel(String(item.brand || ""))}</span>
                </p>
              ))}
              {!resolved.length && <p className="muted">{KB_ADMIN_EMPTY.previewResolved}</p>}
            </section>
            <section className="kbadmin-col" data-admin-kb-preview-skipped>
              <h3>跳过 {skipped.length}</h3>
              {skipped.map((item, index) => (
                <p key={`${String(item.knowledge_id || "")}-${String(item.reason || "")}-${index}`} data-admin-kb-skipped={String(item.knowledge_id || "")}>
                  <strong>{textValue(item.title) || String(item.knowledge_id || "")}</strong>
                  <span className="muted"> {String(item.knowledge_id || "")}</span>
                  <span className="kbadmin-skip-reason">{kbSkipReasonLabel(String(item.reason || ""))}</span>
                </p>
              ))}
              {!skipped.length && <p className="muted">{KB_ADMIN_EMPTY.previewSkipped}</p>}
            </section>
          </div>
        ) : (
          <p className="muted">还没有试算结果。选好技能与样例上下文后点「试算」。</p>
        )}
      </article>
    </>
  );
}
