import type { RuntimeContext } from './execution.js';
import type { KnowledgeManifest } from '../../../shared/knowledge-scope.js';
// Internal run-scoped capability. JSON request fields cannot manufacture this grant.
const grants=new WeakMap<RuntimeContext,()=>Promise<KnowledgeManifest>>();
export function grantKnowledgePreview(context:RuntimeContext,resolve:()=>Promise<KnowledgeManifest>):void {grants.set(context,resolve);}
export const isKnowledgePreview=(context:RuntimeContext)=>grants.has(context);
export async function previewManifest(context:RuntimeContext):Promise<KnowledgeManifest>{const resolve=grants.get(context);if(!resolve)throw new Error('knowledge_preview_not_authorized');return resolve();}
