import { KnowledgeFilterBar, BrowseListRow } from "../../components/KnowledgeBrowse";
import { FilterRow, FilterOptionButton, FilterAction } from "../../components/KnowledgeFilterControls";
import WorkspaceSearchInput from "../../components/WorkspaceSearchInput";
import CompactButton from "../../components/CompactButton";
import { PropertyList } from "../../components/InformationLayout";
import { TaskTheme } from "../../tasks/TaskTheme";
import type { AgentWorkspace } from "./api";
import {useState,type RefObject} from "react";
import {Select} from 'antd';
import type {AgentBrowseFilters} from '../../../../shared/agent-organization';

export type AgentFilters = AgentBrowseFilters;
export const agentStatusName = (value: string) => ({ draft: "未发布", published: "已发布", disabled: "已停用" }[value] || value);

export function AgentBrowse({ data, loading, error, filters, selectedId, page, onFilter, onPage, onSelect, onCreate, onReset, onReload, listRef, onScroll }: {
  data: AgentWorkspace | null; loading: boolean; error: string; filters: AgentFilters; selectedId: string; page: number;
  onFilter: (key: keyof AgentFilters, value: string) => void; onPage: (page: number) => void;
  onSelect: (id: string) => void; onCreate: () => void; onReset: () => void; onReload: () => void;
  listRef: RefObject<HTMLElement | null>; onScroll: () => void;
}) {
  const all = data?.agents || [], ready = Boolean(data && !loading && !error);
  const rows = data?.browse.rows || [],[showEmpty,setShowEmpty]=useState(true);
  const pages = Math.max(1, Math.ceil(rows.length / 20)), currentPage = Math.min(page, pages);
  const facets = [
    { key: "level1" as const, label: "一级部门" },{ key: "level2" as const, label: "二级部门" },{ key: "level3" as const, label: "三级部门" },
    { key: "ownership" as const, label: "组织归属" },{ key: "status" as const, label: "发布状态" },
    { key: "binding" as const, label: "人员绑定" },{ key: "draft" as const, label: "修订草稿" },
  ];
  return <section ref={listRef} onScroll={onScroll} className="kbv-list agent-browse-list" aria-label="Agent 列表" data-agent-middle aria-busy={loading}>
    <TaskTheme><KnowledgeFilterBar>
      <WorkspaceSearchInput className="kbv-search" aria-label="搜索名称与职责" placeholder="搜 Agent 名称、职责关键词"
        value={filters.query} onChange={event => onFilter("query", event.target.value)} />
      <div className="kbv-filter-tools"><span>计数随其他筛选条件变化 · 组织授权范围</span>
        <div><FilterAction onClick={()=>setShowEmpty(value=>!value)}>{showEmpty?'收起空部门':'显示空部门'}</FilterAction><FilterAction onClick={onReset}>重置筛选</FilterAction><FilterAction disabled={loading} onClick={onReload}>刷新</FilterAction><FilterAction className="agent-mobile-create" onClick={onCreate}>新建 Agent</FilterAction></div>
      </div>
      <div className="kbv-scope-rows">{facets.map(facet => {
        const departments=facet.key.startsWith('level'),options=data?.browse.facets[facet.key]||[],visible=options.filter(value=>!departments||showEmpty||!ready||!value.value||value.count>0||filters[facet.key]===value.value);
        return <FilterRow key={facet.key} label={facet.label} aria-label={`${facet.label}筛选`}>
          {departments&&options.length>8?<Select className="agent-department-filter" size="small" aria-label={`${facet.label}选择`} showSearch optionFilterProp="label" value={filters[facet.key]} onChange={value=>onFilter(facet.key,value)} options={visible.map(value=>({value:value.value,label:`${value.label}${ready?' '+value.count:''}`,title:value.path||value.label}))}/>:visible.map(value=><FilterOptionButton key={value.value} label={value.label} title={value.path} selected={filters[facet.key]===value.value} countsReady={ready} count={value.count} onClick={()=>onFilter(facet.key,value.value)}/>)}
          {!data&&<span className="agent-help">正在读取…</span>}
        </FilterRow>;
      })}</div>
    </KnowledgeFilterBar></TaskTheme>
    <section className="agent-asset-strip" aria-label="Agent 资产概览" data-agent-asset-strip>
      <header><span>组织资产概览</span><small>全局发布状态 · 不随筛选变化{data && loading ? " · 上次结果，正在刷新" : error && data ? " · 上次结果，读取失败" : ""}</small></header>
      {data ? <div className="agent-asset-segments">{["draft", "published", "disabled"].map(state => {
        const count = all.filter(row => row.status === state).length;
        return <button key={state} type="button" data-agent-status={state} aria-pressed={filters.status === state}
          onClick={() => onFilter("status", filters.status === state ? "all" : state)}>
          <span className="agent-asset-label"><i aria-hidden="true" data-state={state} />{agentStatusName(state)}</span>
          <strong data-ds-stat-value>{count}</strong><small>{all.length ? `占比 ${Math.round(count / all.length * 100)}%` : "—"}</small>
        </button>;
      })}</div> : !error ? <p role="status">正在读取资产分布…</p> : null}
    </section>
    {error && <p className="agent-browse-feedback" role="alert">{error} <CompactButton onClick={onReload}>重新读取</CompactButton></p>}
    <header className="agent-list-toolbar"><span data-agent-count>{data ? `${rows.length} 个 Agent${loading ? "（更新中…）" : error ? "（上次结果）" : ""}` : "Agent 列表"}</span>
      <nav className="agent-pagination" aria-label="Agent 分页"><CompactButton disabled={currentPage <= 1} onClick={() => onPage(currentPage - 1)}>上一页</CompactButton>
        <span>第 {currentPage} / {pages} 页</span><CompactButton disabled={currentPage >= pages} onClick={() => onPage(currentPage + 1)}>下一页</CompactButton></nav>
    </header>
    <div className="agent-list-columns" aria-hidden="true"><span>Agent 名称</span><span>发布状态</span></div>
    {data && rows.slice((currentPage - 1) * 20, currentPage * 20).map(row => <BrowseListRow key={row.id} title={row.name}
      selected={row.id === selectedId} kind={`${agentStatusName(row.status)}${row.published_revision ? ` · v${row.published_revision}` : ""}${row.draft ? " · 有草稿" : ""}`}
      onOpen={() => onSelect(row.id)} openAttributes={{ "data-agent-record": row.id }} />)}
    {!data && loading && <p className="agent-empty" role="status">正在读取 Agent 与组织覆盖依据…</p>}
    {data && !rows.length && !error && <p className="agent-empty">没有符合条件的 Agent。<CompactButton onClick={onReset}>清除筛选条件</CompactButton></p>}
  </section>;
}

