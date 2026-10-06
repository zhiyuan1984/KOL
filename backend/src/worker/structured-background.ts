import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CodexAppServer } from './codex.js';
import type { Json } from '../types.js';
/** Shared Codex app-server, read-only sandbox, no resource tools or business side effects. */
export async function structuredBackground(prompt: string, outputSchema: Json, checkpoint: () => Promise<void>,runtime?:Json): Promise<unknown> {
  const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'lingong-knowledge-'));
  const rpc=new CodexAppServer(runtime?720:180);
  try {
    await checkpoint(); await rpc.handshake(); await rpc.requireAuth();
    const started=await rpc.request('thread/start',{cwd,approvalPolicy:'never',sandbox:'read-only',config:{mcp_servers:runtime?{skill_runtime:runtime}:{}}});
    const thread=(started.thread || started) as Json;
    await rpc.request('turn/start',{threadId:thread.id,input:[{type:'text',text:prompt}],cwd,approvalPolicy:'never',
      sandboxPolicy:{type:'readOnly',networkAccess:false},effort:'low',summary:'concise',outputSchema});
    const completed=await rpc.waitTurn(); await checkpoint();
    if ((completed.turn as Json)?.status !== 'completed') throw new Error('知识范围生成未完成，请检查模型服务后重试');
    const text=rpc.agentTexts.at(-1) || '';
    return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g,''));
  } finally {rpc.close();fs.rmSync(cwd,{recursive:true,force:true});}
}
