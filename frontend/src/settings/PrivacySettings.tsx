import { useEffect, useState } from 'react';
import { Button, Checkbox, Descriptions, Form, Input, Modal, Pagination } from 'antd';
import { api } from '../api';
import { sessionDeleteConfirm } from '../adminConfirm';
import { dataSummaryLabel, formatDataSummaryValue } from '../labels';
import type { SettingsReceipt } from '../settingsReceipt';
import { settingsClient, settingsError } from '../settingsClient';
import { FeedbackLine, LoadState, useLoad, type DirtyProps, type Feedback } from './SettingsState';
export function PrivacySettings({ onDirty, onReceipt }: DirtyProps & { onReceipt: (value: Omit<SettingsReceipt, 'at'>) => void }) {
  const summary = useLoad(api.dataSummary, '无法读取数据摘要，请重试。');
  const sessions = useLoad(settingsClient.sessions, '无法读取对话，请重试。');
  const preferences = useLoad(api.preferences, '无法读取隐私偏好，请重试。');
  const [form] = Form.useForm(); const [query, setQuery] = useState(''); const [page, setPage] = useState(1); const [busy, setBusy] = useState(''); const [feedback, setFeedback] = useState<Feedback>(null); const [modal, holder] = Modal.useModal();
  useEffect(() => { if (preferences.data) form.setFieldsValue({ analytics_cookies: Boolean(preferences.data.analytics_cookies) }); }, [preferences.data, form]);
  const rows = (sessions.data || []).filter(row => !query || row.title.toLowerCase().includes(query.toLowerCase()));
  return <section className="settings-editor settings-list-panel">
    <section className="settings-field-group"><h2>隐私偏好</h2><p className="settings-help">登录与安全所需 Cookie 不可关闭。</p>
      <LoadState {...preferences} retry={preferences.reload}><Form form={form} layout="vertical" onValuesChange={() => onDirty(true)} onFinish={async values => {
        setBusy('privacy'); setFeedback(null);
        try { await api.savePreferences({ analytics_cookies: Boolean(values.analytics_cookies) }); onDirty(false); setFeedback({ kind: 'success', text: '隐私偏好已保存。' }); }
        catch (e) { setFeedback({ kind: 'error', text: settingsError(e, '隐私偏好未保存，请重试。') }); }
        finally { setBusy(''); }
      }}><Form.Item name="analytics_cookies" valuePropName="checked"><Checkbox disabled={Boolean(busy)}>允许匿名产品分析 Cookie</Checkbox></Form.Item><Button htmlType="submit" type="primary" className="settings-primary" loading={busy === 'privacy'}>保存隐私偏好</Button></Form></LoadState>
    </section><FeedbackLine value={feedback} />
    <details className="settings-details"><summary>账户数据摘要</summary><LoadState {...summary} retry={summary.reload}><Descriptions column={1} size="small" items={['sessions', 'archived_sessions', 'memories'].filter(key => summary.data?.[key] !== undefined).map(key => ({ key, label: dataSummaryLabel(key), children: formatDataSummaryValue(key, summary.data?.[key]) }))} /></LoadState></details>
    <section className="settings-field-group"><h2>我的对话</h2><div className="settings-list-tools"><Input.Search aria-label="搜索对话" placeholder="搜索对话" allowClear value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} /></div>
      <LoadState {...sessions} retry={sessions.reload}>
        {!rows.length && <p className="settings-help">{query ? '没有匹配的对话。' : '暂无对话。'}</p>}
        {rows.slice((page - 1) * 10, page * 10).map(row => <div className="settings-list-row" key={row.id}><div><span>{row.title || '未命名对话'}</span><p className="settings-help">{row.archived_at ? '已归档' : '进行中'}</p></div><div className="settings-row-actions">
          <a href={`/api/sessions/${encodeURIComponent(row.id)}/export?format=md`} download>导出对话</a>
          <Button type="text" disabled={Boolean(busy)} onClick={async () => {
            setBusy(row.id); setFeedback(null);
            try { await (row.archived_at ? api.unarchiveSession(row.id) : api.archiveSession(row.id)); sessions.reload(); setFeedback({ kind: 'success', text: row.archived_at ? '对话已恢复。' : '对话已归档。' }); }
            catch (e) { setFeedback({ kind: 'error', text: settingsError(e, '对话状态未修改，请重试。') }); }
            finally { setBusy(''); }
          }}>{row.archived_at ? '恢复' : '归档'}</Button>
          <Button type="text" danger disabled={Boolean(busy)} data-session-delete={row.id} onClick={async () => {
            const copy = sessionDeleteConfirm(row.title);
            if (!await modal.confirm({ title: copy.title, content: <><p>{copy.object} · {copy.scope}</p><p>{copy.consequence}</p></>, okText: copy.confirmLabel, cancelText: '取消操作', autoFocusButton: 'cancel', okButtonProps: { danger: true } })) return;
            setBusy(row.id); setFeedback(null);
            try { await api.deleteSession(row.id); sessions.setData(current => current?.filter(item => item.id !== row.id) || []); onReceipt({ kind: 'session-delete', object: copy.object, scope: copy.scope, consequence: copy.consequence, text: `已删除对话「${copy.object}」。` }); summary.reload(); }
            catch (e) { setFeedback({ kind: 'error', text: settingsError(e, '对话未删除，请重试。') }); }
            finally { setBusy(''); }
          }}>删除</Button>
        </div></div>)}
        {rows.length > 10 && <Pagination current={page} total={rows.length} pageSize={10} showSizeChanger={false} onChange={setPage} />}
      </LoadState>
    </section>{holder}
  </section>;
}