export function AgentOverview({ data, onCreate, onUnbound, onDrafts, onUnassigned }: {
  data: AgentWorkspace; onCreate: () => void; onUnbound: () => void; onDrafts: () => void;onUnassigned:()=>void;
}) {
  const rows = data.agents, drafts = rows.filter(row => row.draft).length, unbound = rows.filter(row => !row.bindings.length).length;
  const users = new Set(rows.flatMap(row => row.coverage.user_ids));
  return <>
    <section><h3>Agent 资产</h3><p className="agent-help">先从中栏选择 Agent，查看职责、已装配技能与人员使用资格。</p>
      <PropertyList labelWidth="short" items={[
        { key: "total", label: "全部 Agent", value: rows.length },
        { key: "skills", label: "技能目录", value: `${data.skills.length} 项` },
        { key: "people", label: "绑定覆盖", value: `${users.size} 个员工账号（去重）` },
      ]} />
    </section>
    <section><h3>待管理事项</h3>
      <div className="agent-overview-row"><span>未设置组织归属</span><CompactButton onClick={onUnassigned}>查看 {rows.filter(row=>!row.organization.assignment).length} 个</CompactButton></div>
      <div className="agent-overview-row"><span>修订草稿</span><CompactButton onClick={onDrafts}>查看 {drafts} 个</CompactButton></div>
      <div className="agent-overview-row"><span>尚未绑定人员或组织</span><CompactButton onClick={onUnbound}>查看 {unbound} 个</CompactButton></div>
      <p className="agent-help">人员覆盖表示绑定资格；考试和执行条件在所选 Agent 的详情中核对。</p>
    </section>
    <section><h3>新建 Agent</h3><p className="agent-help">填写职责、选择技能，先保存草稿，再检查并确认发布。</p>
      <CompactButton emphasis="primary" onClick={onCreate}>新建 Agent</CompactButton>
    </section>
  </>;
}
