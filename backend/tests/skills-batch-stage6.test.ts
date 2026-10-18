import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolveOperations,operationArguments,operationAlias,loadOperationContracts,validateOperationCatalog} from '../src/capability/contracts.js';
import {taskDefinitions} from '../src/tasks/registry.js';
const requireTaskDefinition=async(id:string)=>(await taskDefinitions('skills')).find(d=>d.id===id)!;
const names=['creator_filter_options','email_conversation_list','email_conversation_read'];
describe('stage6 first three skills use existing runtime contracts',()=>{
 it('resolves only the five existing reviewed supplier tools without changing old required-ID mail query',async()=>{
  validateOperationCatalog(loadOperationContracts());const defs=await Promise.all(names.map(requireTaskDefinition));expect(defs.map(d=>d.mcp)).toEqual([['starrykol.listDictionaryOptions','starrykol.listCooperationStageOptions','starrykol.listRiskTagOptions'],['starrykol.pageEmailConversations'],['starrykol.getEmailConversation']]);
  expect(defs.flatMap(d=>resolveOperations(d.capabilities||[])).every(o=>o.risk==='R1'&&o.effect==='read'&&!o.asynchronous)).toBe(true);
  expect(resolveOperations([{id:'mail.conversations.query',version:1}])[0].inputSchema?.required).toEqual(['creator_record_id']);
 });
 it('maps only declared stable keys to the actual supplier schemas',()=>{
  const [read,search,dict]=resolveOperations([{id:'mail.conversation.read',version:1},{id:'mail.conversations.search',version:1},{id:'creator.dictionary.options',version:1}]);
  expect(operationArguments(read,{conversation_id:501})).toEqual({conversationId:501});expect(operationAlias(read)).toBe('cap_mail_conversation_read_v1');
  expect(operationArguments(search,{keyword:'subject',status:'open',creator_record_id:17,operator_read_status:'unread',recipient_read_status:'read',page_no:2,page_size:10})).toEqual({keyword:'subject',status:'open',kolId:17,operatorReadStatus:'unread',recipientReadStatus:'read',pageNo:2,pageSize:10});
  expect(operationArguments(dict,{parent_key:'kol_niche'})).toEqual({parentKey:'kol_niche'});expect(()=>operationArguments(read,{mailbox:'outside@example.test'})).toThrow('not_mapped');
 });
 it('preserves mandatory live conversation and keeps list selection optional',async()=>{
  expect((await requireTaskDefinition('email_conversation_read')).context).toEqual({requires:['conversation'],prefers:[]});expect((await requireTaskDefinition('email_conversation_list')).context).toEqual({requires:[],prefers:['conversation']});
  for(const id of ['mail_summary','mail_translate','email_compose','reply_analysis']){const d=await requireTaskDefinition(id);expect(d.capabilities).toBeUndefined();expect(readFileSync(d.path,'utf8')).not.toContain('cap_mail_conversation_read_v1');}
 });
});
