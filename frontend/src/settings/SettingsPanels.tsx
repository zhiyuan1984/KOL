import { useEffect, useState } from 'react';
import { Button, Checkbox, Form, Input, Select } from 'antd';
import { api } from '../api';
import { HorizontalForm, PropertyList } from '../components/InformationLayout';
import { settingsClient, settingsError } from '../settingsClient';
import { FeedbackLine, LoadState, useLoad, type DirtyProps, type Feedback } from './SettingsState';
export { MemorySettings } from './MemorySettings';
export { PrivacySettings } from './PrivacySettings';
const defaults = { theme: 'system', locale: 'zh-CN', model_tier: 'balanced', default_brand: '', default_mailbox: '', notifications: true };

export function ProfileSettings({ onDirty, onSaved }: DirtyProps & { onSaved: () => Promise<void> }) {
  const result = useLoad(settingsClient.context, '无法读取个人资料，请重试。');
  const [form] = Form.useForm(); const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState<Feedback>(null);
  useEffect(() => { if (result.data) form.setFieldsValue(result.data.profile); }, [result.data, form]);
  const context = result.data; const profile = context?.profile;
  const allowed = (field: string) => Boolean(context?.editable_fields.includes(field));
  return <LoadState {...result} retry={result.reload}><HorizontalForm form={form} className="settings-editor" onValuesChange={() => { onDirty(true); setFeedback(null); }} disabled={busy} onFinish={async values => {
    setBusy(true); setFeedback(null);
    try { await api.updateMe(Object.fromEntries(Object.entries(values).filter(([field]) => allowed(field)))); await onSaved(); onDirty(false); setFeedback({ kind: 'success', text: '资料已保存。' }); }
    catch (e) { setFeedback({ kind: 'error', text: settingsError(e, '资料未保存，请重试。') }); }
    finally { setBusy(false); }
  }}>
    {profile && <>
      <PropertyList className="settings-profile-facts" items={[
        ...(!allowed('name') ? [{ key: 'name', label: '姓名', value: profile.name }] : []),
        ...(!allowed('email') ? [{ key: 'email', label: '登录邮箱', value: profile.email }] : []),
        ...(!allowed('phone') ? [{ key: 'phone', label: '手机号', value: profile.phone }] : []),
      ]} />
      {allowed('name') && <Form.Item label="姓名" name="name" rules={[{ required: true, message: '请填写姓名。' }]}><Input autoComplete="name" /></Form.Item>}
      {allowed('email') && <Form.Item label="登录邮箱" name="email" className="ui-field-wide" rules={[{ type: 'email', message: '请填写有效邮箱。' }]}><Input autoComplete="email" /></Form.Item>}
      {allowed('phone') && <Form.Item label="手机号" name="phone"><Input autoComplete="tel" inputMode="tel" /></Form.Item>}
      {profile.managed && <p className="settings-help">企业身份和登录联系方式由管理员维护。</p>}
      <details className="settings-details"><summary>组织资料</summary><PropertyList items={[
        { key: 'company', label: '公司', value: profile.company_name || '未登记' },
        { key: 'no', label: '工号', value: profile.employee_no || '未登记' },
        { key: 'position', label: '岗位', value: profile.position || '未登记' },
        { key: 'organization', label: '组织', value: profile.organization_path.join(' / ') || '未登记' },
        { key: 'manager', label: '直属上级', value: profile.manager_name || '未登记' },
      ]} /></details>
      <FeedbackLine value={feedback} />
      {context && context.editable_fields.length > 0 && <div className="settings-actions ui-form-actions"><Button htmlType="submit" type="primary" className="settings-primary" loading={busy}>保存资料</Button><Button type="text" onClick={() => { form.setFieldsValue(profile); onDirty(false); setFeedback(null); }}>取消修改</Button></div>}
    </>}
  </HorizontalForm></LoadState>;
}

