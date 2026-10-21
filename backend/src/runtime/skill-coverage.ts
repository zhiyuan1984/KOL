import {publishedOperationCatalog} from '../capability/catalog.js';
import {capabilityRiskFloor,type CapabilityReference} from '../capability/contracts.js';
import { taskDefinition, taskDefinitions } from "../tasks/registry.js";
import type { Row } from "../types.js";
import { postgresQuery } from "../postgres/pool.js";
import { ensureRuntimeSchema, listSkillConnectorBindings, listSkillToolBindings } from "./store.js";
import { DOCUMENT_TOOL, documentDependencies } from "./document-knowledge.js";
import { runtimeRequiresGate } from "../gateway/runtime-policy.js";

export type DeclaredTool = { connector_id: string; tool_name: string; declared_as: string };
export function parseDeclaredMcp(entries: readonly string[]): DeclaredTool[] { const seen=new Set<string>();const parsed:DeclaredTool[]=[];for(const entry of entries){if(typeof entry!=="string")continue;const declared=entry.trim();if(!declared)continue;const separator=declared.indexOf(".");const connector_id=separator>0?declared.slice(0,separator).trim():"";const tool_name=(separator>0?declared.slice(separator+1):declared).trim();if(!tool_name||seen.has(declared))continue;seen.add(declared);parsed.push({connector_id,tool_name,declared_as:declared});}return parsed; }
export type ToolMountState = "mounted"|"available"|"blocked_by_policy"|"unregistered"|"unknown_connector";
async function rows(sql:string,...params:unknown[]):Promise<Row[]>{return postgresQuery<Row>(sql,params);}

export async function unregisteredDeclaredTools(mcp:readonly string[]):Promise<DeclaredTool[]>{await ensureRuntimeSchema();const connectors=new Set((await rows("SELECT id FROM connectors")).map((row)=>String(row.id)));const policies=new Set((await rows("SELECT connector_id,tool_name FROM runtime_tool_policies")).map((row)=>keyOf(String(row.connector_id),String(row.tool_name))));return parseDeclaredMcp(mcp).filter((tool)=>tool.declared_as!==DOCUMENT_TOOL&&(!tool.connector_id||!connectors.has(tool.connector_id)||!policies.has(keyOf(tool.connector_id,tool.tool_name))));}
export async function unmountedDeclaredTools(skillId:string,mcp:readonly string[]):Promise<DeclaredTool[]>{await ensureRuntimeSchema();const connectors=new Set((await listSkillConnectorBindings()).filter((row)=>String(row.skill_id)===skillId&&Number(row.enabled)===1).map((row)=>String(row.connector_id)));const tools=new Set((await listSkillToolBindings()).filter((row)=>String(row.skill_id)===skillId&&Number(row.enabled)===1).map((row)=>keyOf(String(row.connector_id),String(row.tool_name))));return parseDeclaredMcp(mcp).filter((tool)=>tool.declared_as!==DOCUMENT_TOOL&&!(connectors.has(tool.connector_id)&&tools.has(keyOf(tool.connector_id,tool.tool_name))));}
export async function registeredToolCatalog():Promise<string[]>{await ensureRuntimeSchema();const listed=(await rows("SELECT connector_id,tool_name FROM runtime_tool_policies ORDER BY connector_id,tool_name")).map((row)=>`${row.connector_id}.${row.tool_name}`);return [...new Set([DOCUMENT_TOOL,...listed])];}

const RISK_ORDER={L1:1,L2:2,L3:3} as const;
export function declaredToolRisk(toolName: string, policyRisk?: string): "L1" | "L2" | "L3" {
  if (runtimeRequiresGate(toolName)) return "L3";
  if (policyRisk === "L1" || policyRisk === "L2" || policyRisk === "L3") return policyRisk;
  return /send|decrypt|delete|upload|import|changeLifecycleStage/i.test(toolName) ? "L3" : "L1";
}

