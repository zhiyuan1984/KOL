import type { SkillTemplate, TaskDefinition } from '../api';

type Carrier = { id: string; granted?: boolean; employee_visible?: boolean; ui_template?: SkillTemplate | null };

/** Same published schema as Home's task picker; no local parameter defaults,
 * extra skills, cross-skill template aliases or permission promotion.
 */
export function projectSkillTemplates<T extends Carrier>(rows: readonly T[], definitions: readonly TaskDefinition[]): T[] {
  return rows.map(row => {
    if (row.ui_template || row.granted === false || row.employee_visible === false) return row;
    const definition = definitions.find(item => item.id === row.id
      && (!item.skill_id || item.skill_id === row.id)
      && item.granted !== false && item.employee_visible !== false
      && item.ui_template?.skill_id === row.id);
    return definition?.ui_template ? { ...row, ui_template: definition.ui_template } : row;
  });
}
