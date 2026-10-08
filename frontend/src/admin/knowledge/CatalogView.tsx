import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Tree } from "antd";
import { Link } from "react-router-dom";
import { api, type KnowledgeBaseRow, type KnowledgeDomainRow } from "../../api";
import { AdminFormDialog } from "../../components/AdminFormDialog";
import { KB_ADMIN_ACTION, KB_ADMIN_EMPTY, formatKbTime, kbBaseKindLabel, kbLevelLabel } from "../../knowledgeCopy";
import { basePath, type KbFeed } from "./shared";
import {
  buildPlanningTree, filterPlanningTree, flattenPlanningTree, planningBranchKeys,
  planningChildSummary, planningKey, planningMutationError, planningStateLabel,
  sortPlanningRows, type PlanningLevel, type PlanningNode,
} from "./planningTree";
import "./planning-tree.css";

type CatalogData = { domains: KnowledgeDomainRow[]; bases: KnowledgeBaseRow[] };
type Editor = {
  level: PlanningLevel; mode: "create" | "edit"; node?: PlanningNode;
  parentId: string; code: string; name: string; note: string; kind: string;
};
type PendingAction = { action: "archive" | "delete" | "restore"; node: PlanningNode };
const emptyData: CatalogData = { domains: [], bases: [] };
const levelLabel = (level: PlanningLevel) => level === "base" ? "知识库" : kbLevelLabel(level);