export async function skillToolProfile(
  skillId: string,
  mcp: readonly string[],
  capabilities?: readonly CapabilityReference[],
): Promise<{ connectors: string[]; connectors_mounted: boolean; risk: "L1" | "L2" | "L3" | null }> {
  await ensureRuntimeSchema();
  const declared = parseDeclaredMcp(mcp).filter((tool) => tool.declared_as !== DOCUMENT_TOOL);
  const mounted = [...new Set((await listSkillConnectorBindings())
    .filter((row) => String(row.skill_id) === skillId && Number(row.enabled) === 1)
    .map((row) => String(row.connector_id)))];
  const mountedTools = (await listSkillToolBindings())
    .filter((row) => String(row.skill_id) === skillId && Number(row.enabled) === 1);
  const declaredConnectors = [...new Set(declared.map((tool) => tool.connector_id).filter(Boolean))];
  const policies = new Map((await rows("SELECT connector_id,tool_name,risk FROM runtime_tool_policies"))
    .map((row) => [keyOf(String(row.connector_id), String(row.tool_name)), String(row.risk)]));
  let risk: "L1" | "L2" | "L3" | null = mcp.includes(DOCUMENT_TOOL) ? "L1" : null;
  const includeRisk = (connectorId: string, toolName: string) => {
    const level = declaredToolRisk(toolName, policies.get(keyOf(connectorId, toolName)));
    if (!risk || RISK_ORDER[level] > RISK_ORDER[risk]) risk = level;
  };
  for (const tool of declared) includeRisk(tool.connector_id, tool.tool_name);
  // A mount can outlive a SKILL.md edit; include it so the profile cannot understate risk.
  for (const tool of mountedTools) includeRisk(String(tool.connector_id), String(tool.tool_name));
  const floor = capabilityRiskFloor(
    capabilities ?? (await taskDefinition(skillId))?.capabilities ?? [],
    await publishedOperationCatalog(),
  );
  if (floor && (!risk || RISK_ORDER[floor] > RISK_ORDER[risk])) risk = floor;
  return { connectors: mounted.length ? mounted : declaredConnectors, connectors_mounted: mounted.length > 0, risk };
}

export type CoverageTool={connector_id:string;connector_label?:string;tool_name:string;declared_as:string;state:ToolMountState;policy_risk?:"L1"|"L2"|"L3";policy_enabled?:boolean;connector_enabled?:boolean;connector_status?:string};
function isPolicyEnabled(value:number|boolean|undefined):boolean{return value===true||Number(value)===1;}
export function toolMountState(input:{declared:DeclaredTool;policy?:{enabled:number|boolean;risk?:string}|null;policyConnectorExists:boolean;bound:boolean}):ToolMountState{if(input.bound)return"mounted";if(!input.policyConnectorExists)return"unknown_connector";if(!input.policy)return"unregistered";if(!isPolicyEnabled(input.policy.enabled))return"blocked_by_policy";return"available";}
export type Implementation="live"|"defined";
export function skillImplementation(input:{agentBound:boolean;stage:string|null|undefined}):Implementation{return input.agentBound&&input.stage==="published"?"live":"defined";}
export type CoverageConnector={id:string;label:string;enabled:boolean;status:string;approved_tool_count:number};
export type CoverageSkill={skill_id:string;label:string;stage:string|null;published_version:number|null;agents:string[];agent_bound:boolean;implementation:Implementation;declared_tools:number;mounted_tools:number;pending_tools:number;tools:CoverageTool[]};
export type SkillCoverage={summary:{skills:number;live:number;defined:number;declared_tools:number;mounted_tools:number;pending_tools:number};connectors:CoverageConnector[];skills:CoverageSkill[]};
function keyOf(...parts:string[]):string{return parts.join("\u0000");}

