import { describe, expect, it } from 'vitest';
import type { SkillTemplate, TaskDefinition } from '../api';
import { projectSkillTemplates } from './skillTemplateProjection';

const template = { skill_id: 'email_compose', version: 1 } as SkillTemplate;
const definition = { id: 'email_compose', skill_id: 'email_compose', granted: true, employee_visible: true, ui_template: template } as TaskDefinition;

describe('catalog to composer uses canonical task template', () => {
  it('projects the identical published schema without mutation or extra skills', () => {
    const row = { id: 'email_compose', granted: true, title: '写合作邮件' };
    const result = projectSkillTemplates([row], [definition, { ...definition, id: 'extra' }]);
    expect(result).toEqual([{ ...row, ui_template: template }]);
    expect(Reflect.get(result[0], 'ui_template')).toBe(template);
    expect(row).not.toHaveProperty('ui_template');
    expect(result).toHaveLength(1);
  });
  it('keeps the existing catalog template and version', () => {
    const own = { ...template, version: 2 };
    const row = { id: 'email_compose', ui_template: own };
    expect(projectSkillTemplates([row], [definition])[0]).toBe(row);
  });
  it('does not promote an ungranted or hidden catalog row', () => {
    for (const row of [{ id: 'email_compose', granted: false }, { id: 'email_compose', employee_visible: false }]) {
      expect(projectSkillTemplates([row], [definition])[0]).toBe(row);
    }
  });
  it('does not copy unauthorized, hidden or cross-skill definitions', () => {
    const row = { id: 'email_compose' };
    for (const source of [
      { ...definition, granted: false }, { ...definition, employee_visible: false },
      { ...definition, skill_id: 'other' }, { ...definition, ui_template: { ...template, skill_id: 'other' } },
    ]) expect(projectSkillTemplates([row], [source])[0]).toBe(row);
  });
  it('does not synthesize defaults when no real definition exists', () => {
    const row = { id: 'unknown' };
    expect(projectSkillTemplates([row], [definition])[0]).toBe(row);
  });
});