/** Planning changes classification containers only, never content publication or access. */
export default function CatalogView({ notify, fail }: KbFeed) {
  const [data, setData] = useState<CatalogData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [searchExpandedKeys, setSearchExpandedKeys] = useState<string[]>([]);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [needsReload, setNeedsReload] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [receipt, setReceipt] = useState("");
  const operationLock = useRef(false);
  const loadSequence = useRef(0);
  const knownBranches = useRef(new Set<string>());
  const revealCreatedKey = useRef("");
  const formId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const reload = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    try {
      const [domains, bases] = await Promise.all([api.adminKnowledgeDomains(), api.adminKnowledgeBases()]);
      const value = { domains: domains.domains || [], bases: bases.bases || [] };
      if (sequence === loadSequence.current) { setData(value); setLoadError(""); }
      return value;
    } catch (cause) {
      if (sequence === loadSequence.current) setLoadError(cause instanceof Error ? cause.message : "目录读取失败");
      throw cause;
    } finally { if (sequence === loadSequence.current) setLoading(false); }
  }, []);
  useEffect(() => { void reload().catch(() => {}); return () => { loadSequence.current += 1; }; }, [reload]);

  const { domains, bases } = data || emptyData;
  const tree = useMemo(() => buildPlanningTree(domains, bases), [domains, bases]);
  const allNodes = useMemo(() => flattenPlanningTree([...tree.roots, ...tree.detached]), [tree]);
  const selected = allNodes.find(node => node.key === selectedKey) || null;
  const filteredRoots = useMemo(() => filterPlanningTree(tree.roots, query), [tree.roots, query]);
  const filteredDetached = useMemo(() => filterPlanningTree(tree.detached, query), [tree.detached, query]);
  const visibleTree = useMemo(() => [...filteredRoots, ...filteredDetached], [filteredRoots, filteredDetached]);
  const branchKeys = useMemo(() => planningBranchKeys([...tree.roots, ...tree.detached]), [tree]);
  const families = useMemo(() => domains.filter(row => row.level === "family").sort(sortPlanningRows), [domains]);
  const domainOptions = useMemo(() => domains.filter(row => row.level === "domain").sort(sortPlanningRows), [domains]);

  useEffect(() => {
    const added = branchKeys.filter(key => !knownBranches.current.has(key));
    const valid = new Set(branchKeys);
    setExpandedKeys(current => [...new Set([...current.filter(key => valid.has(key)), ...added])]);
    knownBranches.current = valid;
  }, [branchKeys]);
  useEffect(() => { setSearchExpandedKeys(planningBranchKeys(visibleTree)); }, [visibleTree]);
  useEffect(() => {
    if (!revealCreatedKey.current) return;
    const created = allNodes.find(node => node.key === revealCreatedKey.current);
    if (!created) return;
    const domain = created.level === "base" ? domains.find(row => row.id === created.row.domain_id) : created.level === "domain" ? created.row : null;
    const ancestors = domain ? [planningKey("family", String(domain.parent_id || "")), ...(created.level === "base" ? [planningKey("domain", domain.id)] : [])] : [];
    setExpandedKeys(current => [...new Set([...current, ...ancestors])]);
    revealCreatedKey.current = "";
  }, [allNodes, domains]);

  const resetActionError = () => { setActionError(""); setNeedsReload(false); setUncertain(false); };
  const closeAction = () => {
    if (operationLock.current) return;
    setEditor(null); setPending(null);
    if (!needsReload) resetActionError();
  };
  const openCreate = (level: PlanningLevel, parentId = "") => {
    if (operationLock.current || needsReload) return;
    resetActionError(); setPending(null);
    setEditor({ level, mode: "create", parentId, code: "", name: "", note: "", kind: "structured" });
  };
  const openEdit = (node: PlanningNode) => {
    if (operationLock.current || needsReload) return;
    resetActionError(); setPending(null);
    setEditor({ level: node.level, mode: "edit", node,
      parentId: node.level === "base" ? node.row.domain_id : node.row.parent_id || "",
      code: node.row.code, name: node.row.name,
      note: node.level === "base" ? node.row.description || "" : node.row.note || "",
      kind: node.level === "base" ? node.row.kind : "structured",
    });
  };
  const requestAction = (action: PendingAction["action"], node: PlanningNode) => {
    if (operationLock.current || needsReload) return;
    resetActionError(); setEditor(null); setPending({ action, node });
  };
  const perform = async (work: () => Promise<void>, message: string) => {
    if (operationLock.current || needsReload) return;
    operationLock.current = true; setBusy(true); setActionError("");
    try {
      await work();
      setEditor(null); setPending(null); setReceipt(message); notify(message);
      // A failed refresh must never relabel a successfully acknowledged write as failed.
      await reload().catch(() => {});
    } catch (cause) {
      const issue = planningMutationError(cause);
      setActionError(issue.message); setNeedsReload(issue.needsReload); setUncertain(issue.uncertain);
      fail(cause);
    } finally { operationLock.current = false; setBusy(false); }
  };
  const reloadForReview = async () => {
    if (operationLock.current || loading) return;
    try {
      const fresh = await reload();
      if (editor?.mode === "edit" && editor.node) {
        const next = flattenPlanningTree(Object.values(buildPlanningTree(fresh.domains, fresh.bases)).flat()).find(node => node.key === editor.node?.key);
        if (!next) { setActionError("这个节点已被删除。你的输入仍保留，可复制后关闭表单。"); return; }
        setEditor(current => current ? { ...current, node: next } : null);
        setActionError("已读取最新记录，保留了你的输入。请核对最新名称和状态，再保存。");
      } else if (editor?.mode === "create" && uncertain) {
        setActionError("已重新读取目录。请关闭表单核对节点是否已创建；确认未创建后再重新新建。");
        setNeedsReload(false);
        return;
      } else {
        setPending(null);
        setActionError("已读取最新目录。请核对节点与依赖；如需继续，请重新选择操作并确认。");
      }
      setNeedsReload(false); setUncertain(false);
    } catch { /* Keep the draft and the reload guard; the read error is rendered below. */ }
  };

  const saveEditor = async () => {
    if (!editor || busy || needsReload || (uncertain && editor.mode === "create")) return;
    const snapshot = editor;
    if (snapshot.mode === "edit" && snapshot.node?.level !== "base" && !snapshot.node?.row.updated_at) { setActionError("缺少当前版本时间，请重新读取目录后再保存。"); setNeedsReload(true); return; }
    await perform(async () => {
      if (snapshot.mode === "create") {
        if (snapshot.level === "base") {
          const result = await api.adminKnowledgeBaseCreate({ code: snapshot.code.trim(), name: snapshot.name.trim(), domain_id: snapshot.parentId, kind: snapshot.kind, description: snapshot.note.trim() });
          revealCreatedKey.current = planningKey("base", result.base.id);
          setSelectedKey(revealCreatedKey.current);
        } else {
          const result = await api.adminKnowledgeDomainCreate({ code: snapshot.code.trim(), name: snapshot.name.trim(), level: snapshot.level, ...(snapshot.level === "domain" ? { parent_id: snapshot.parentId } : {}), note: snapshot.note.trim() || undefined });
          revealCreatedKey.current = planningKey(snapshot.level, result.domain.id);
          setSelectedKey(revealCreatedKey.current);
        }
        setQuery("");
      } else if (snapshot.node?.level === "base") {
        await api.adminKnowledgeBaseUpdate(snapshot.node.row.id, { name: snapshot.name.trim(), description: snapshot.note.trim(), expected_version: Number(snapshot.node.row.version || 1), expected_updated_at: snapshot.node.row.updated_at });
      } else if (snapshot.node) {
        await api.adminKnowledgeDomainUpdate(snapshot.node.row.id, { name: snapshot.name.trim(), note: snapshot.note.trim(), expected_updated_at: snapshot.node.row.updated_at! });
      }
    }, `${levelLabel(snapshot.level)}已${snapshot.mode === "create" ? "创建" : "保存"}。`);
  };
  const confirmAction = async () => {
    if (!pending || busy || needsReload) return;
    const { action, node } = pending;
    if (!node.row.updated_at) { setActionError("缺少当前版本时间，请重新读取目录后再操作。"); setNeedsReload(true); return; }
    await perform(async () => {
      if (action === "delete") {
        if (node.level === "base") await api.adminKnowledgeBaseDelete(node.row.id, node.row.updated_at!);
        else await api.adminKnowledgeDomainDelete(node.row.id, node.row.updated_at!);
        setSelectedKey("");
      } else {
        const change = { status: action === "archive" ? "archived" : "active", confirmed: true, expected_updated_at: node.row.updated_at! };
        if (node.level === "base") await api.adminKnowledgeBaseUpdate(node.row.id, { ...change, expected_version: Number(node.row.version || 1) });
        else await api.adminKnowledgeDomainUpdate(node.row.id, change);
      }
    }, `${levelLabel(node.level)}「${node.row.name}」已${action === "delete" ? "删除" : action === "archive" ? "归档" : "启用"}。`);
  };

  const modalOpen = Boolean(editor || pending);
  const controlsDisabled = busy || loading || needsReload || !data || Boolean(loadError);
  const nodeTitle = (node: PlanningNode) => (
    <span className="kbplanning-node" data-admin-kb-family={node.level === "family" ? node.row.id : undefined} data-admin-kb-domain={node.level === "domain" ? node.row.id : undefined} data-admin-kb-base={node.level === "base" ? node.row.id : undefined}>
      <span className="kbplanning-node-level">{levelLabel(node.level)}</span>
      <span className="kbplanning-node-name" title={node.path.join(" / ")}>{node.title}</span>
      <span className="kbplanning-node-count" title={planningChildSummary(allNodes.find(item => item.key === node.key) || node)}>{planningChildSummary(allNodes.find(item => item.key === node.key) || node)}</span>
      <span className="kbplanning-node-state" data-state={node.row.status}>{planningStateLabel(node.row.status)}</span>
    </span>
  );
  const renderTree = (nodes: PlanningNode[], label: string) => (
    <Tree<PlanningNode>
      className="kbplanning-tree" aria-label={label} blockNode virtual={false}
      treeData={nodes} titleRender={nodeTitle} showIcon={false} showLine={false}
      switcherIcon={({ expanded }) => <span className="kbplanning-arrow" aria-hidden="true">{expanded ? "▾" : "▸"}</span>}
      expandedKeys={query.trim() ? searchExpandedKeys : expandedKeys}
      onExpand={keys => (query.trim() ? setSearchExpandedKeys : setExpandedKeys)(keys.map(String))}
      selectedKeys={selectedKey ? [selectedKey] : []}
      onSelect={(_, info) => { if (!busy) { setSelectedKey(String(info.node.key)); setReceipt(""); } }}
      expandAction={false}
    />
  );
  const parentOptions = editor?.level === "domain" ? families : domainOptions;
  const parentActive = (id: string) => {
    const parent = domains.find(row => row.id === id);
    return parent?.status === "active" && (parent.level === "family" || domains.find(row => row.id === parent.parent_id)?.status === "active");
  };
  const actionLabel = pending?.action === "delete" ? "删除" : pending?.action === "archive" ? "归档" : "启用";
  const recovery = needsReload ? <button type="button" className="kbplanning-action" disabled={busy || loading} onClick={() => void reloadForReview()}>{loading ? "正在重新读取…" : "重新读取并核对"}</button> : null;

  return (
    <article className="panel kbplanning" data-admin-kb-catalog data-density="compact" aria-busy={loading || busy || undefined}>
      <header className="kbplanning-head">
        <div><h2>知识规划</h2><p className="muted">业务族 → 业务域 → 知识库</p></div>
        <button className={modalOpen ? "kbplanning-action" : "btn work"} type="button" data-admin-kb-create-family disabled={controlsDisabled} onClick={() => openCreate("family")}>{KB_ADMIN_ACTION.newFamily}</button>
      </header>
      <p className="kbplanning-note">分类只做业务归类；节点启用、归档与内容发布状态分别管理。</p>
      <div className="kbplanning-toolbar">
        <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索名称或编码" aria-label="搜索知识规划" data-admin-kb-catalog-search />
        <button className="kbplanning-action" type="button" onClick={() => (query.trim() ? setSearchExpandedKeys : setExpandedKeys)(planningBranchKeys(visibleTree))}>展开全部</button>
        <button className="kbplanning-action" type="button" onClick={() => (query.trim() ? setSearchExpandedKeys : setExpandedKeys)([])}>收起全部</button>
      </div>
      <div className="kbplanning-summary">{data ? <span>{families.length} 个业务族 · {domainOptions.length} 个业务域 · {bases.length} 个知识库</span> : null}<button type="button" className="kbplanning-action" disabled={busy || loading} onClick={() => void reload().catch(() => {})}>刷新</button></div>
      {loadError ? <div className="kbplanning-feedback" role="alert">{data ? "目录刷新失败，以下为上次读取结果。" : "知识规划读取失败。"}{loadError} <button type="button" className="kbplanning-action" disabled={loading || busy} onClick={() => void reload().catch(() => {})}>重试</button></div> : null}
      {loading ? <p className="kbplanning-note" role="status">{data ? "正在刷新知识规划…" : "正在加载知识规划…"}</p> : null}
      {receipt ? <p className="kbplanning-receipt" role="status">{receipt}</p> : null}
      {!modalOpen && actionError ? <div className="kbplanning-feedback" role="alert">{actionError}{recovery}</div> : null}
      <div data-admin-kb-catalog-tree>
        {filteredRoots.length ? renderTree(filteredRoots, "知识规划树") : null}
        {filteredDetached.length ? <div className="kbplanning-detached"><p className="kbplanning-feedback">以下节点缺少有效上级关系，请核对；未将它们自动归入其他分类。</p>{renderTree(filteredDetached, "待核对分类关系")}</div> : null}
        {!visibleTree.length && data && !loading ? <p className="kbplanning-empty">{query.trim() ? "没有匹配的节点。" : KB_ADMIN_EMPTY.catalog}{query.trim() ? <button className="kbplanning-action" type="button" onClick={() => setQuery("")}>清空搜索</button> : null}</p> : null}
      </div>
      {selected ? <section className="kbplanning-detail" aria-label={`${levelLabel(selected.level)}详情`} data-admin-kb-selected={selected.key}>
        <div className="kbplanning-detail-head"><h3>{selected.row.name}</h3><button type="button" className="kbplanning-action" onClick={() => setSelectedKey("")}>收起详情</button></div>
        <p className="kbplanning-path">{selected.path.join(" / ")}</p>
        <dl className="kbplanning-facts">
          <div><dt>编码</dt><dd>{selected.row.code}</dd></div>
          <div><dt>节点状态</dt><dd>{planningStateLabel(selected.row.status)}</dd></div>
          <div><dt>{selected.level === "base" ? "库类型" : "直接子级"}</dt><dd>{selected.level === "base" ? kbBaseKindLabel(selected.row.kind) : planningChildSummary(selected)}</dd></div>
          {selected.row.updated_at ? <div><dt>更新时间</dt><dd>{formatKbTime(selected.row.updated_at)}</dd></div> : null}
          {(selected.level === "base" ? selected.row.description : selected.row.note) ? <div><dt>说明</dt><dd>{selected.level === "base" ? selected.row.description : selected.row.note}</dd></div> : null}
        </dl>
        <div className="kbplanning-actions">
          {selected.level === "family" ? <button type="button" className="kbplanning-action" data-admin-kb-create-domain disabled={controlsDisabled || selected.row.status !== "active"} onClick={() => openCreate("domain", selected.row.id)}>{KB_ADMIN_ACTION.newDomain}</button> : null}
          {selected.level === "domain" ? <button type="button" className="kbplanning-action" data-admin-kb-create-base disabled={controlsDisabled || !parentActive(selected.row.id)} onClick={() => openCreate("base", selected.row.id)}>{KB_ADMIN_ACTION.newBase}</button> : null}
          {selected.level === "base" ? <Link className="kbplanning-link" to={basePath(selected.row.id)}>{KB_ADMIN_ACTION.viewDetail}知识库</Link> : null}
          <button type="button" className="kbplanning-action" data-admin-kb-edit-node disabled={controlsDisabled} onClick={() => openEdit(selected)}>{KB_ADMIN_ACTION.edit}</button>
          {selected.row.status === "active" ? <button type="button" className="kbplanning-action" data-admin-kb-archive-node disabled={controlsDisabled} onClick={() => requestAction("archive", selected)}>归档</button> : null}
          {selected.row.status === "archived" ? <button type="button" className="kbplanning-action" data-admin-kb-restore-node disabled={controlsDisabled} onClick={() => requestAction("restore", selected)}>重新启用</button> : null}
          <button type="button" className="kbplanning-action is-danger" data-admin-kb-delete-node disabled={controlsDisabled || selected.children.length > 0} title={selected.children.length ? "含子节点，不能直接删除" : "删除前将由服务端核对内容和引用"} onClick={() => requestAction("delete", selected)}>删除</button>
        </div>
        {selected.children.length ? <p className="kbplanning-note">含子节点，不能直接删除。归档只处理当前节点，依赖由服务端校验。</p> : null}
      </section> : data && visibleTree.length ? <p className="kbplanning-note">选择节点查看详情和操作；点击箭头展开或收起。</p> : null}

      <AdminFormDialog open={Boolean(editor)} title={editor ? `${editor.mode === "create" ? "新建" : "编辑"}${levelLabel(editor.level)}` : ""} subtitle="只保存分类节点；内容需在知识库中单独管理。" initialFocusRef={nameRef} busy={busy} error={actionError} onClose={closeAction} footer={<><button type="button" className="kbplanning-action" disabled={busy} onClick={closeAction}>取消</button><button type="submit" form={formId} className="btn work" disabled={busy || needsReload || loading || (uncertain && editor?.mode === "create")} data-admin-kb-family-submit={editor?.level === "family" ? "" : undefined} data-admin-kb-domain-submit={editor?.level === "domain" ? "" : undefined} data-admin-kb-base-submit={editor?.level === "base" ? "" : undefined}>{busy ? "正在保存…" : editor?.level === "base" ? KB_ADMIN_ACTION.saveBase : KB_ADMIN_ACTION.saveDomain}</button></>}>
        {editor ? <form id={formId} className="kbplanning-form" data-admin-kb-family-form={editor.level === "family" ? "" : undefined} data-admin-kb-domain-form={editor.level === "domain" ? "" : undefined} data-admin-kb-base-form={editor.level === "base" ? "" : undefined} onSubmit={event => { event.preventDefault(); void saveEditor(); }}>
          <fieldset disabled={busy}>
            {editor.level !== "family" ? <label className="field">所属{editor.level === "domain" ? "业务族" : "业务域"}<select name={editor.level === "domain" ? "parent_id" : "domain_id"} required aria-required="true" value={editor.parentId} disabled={editor.mode === "edit"} data-admin-kb-domain-parent={editor.level === "domain" ? "" : undefined} data-admin-kb-base-domain={editor.level === "base" ? "" : undefined} onChange={event => setEditor({ ...editor, parentId: event.target.value })}><option value="">请选择{editor.level === "domain" ? "业务族" : "业务域"}</option>{parentOptions.map(row => <option key={row.id} value={row.id} disabled={!parentActive(row.id)}>{[editor.level === "base" ? families.find(family => family.id === row.parent_id)?.name : "", row.name].filter(Boolean).join(" / ")}{row.status === "archived" ? "（已归档）" : ""}</option>)}</select></label> : null}
            <label className="field"><span>名称 <b aria-hidden="true">*</b></span><input ref={nameRef} name="name" required aria-required="true" value={editor.name} onChange={event => setEditor({ ...editor, name: event.target.value })} /></label>
            <label className="field"><span>编码 <b aria-hidden="true">*</b></span><input name="code" required aria-required="true" readOnly={editor.mode === "edit"} value={editor.code} onChange={event => setEditor({ ...editor, code: event.target.value })} /></label>
            {editor.level === "base" ? <label className="field">库类型<select name="kind" value={editor.kind} disabled={editor.mode === "edit"} data-admin-kb-base-kind onChange={event => setEditor({ ...editor, kind: event.target.value })}><option value="structured">结构化：按键取用的受控条目</option><option value="unstructured">非结构化：文档与媒体资料</option></select></label> : null}
            <label className="field">说明<textarea name={editor.level === "base" ? "description" : "note"} rows={3} value={editor.note} onChange={event => setEditor({ ...editor, note: event.target.value })} /></label>
          </fieldset>
          {editor.mode === "edit" && editor.node ? <p className="kbplanning-note">当前记录：{editor.node.row.name} · {planningStateLabel(editor.node.row.status)}{editor.node.row.updated_at ? ` · ${formatKbTime(editor.node.row.updated_at)}` : ""}</p> : null}
          {loadError ? <p className="error" role="alert">重新读取失败：{loadError}</p> : null}{recovery}
        </form> : null}
      </AdminFormDialog>
      <AdminFormDialog open={Boolean(pending)} title={pending ? `${actionLabel}${levelLabel(pending.node.level)}` : ""} subtitle="R3 · 执行前确认" initialFocusRef={cancelRef} busy={busy} error={actionError} onClose={closeAction} footer={<><button ref={cancelRef} type="button" className="kbplanning-action" data-admin-confirm-cancel disabled={busy} onClick={closeAction}>取消</button><button type="button" className={pending?.action === "delete" ? "btn danger" : "btn work"} data-admin-confirm-ok disabled={busy || needsReload || loading} onClick={() => void confirmAction()}>{busy ? "正在执行…" : `确认${actionLabel}`}</button></>}>
        {pending ? <div className="kbplanning-confirm" data-risk="R3" data-admin-confirm={`knowledge-planning-${pending.action}`}>
          <dl className="kbplanning-facts"><div><dt>对象</dt><dd>{pending.node.path.join(" / ")}（{pending.node.row.code}）</dd></div><div><dt>范围</dt><dd>仅当前{levelLabel(pending.node.level)}，不自动处理子节点或内容</dd></div><div><dt>变更</dt><dd>{planningStateLabel(pending.node.row.status)} → {pending.action === "delete" ? "删除节点" : pending.action === "archive" ? "已归档" : "启用"}</dd></div></dl>
          <p>{pending.action === "delete" ? "删除不可撤销。含子节点、内容或引用时服务端会阻止删除；依赖不会被自动清理。" : pending.action === "archive" ? "归档保留当前节点及历史；存在子节点、活动内容或引用时服务端会阻止。不会自动归档其他节点，也不改变内容发布状态。" : "重新启用当前节点，服务端会校验上级状态。不会自动启用子节点或发布内容。"}</p>
          {loadError ? <p className="error" role="alert">重新读取失败：{loadError}</p> : null}{recovery}
        </div> : null}
      </AdminFormDialog>
    </article>
  );
}
