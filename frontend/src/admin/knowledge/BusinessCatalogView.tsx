import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Collapse } from "antd";
import { RightOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";
import type { KnowledgeBusinessTaxonomy } from "../../../../shared/knowledge-taxonomy.js";
import { api, type KnowledgeBaseRow, type KnowledgeDomainRow } from "../../api";
import { AdminFormDialog } from "../../components/AdminFormDialog";
import WorkspaceSearchInput from "../../components/WorkspaceSearchInput";
import { businessThemePath } from "../../knowledgeBusinessTaxonomy";
import { kbBaseKindLabel } from "../../knowledgeCopy";
import { basePath, type KbFeed } from "./shared";
import LegacyCatalogView from "./CatalogView";
import "./planning-tree.css";

type Data = { taxonomy: KnowledgeBusinessTaxonomy; bases: KnowledgeBaseRow[]; domains: KnowledgeDomainRow[] };
type Editor = { base: KnowledgeBaseRow | null; name: string; description: string; kind: string; themeId: string; domainId: string };

/** Classification is shared with ontology; actual content containers keep IDs, types, permissions and publication histories. */
export default function BusinessCatalogView({ notify, fail, onChanged }: KbFeed & { onChanged?: () => void }) {
  const [data, setData] = useState<Data | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [query, setQuery] = useState(""), [themeId, setThemeId] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null), [saving, setSaving] = useState(false), [saveError, setSaveError] = useState("");
  const [unmappedOpen, setUnmappedOpen] = useState(false);
  const formId = useId(), nameRef = useRef<HTMLInputElement>(null), sequence = useRef(0), writeLock = useRef(false);
  const reload = useCallback(async () => {
    const current = ++sequence.current; setLoading(true);
    try {
      const [taxonomy, bases, domains] = await Promise.all([api.knowledgeBusinessTaxonomy(true), api.adminKnowledgeBases(), api.adminKnowledgeDomains()]);
      if (current === sequence.current) { setData({ taxonomy, bases: bases.bases, domains: domains.domains }); setError(""); }
    } catch (cause) { if (current === sequence.current) setError(cause instanceof Error ? cause.message : "业务目录读取失败"); }
    finally { if (current === sequence.current) setLoading(false); }
  }, []);
  useEffect(() => { void reload(); return () => { sequence.current += 1; }; }, [reload]);
  const taxonomy = data?.taxonomy, nodes = taxonomy?.nodes || [];
  const bindings = useMemo(() => new Map(data?.taxonomy.bindings.map(binding => [binding.baseId, binding.themeId]) || []), [data?.taxonomy]);
  const selected = nodes.find(node => node.id === themeId && node.level === 3);
  const containers = (data?.bases || []).filter(base => bindings.get(base.id) === themeId);
  const unmapped = (data?.bases || []).filter(base => !nodes.some(node => node.id === bindings.get(base.id)));
  const needle = query.trim().toLocaleLowerCase();
  const matches = (id: string) => !needle || !!taxonomy && businessThemePath(taxonomy, id).toLocaleLowerCase().includes(needle)
    || (data?.bases || []).some(base => bindings.get(base.id) === id && base.name.toLocaleLowerCase().includes(needle));
  const themes = nodes.filter(node => node.level === 3 && matches(node.id));
  const activeDomain = (id: string) => data?.domains.some(domain => domain.id === id && domain.level === "domain" && domain.status === "active"
    && data.domains.some(family => family.id === domain.parent_id && family.status === "active"));
  const edit = (base: KnowledgeBaseRow | null, initialTheme = themeId) => {
    setSaveError("");
    setEditor({ base, name: base?.name || "", description: base?.description || "", kind: base?.kind || "structured",
      themeId: base ? bindings.get(base.id) || "" : initialTheme,
      domainId: base?.domain_id || data?.domains.find(domain => domain.id === "kdom_legacy" && activeDomain(domain.id))?.id || data?.domains.find(domain => domain.level === "domain" && activeDomain(domain.id))?.id || "" });
  };
  const save = async () => {
    if (!editor || writeLock.current) return;
    if (!editor.name.trim()) { setSaveError("请填写知识库名称。"); nameRef.current?.focus(); return; }
    if (!editor.base && (!editor.themeId || !editor.domainId)) { setSaveError("请选择业务主题及有效的存储容器分类。"); return; }
    if (editor.base && !editor.base.updated_at) { setSaveError("缺少当前记录版本，请关闭表单后刷新再试。"); return; }
    writeLock.current = true; setSaving(true); setSaveError("");
    try {
      const body = { name: editor.name.trim(), description: editor.description.trim(), ontology_theme_id: editor.themeId };
      if (editor.base) await api.adminKnowledgeBaseUpdate(editor.base.id, { ...body, expected_version: Number(editor.base.version || 1), expected_updated_at: editor.base.updated_at });
      else await api.adminKnowledgeBaseCreate({ ...body, domain_id: editor.domainId, kind: editor.kind });
      setEditor(null); notify("知识库已保存；业务归类不改变资料、权限或发布状态。");
      await reload(); onChanged?.();
    } catch (cause) { setSaveError(cause instanceof Error ? cause.message : "保存失败，请刷新核对后再试。"); fail(cause); }
    finally { writeLock.current = false; setSaving(false); }
  };
  const baseRows = (bases: KnowledgeBaseRow[]) => bases.map(base => <div key={base.id} className="kbplanning-node" data-business-base={base.id}>
    <Link className="kbplanning-link kbplanning-node-name" to={basePath(base.id)}>{base.name}</Link>
    <span className="kbplanning-node-state">{kbBaseKindLabel(base.kind)} · {base.status === "archived" ? "已归档" : "启用"}</span>
    <button className="kbplanning-action" type="button" disabled={loading || saving} onClick={() => edit(base)}>编辑归类</button>
  </div>);
  const branch = (node: KnowledgeBusinessTaxonomy["nodes"][number], children: React.ReactNode) => <Collapse key={node.id} className="kbplanning-accordion" ghost size="small" destroyOnHidden
    defaultActiveKey={needle ? [node.id] : []} expandIcon={({ isActive }) => <RightOutlined rotate={isActive ? 90 : 0} aria-hidden="true" />}
    items={[{ key: node.id, label: <span className="kbplanning-node-name" data-business-node={node.id}>{node.name}</span>, children }]} />;
  return <article className="panel kbplanning" data-admin-kb-catalog data-business-catalog data-density="compact" aria-busy={loading}>
    <div className="kbplanning-toolbar">
      <WorkspaceSearchInput className="kbplanning-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索业务目录或知识库" aria-label="搜索知识规划" />
      <button type="button" className="kbplanning-action" disabled={loading || saving} onClick={() => void reload()}>刷新</button>
    </div>
    {data && <p className="kbplanning-note" data-business-catalog-summary>{nodes.filter(node => node.level === 1).length} 个业务族 · {nodes.filter(node => node.level === 2).length} 个业务域 · {nodes.filter(node => node.level === 3).length} 个业务主题</p>}
    <p className="kbplanning-note">目录与本体同源。业务主题是分类，知识库是内容容器；空主题保留，历史资料不自动搬移。</p>
    {error && <p className="kbplanning-feedback" role="alert">{error} <button className="kbplanning-action" onClick={() => void reload()}>重试</button></p>}
    {loading && <p className="kbplanning-note" role="status">正在读取业务目录与容器映射…</p>}
    <div data-admin-kb-catalog-tree key={needle ? `search:${needle}` : "browse"}>
      {nodes.filter(node => node.level === 1).filter(family => !needle || themes.some(theme => nodes.find(domain => domain.id === theme.parentId)?.parentId === family.id)).map(family => branch(family,
        nodes.filter(domain => domain.level === 2 && domain.parentId === family.id).filter(domain => themes.some(theme => theme.parentId === domain.id)).map(domain => branch(domain,
          themes.filter(theme => theme.parentId === domain.id).map(theme => <button key={theme.id} type="button" className="kbplanning-node" aria-pressed={themeId === theme.id} data-business-node={theme.id} onClick={() => setThemeId(theme.id)}>
            <span className="kbplanning-node-level">业务主题</span><span className="kbplanning-node-name">{theme.name}</span>
            <span className="kbplanning-node-count">{data?.bases.filter(base => bindings.get(base.id) === theme.id).length || 0} 个知识库</span>
          </button>))))) }
      {!loading && needle && !themes.length && <p className="kbplanning-empty">没有匹配的业务主题。<button className="kbplanning-action" onClick={() => setQuery("")}>清空搜索</button></p>}
    </div>
    {selected && taxonomy && <section className="kbplanning-detail" aria-label="业务主题内容容器" data-business-selected-theme={themeId}>
      <div className="kbplanning-detail-head"><h3>{selected.name}</h3><button className="kbplanning-action" onClick={() => setThemeId("")}>收起详情</button></div>
      <p className="kbplanning-path">{businessThemePath(taxonomy, selected.id)}</p>
      {containers.length ? baseRows(containers) : <p className="kbplanning-empty">本主题尚未关联知识库。</p>}
      <button className="kbplanning-action" disabled={loading || saving} onClick={() => edit(null, selected.id)}>新建知识库</button>
    </section>}
    {data && <section className="kbplanning-detached">
      <button className="kbplanning-action" aria-expanded={unmappedOpen} onClick={() => setUnmappedOpen(value => !value)}>未归类知识库（{unmapped.length}）</button>
      {unmappedOpen && <><p className="kbplanning-note">保留原资料和库 ID。请核对业务用途后通过“编辑归类”指定主题。</p>{baseRows(unmapped)}</>}
    </section>}
    <Collapse ghost size="small" items={[{ key: "legacy", label: "历史容器分类（兼容维护）", children: <LegacyCatalogView notify={notify} fail={fail} /> }]} />
    <AdminFormDialog open={!!editor} title={editor?.base ? "编辑知识库归类" : "新建知识库"} subtitle="只更改分类映射，不搬移资料、不扩大授权范围。" initialFocusRef={nameRef} busy={saving} error={saveError} onClose={() => { if (!saving) setEditor(null); }}
      footer={<><button className="kbplanning-action" disabled={saving} onClick={() => setEditor(null)}>取消</button><button className="btn work kbplanning-submit" type="submit" form={formId} disabled={saving || loading}>{saving ? "正在保存…" : "保存"}</button></>}>
      {editor && <form id={formId} className="kbplanning-form" onSubmit={event => { event.preventDefault(); void save(); }}><fieldset disabled={saving}>
        <label className="field">名称<input ref={nameRef} required value={editor.name} onChange={event => setEditor({ ...editor, name: event.target.value })} /></label>
        <label className="field">业务主题<select value={editor.themeId} required={!editor.base} onChange={event => setEditor({ ...editor, themeId: event.target.value })}>
          <option value="">{editor.base ? "未归类（取消映射）" : "请选择业务主题"}</option>
          {taxonomy && nodes.filter(node => node.level === 2).map(domain => <optgroup key={domain.id} label={`${nodes.find(family => family.id === domain.parentId)?.name || ""} / ${domain.name}`}>
            {nodes.filter(theme => theme.level === 3 && theme.parentId === domain.id).map(theme => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
          </optgroup>)}
        </select></label>
        {!editor.base && <><label className="field">库类型<select value={editor.kind} onChange={event => setEditor({ ...editor, kind: event.target.value })}><option value="structured">结构化知识条目</option><option value="unstructured">非结构化资料</option></select></label>
          <label className="field">存储容器分类<select value={editor.domainId} required onChange={event => setEditor({ ...editor, domainId: event.target.value })}>
            <option value="">请选择有效容器分类</option>{data?.domains.filter(domain => domain.level === "domain" && activeDomain(domain.id)).map(domain => <option key={domain.id} value={domain.id}>{data.domains.find(family => family.id === domain.parent_id)?.name} / {domain.name}</option>)}
          </select></label></>}
        <label className="field">说明<textarea rows={2} value={editor.description} onChange={event => setEditor({ ...editor, description: event.target.value })} /></label>
      </fieldset></form>}
    </AdminFormDialog>
  </article>;
}
