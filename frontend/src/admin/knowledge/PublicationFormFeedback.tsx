import { Alert, Form, Input } from 'antd';
import type { ReviewIssue } from '../../../../shared/review';
import { HorizontalForm } from '../../components/InformationLayout';
import { TaskTheme } from '../../tasks/TaskTheme';

/** Display server validation; this component never decides approval eligibility. */
export function PublicationValidationNotice({reason, issues, onLocate, onRecheck, disabled}: {
  reason: string; issues: ReviewIssue[]; onLocate: (path: string) => void;
  onRecheck: () => void; disabled: boolean;
}) {
  return <TaskTheme><Alert type="error" showIcon role="alert"
    title={issues.length ? '请补全以下审批信息' : reason}
    description={issues.length ? <ul>{issues.map((issue, index) => <li key={`${issue.path}:${index}`}>
      <button type="button" className="kbv-text-action" onClick={() => onLocate(issue.path)}>{issue.message}</button>
    </li>)}</ul> : undefined}
    action={<button type="button" className="kbv-text-action" disabled={disabled} onClick={onRecheck}>重新检查</button>}
  /></TaskTheme>;
}

export function PublicationNoteField({id, value, required, issues, disabled, onChange}: {
  id: string; value: string; required: boolean; issues: ReviewIssue[];
  disabled: boolean; onChange: (value: string) => void;
}) {
  const errors = issues.filter(issue => issue.path === 'publication_note' || issue.path.startsWith('publication_note.'));
  const helpId = `${id}-help`;
  return <TaskTheme><HorizontalForm component={false}>
    <Form.Item className="ui-field-stacked" label="发布说明" htmlFor={id} required={required}
      validateStatus={errors.length ? 'error' : undefined}
      help={<span id={helpId}>{errors.length ? errors.map(issue => issue.message).join('；') : '请说明本次发布内容、适用对象及范围；填写后自动重新检查。'}</span>}>
      <Input.TextArea id={id} name="publication_note" rows={3} maxLength={2000}
        value={value} required={required} disabled={disabled}
        aria-invalid={errors.length ? true : undefined} aria-describedby={helpId}
        onChange={event => onChange(event.target.value)} placeholder="说明本次发布内容与适用范围" />
    </Form.Item>
  </HorizontalForm></TaskTheme>;
}