function applyPreferences(values: Record<string, unknown>) {
  try { localStorage.setItem('composer:model-tier', String(values.model_tier || 'balanced')); } catch { /* optional persistence */ }
  if (values.theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = String(values.theme || 'light');
  document.documentElement.lang = String(values.locale || 'zh-CN');
}
export function PreferenceSettings({ onDirty }: DirtyProps) {
  const result = useLoad(settingsClient.context, '无法读取工作偏好，请重试。');
  const [form] = Form.useForm(); const brand = Form.useWatch('default_brand', form) as string | undefined;
  const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState<Feedback>(null);
  const [baseline, setBaseline] = useState<Record<string, unknown>>({ ...defaults });
  useEffect(() => { if (result.data) { const values = { ...defaults, ...result.data.preferences }; setBaseline(values); form.setFieldsValue(values); } }, [result.data, form]);
  const options = result.data?.mailboxes.filter(row => row.status === 'connected' && Boolean(brand) && row.brand === brand) || [];
  return <LoadState {...result} retry={result.reload}><HorizontalForm form={form} className="settings-editor" disabled={busy} onFinish={async values => {
    setBusy(true); setFeedback(null);
    try { const saved = await api.savePreferences(values); const nextValues = { ...defaults, ...saved }; setBaseline(nextValues); form.setFieldsValue(nextValues); applyPreferences(saved); onDirty(false); setFeedback({ kind: 'success', text: '工作偏好已保存。' }); }
    catch (e) { setFeedback({ kind: 'error', text: settingsError(e, '工作偏好未保存，请重试。') }); }
    finally { setBusy(false); }
  }} onValuesChange={changed => {
    onDirty(true); setFeedback(null);
    if ('default_brand' in changed) {
      const current = form.getFieldValue('default_mailbox') as string;
      if (current && !result.data?.mailboxes.some(row => row.email === current && row.status === 'connected' && Boolean(changed.default_brand) && row.brand === changed.default_brand)) {
        form.setFieldValue('default_mailbox', ''); setFeedback({ kind: 'error', text: '原邮箱与当前品牌不匹配，请重新选择。' });
      }
    }
  }}>
    <section className="settings-field-group ui-field-group" aria-label="界面偏好">
      <Form.Item name="theme" label="主题"><Select options={[{ value: 'system', label: '跟随系统' }, { value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }]} /></Form.Item>
      <Form.Item name="locale" label="界面语言"><Select options={[{ value: 'zh-CN', label: '简体中文' }, { value: 'en', label: 'English' }]} /></Form.Item>
      <Form.Item name="notifications" label="通知" valuePropName="checked"><Checkbox>接收任务与审批通知</Checkbox></Form.Item>
    </section>
    <section className="settings-field-group ui-field-group" aria-label="业务默认值">
      <Form.Item name="model_tier" label="执行质量"><Select options={[{ value: 'fast', label: '快速' }, { value: 'balanced', label: '均衡' }, { value: 'quality', label: '高质量' }]} /></Form.Item>
      <Form.Item name="default_brand" label="默认品牌" extra="用于新任务，不增加品牌权限。"><Select showSearch optionFilterProp="label" options={[{ value: '', label: '每次选择' }, ...(result.data?.brands.map(row => ({ value: row.id, label: row.label })) || [])]} /></Form.Item>
      <Form.Item name="default_mailbox" className="ui-field-wide" label="默认跟进邮箱" extra="仅可选择已连接且与品牌匹配的邮箱。"><Select showSearch optionFilterProp="label" options={[{ value: '', label: '每次选择' }, ...options.map(row => ({ value: row.email, label: `${row.email}${row.brand ? ` · ${row.brand}` : ''}` }))]} /></Form.Item>
      {!options.length && <p className="settings-help ui-form-note">暂无符合条件的邮箱，可在“账号与邮箱”中查看或恢复连接。</p>}
    </section>
    <FeedbackLine value={feedback} /><div className="settings-actions ui-form-actions"><Button htmlType="submit" type="primary" className="settings-primary" loading={busy}>保存偏好</Button><Button type="text" onClick={() => { form.setFieldsValue(baseline); onDirty(false); setFeedback(null); }}>取消修改</Button></div>
  </HorizontalForm></LoadState>;
}

export function PasswordSettings({ onDirty }: DirtyProps) {
  const [form] = Form.useForm(); const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState<Feedback>(null);
  return <HorizontalForm form={form} className="settings-editor" disabled={busy} onValuesChange={() => { onDirty(true); setFeedback(null); }} onFinish={async values => {
    setBusy(true); setFeedback(null);
    try { await api.changePassword({ current_password: String(values.current_password), new_password: String(values.new_password) }); form.resetFields(); onDirty(false); setFeedback({ kind: 'success', text: '密码已更新，请重新登录。' }); location.reload(); }
    catch (e) { setFeedback({ kind: 'error', text: settingsError(e, '密码未更新，请检查当前密码后重试。') }); }
    finally { setBusy(false); }
  }}>
    <Form.Item label="当前密码" name="current_password" rules={[{ required: true, message: '请填写当前密码。' }]}><Input.Password autoComplete="current-password" /></Form.Item>
    <Form.Item label="新密码" name="new_password" rules={[{ required: true, message: '请填写新密码。' }, { min: 10, message: '新密码至少需要10个字符。' }]}><Input.Password autoComplete="new-password" /></Form.Item>
    <Form.Item label="确认新密码" name="confirm_password" dependencies={['new_password']} rules={[{ required: true, message: '请再次填写新密码。' }, ({ getFieldValue }) => ({ validator(_, value) { return !value || value === getFieldValue('new_password') ? Promise.resolve() : Promise.reject(new Error('两次新密码不一致。')); } })]}><Input.Password autoComplete="new-password" /></Form.Item>
    <FeedbackLine value={feedback} /><div className="ui-form-actions"><Button htmlType="submit" type="primary" className="settings-primary" loading={busy}>更新密码</Button></div>
  </HorizontalForm>;
}
