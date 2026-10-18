import {z} from 'zod';
import type {SkillAuthoring} from '../../../shared/skill-authoring.js';
const text=z.string().max(8000),objectCode=z.string().regex(/^[a-z][a-z0-9_]{0,99}$/);
const schema=z.object({version:z.literal(1),company:z.string().min(1).max(200).nullable(),mode:z.enum(['business','general']),general_scope:text,purpose:text,use_when:text,expected_result:text,recovery:text,objects:z.array(z.object({object:objectCode,revision:z.number().int().positive().nullable(),actions:z.array(z.string().regex(/^[a-z][a-z0-9_.-]{1,99}$/)).max(64)}).strict()).max(32)}).strict();
export function assertNoPlaintextSkillSecrets(source:string):void{
 if(/(api[_-]?key|access[_-]?token|client[_-]?secret|private[_-]?key)\s*[:=]\s*["']?(?!\$\{|env:|secret:)[A-Za-z0-9_\-/.+=]{12,}/i.test(source))throw new Error('技能疑似包含明文密钥，请使用保险柜引用');
}
export function parseSkillAuthoring(raw:unknown):SkillAuthoring{
 const parsed=schema.safeParse(raw);if(!parsed.success)throw new Error('业务创建信息格式无效');
 const value=parsed.data;if(new Set(value.objects.map(o=>o.object)).size!==value.objects.length||value.objects.some(o=>new Set(o.actions).size!==o.actions.length))throw new Error('业务对象或动作重复');
 return value;
}
