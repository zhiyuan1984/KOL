import {describe,expect,it} from 'vitest';
import {isUsableInternalZh,parseTranslatedZh} from '../src/starrykol/translate-zh.js';
const source='John Smith Acme Energy requested updated information about product battery performance and the planned delivery timeline.';
describe('English echo must be an actual contiguous span, not joined across Chinese translation',()=>{
 it('does not join legitimate separate proper names through Chinese prose',()=>{
  const output='请 John Smith 联系 Acme Energy，核实产品电池性能、更新后的资料与计划中的交付时间。';
  expect(isUsableInternalZh(output,source)).toBe(true);expect(parseTranslatedZh(JSON.stringify({zh:output}),source)).not.toBeNull();
 });
 it('still rejects contiguous substantive original English even with Chinese prefix',()=>{
  expect(isUsableInternalZh('这是供业务人员使用的内部邮件对照：requested updated information about product battery performance',source)).toBe(false);
 });
 it('still rejects whole source echoes and original long-body less-than-eight-CJK placeholders',()=>{
  expect(isUsableInternalZh('这里是内部中文对照稿：'+source,source)).toBe(false);
  expect(isUsableInternalZh('谢谢',source)).toBe(false);
 });
});
