import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { EmployeeAgentBrowse, EmployeeAgentBrowseRow, EmployeeAgentWorkspace } from "../api";
import CompactButton from "../components/CompactButton";
import { PropertyList } from "../components/InformationLayout";
import { BrowseDetailMetadata } from "../components/KnowledgeBrowse";
import { formatKbTime } from "../knowledgeCopy";
import { MAIN_STAGE_TABS } from "../kolStages";
import { expertCanHelpCopy, expertPromptExamples, expertMissionCopy, expertRoleCopy, type Expert } from "../experts";
import { readAgentDraft, saveAgentDraft } from "./browserState";

export default function AgentProfile({ expert, actor, workspace, workspaceLoading, workspaceError, onRetryWorkspace, draftRef,
  browseRow, taxonomy, browseLoading, browseError }: {
  expert: Expert; actor: string; workspace: EmployeeAgentWorkspace | null;
  workspaceLoading: boolean; workspaceError: string; onRetryWorkspace: () => void;
  draftRef: { current: string }; browseRow?: EmployeeAgentBrowseRow; taxonomy: EmployeeAgentBrowse["taxonomy"];
  browseLoading: boolean; browseError: string;
}) {
  const [draft, setDraft] = useState(() => readAgentDraft(actor, expert.id));
  const [storageError, setStorageError] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const mission = expertMissionCopy(expert), role = expertRoleCopy(expert);
  const prompts = expertPromptExamples(expert), canHelp = expertCanHelpCopy(expert);
  const scopes = browseRow?.scopes || [];
  const stages = [...new Set(scopes.flatMap(scope => scope.stage_codes))];
  const brands = [...new Set(scopes.flatMap(scope => scope.brand ? [scope.brand === "*" ? "通用" : scope.brand] : []))];
  const baseNames = [...new Set(scopes.flatMap(scope => scope.base_id ? [taxonomy.bases.find(base => base.id === scope.base_id)?.name || scope.base_id] : []))];
  useEffect(() => { draftRef.current = draft; }, [draft, draftRef]);
  const updateDraft = (text: string) => {
    setDraft(text); draftRef.current = text;
    setStorageError(saveAgentDraft(actor, expert.id, text) ? "" : "浏览器暂时无法保存草稿，请在离开前复制内容。");
  };
  const scope = browseLoading ? <span className="muted">正在读取…</span> : browseError ? <span className="muted">范围暂不可用</span>
    : <span className="kb-scope" data-agent-scope title="按关联的已发布知识范围展示">
      {stages.length ? <span className="chip kb-scope-chip">阶段：{stages.map(code => MAIN_STAGE_TABS.find(stage => stage.code === code)?.label || code).join(" / ")}</span> : null}
      {brands.map(brand => <span className="chip kb-scope-chip" key={brand}>{brand}</span>)}
      {!stages.length && !brands.length ? baseNames.length ? baseNames.map(name => <span className="chip kb-scope-chip" key={name}>{name}</span>)
        : <span className="muted">未关联已发布知识</span> : null}
    </span>;
  return <div className="agent-profile" data-expert-detail={expert.id} data-expert-qa={expert.id}>
    <BrowseDetailMetadata status={expert.status === "published" ? "已发布" : expert.status || "未登记"}
      author={browseRow?.published_by} version={expert.expert_version ? (expert.expert_version.startsWith("v") ? expert.expert_version : `v${expert.expert_version}`) : "未登记"}
      updatedAt={browseRow?.updated_at ? formatKbTime(browseRow.updated_at) : null} scope={scope} />
    <PropertyList className="kb-preview-subject" labelWidth="short" items={[
      { key: "role", label: "岗位", value: role },
      { key: "entry", label: "工作入口", value: expert.primary_entry === "job_console" ? "采集作业" : expert.primary_entry === "approval_queue" ? "审批队列" : "工作会话" },
      ...(expert.open_count != null ? [{ key: "count", label: "待处理", value: String(expert.open_count) }] : []),
    ]} />
    {mission ? <p className="kb-preview-body" data-agent-mission>{mission}</p> : null}
    {canHelp.length ? <section className="agent-profile-section"><h3>可以帮你</h3><ul>{canHelp.map(item => <li key={item}>{item}</li>)}</ul></section> : null}
    <section className="agent-profile-section" aria-label="已发布能力">
      {workspaceLoading ? <p className="muted" role="status">正在读取能力与知识范围…</p> : null}
      {workspaceError ? <p className="error" role="alert">{workspaceError} <CompactButton onClick={onRetryWorkspace}>重试</CompactButton></p> : null}
      {workspace ? <>
        <details data-agent-skills><summary>已发布能力 · {workspace.skills.length} 项</summary>
          <ul>{workspace.skills.map(skill => <li key={skill.id}><strong>{skill.name}</strong>{skill.summary ? <span> · {skill.summary}</span> : null}</li>)}</ul>
        </details>
        {workspace.knowledge.length ? <details data-agent-knowledge><summary>关联知识 · {workspace.knowledge.length} 项查询能力</summary>
          {workspace.knowledge.map(item => <div className="agent-knowledge-range" key={item.skill_id}>
            <strong>{item.skill_name}</strong>
            {item.bases.length ? <ul>{item.bases.map(base => <li key={base.id}>
              {base.name} · {base.document_count} 份已发布资料
              {base.summaries.length ? <p className="muted">{base.summaries.join("；")}</p> : <p className="muted">资料范围尚未核对，使用时以原文与引用为准。</p>}
            </li>)}</ul> : <p className="muted">当前没有可访问的已发布资料。</p>}
          </div>)}
        </details> : null}
      </> : null}
    </section>
    <details className="agent-profile-section" data-agent-background><summary>岗位说明</summary>
      {expert.working_style && expert.working_style !== mission ? <p>{expert.working_style}</p> : null}
      {expert.good_at.length ? <PropertyList labelWidth="short" items={[{ key: "specialty", label: "擅长", value: expert.good_at.join("、") }]} /> : null}
      {expert.how_to_start && !prompts.includes(expert.how_to_start) ? <PropertyList labelWidth="short" items={[{ key: "start", label: "如何开始", value: expert.how_to_start }]} /> : null}
      {expert.intro && expert.intro !== mission && expert.intro !== expert.working_style ? <p>{expert.intro}</p> : null}
    </details>
    {expert.primary_entry === "think" && expert.kind === "business" ? <section className="agent-profile-section" data-expert-prompts>
      <h3>工作示例</h3>
      <div className="agent-examples">{prompts.map(prompt => <CompactButton key={prompt} data-expert-prompt={expert.id}
        onClick={() => { updateDraft(prompt); input.current?.focus(); }}>{prompt}</CompactButton>)}</div>
      <label className="agent-draft-label" htmlFor="agent-work-draft">工作草稿</label>
      <textarea id="agent-work-draft" data-agent-draft ref={input} rows={3} value={draft}
        placeholder="写下希望 Agent 完成的工作，可先选择示例再修改" onChange={event => updateDraft(event.target.value)} />
      {storageError ? <p className="error" role="alert">{storageError}</p> : null}
    </section> : null}
    <div className="agent-work-links agent-profile-section" data-expert-home-links>
      <Link to="/" data-expert-link="today">今日任务</Link>
      <Link to="/?tab=todo" data-expert-link="todo">我的待办</Link>
    </div>
  </div>;
}