/** PostgreSQL read-model aggregation only; it never grants or mounts a tool. */
export async function skillCoverage(options:{connectorId?:string;root?:string}={}):Promise<SkillCoverage>{await ensureRuntimeSchema();const connectorId=options.connectorId?.trim()||undefined;const directory=new Map<string,{id:string;label:string;enabled:boolean;status:string}>();for(const row of await rows("SELECT id,label,enabled,status FROM connectors")){const id=String(row.id);directory.set(id,{id,label:String(row.label??id),enabled:Number(row.enabled)===1,status:String(row.status??"")});}const stages=new Map<string,string>();for(const row of await rows("SELECT skill_id,stage FROM skill_lifecycle"))stages.set(String(row.skill_id),String(row.stage));const publishedVersions=new Map<string,number>();for(const row of await rows("SELECT skill_id,MAX(version) AS version FROM skill_versions WHERE status='published' GROUP BY skill_id")){if(row.version!==null&&row.version!==undefined)publishedVersions.set(String(row.skill_id),Number(row.version));}const boundAgents=new Map<string,string[]>();for(const row of await rows("SELECT agent_id,skill_id FROM runtime_agent_skills WHERE enabled=1 ORDER BY agent_id")){const skillId=String(row.skill_id);boundAgents.set(skillId,[...(boundAgents.get(skillId)||[]),String(row.agent_id)]);}const policies=new Map<string,{enabled:number;risk:"L1"|"L2"|"L3"}>();const approvedCounts=new Map<string,number>();for(const row of await rows("SELECT connector_id,tool_name,enabled,risk FROM runtime_tool_policies")){const connector=String(row.connector_id);policies.set(keyOf(connector,String(row.tool_name)),{enabled:Number(row.enabled),risk:String(row.risk) as "L1"|"L2"|"L3"});if(Number(row.enabled)===1)approvedCounts.set(connector,(approvedCounts.get(connector)||0)+1);}const connectorBindings=new Set((await listSkillConnectorBindings()).filter((row)=>Number(row.enabled)===1).map((row)=>keyOf(String(row.skill_id),String(row.connector_id))));const toolBindings=new Set((await listSkillToolBindings()).filter((row)=>Number(row.enabled)===1).map((row)=>keyOf(String(row.skill_id),String(row.connector_id),String(row.tool_name))));const skills:CoverageSkill[]=[];const referenced=new Set<string>();for(const definition of (await taskDefinitions(options.root))){const tools:CoverageTool[]=[];for(const declared of parseDeclaredMcp(definition.mcp)){if(connectorId&&declared.connector_id!==connectorId)continue;if(declared.declared_as===DOCUMENT_TOOL){tools.push({...declared,connector_label:"知识文档",policy_risk:"L1",policy_enabled:true,state:(await documentDependencies(definition.id)).length?"mounted":"available"});continue;}const connector=directory.get(declared.connector_id);const policy=policies.get(keyOf(declared.connector_id,declared.tool_name));const bound=connectorBindings.has(keyOf(definition.id,declared.connector_id))&&toolBindings.has(keyOf(definition.id,declared.connector_id,declared.tool_name));const state=toolMountState({declared,policy:policy??null,policyConnectorExists:Boolean(connector),bound});if(connector)referenced.add(declared.connector_id);tools.push({connector_id:declared.connector_id,...(connector?{connector_label:connector.label}:{}),tool_name:declared.tool_name,declared_as:declared.declared_as,state,...(policy?{policy_risk:policy.risk,policy_enabled:policy.enabled===1}:{}),...(connector?{connector_enabled:connector.enabled,connector_status:connector.status}:{})});}if(connectorId&&!tools.length)continue;const agents=boundAgents.get(definition.id)||[];const stage=stages.get(definition.id)??null;const mounted=tools.filter((tool)=>tool.state==="mounted").length;skills.push({skill_id:definition.id,label:definition.employee_summary||definition.title||definition.id,stage,published_version:publishedVersions.get(definition.id)??null,agents,agent_bound:agents.length>0,implementation:skillImplementation({agentBound:agents.length>0,stage}),declared_tools:tools.length,mounted_tools:mounted,pending_tools:tools.length-mounted,tools});}const connectors:CoverageConnector[]=[...referenced].map((id)=>directory.get(id)).filter((connector):connector is {id:string;label:string;enabled:boolean;status:string}=>Boolean(connector)).map((connector)=>({...connector,approved_tool_count:approvedCounts.get(connector.id)||0})).sort((a,b)=>a.id.localeCompare(b.id));const sum=(pick:(skill:CoverageSkill)=>number)=>skills.reduce((total,skill)=>total+pick(skill),0);return{summary:{skills:skills.length,live:skills.filter((skill)=>skill.implementation==="live").length,defined:skills.filter((skill)=>skill.implementation==="defined").length,declared_tools:sum((skill)=>skill.declared_tools),mounted_tools:sum((skill)=>skill.mounted_tools),pending_tools:sum((skill)=>skill.pending_tools)},connectors,skills};}
