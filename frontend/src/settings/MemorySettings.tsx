import { useCallback, useState } from 'react';
import { Button, Checkbox, Drawer, Form, Input, Modal, Pagination } from 'antd';
import { api } from '../api';
import { ActionGroup, HorizontalForm, RecordRow, TruncatableText } from '../components/InformationLayout';
import { memoryDeleteConfirm } from '../adminConfirm';
import type { SettingsReceipt } from '../settingsReceipt';
import { settingsError } from '../settingsClient';
import { FeedbackLine, LoadState, useLoad, type DirtyProps, type Feedback } from './SettingsState';
type Memory = { id?: string; title?: string; body_md?: string; enabled?: boolean; scope?: string; version?: number; editable?: boolean };
export function MemorySettings({ onDirty, onReceipt }: DirtyProps & { onReceipt: (value: Omit<SettingsReceipt, 'at'>) => void }) {
  const load = useCallback(() => api.memories() as Promise<Memory[]>, []);
  const result = useLoad(load, '无法读取记忆，请重试。');
  const [editing, setEditing] = useState<Memory | null>(null); const [query, setQuery] = useState(''); const [page, setPage] = useState(1);
  const [editingSequence, setEditingSequence] = useState(0); const [busy, setBusy] = useState(false); const [changed, setChanged] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null); const [modal, holder] = Modal.useModal();
  const rows = (result.data || []).filter(row => !query || `${row.title || ''} ${row.body_md || ''}`.toLowerCase().includes(query.toLowerCase()));
  const open = (value: Memory) => { setEditingSequence(sequence => sequence + 1); setEditing(value); setChanged(false); setFeedback(null); };
  const close = async () => {
    if (busy) return;
    if (changed && !await modal.confirm({ title: '放弃未保存的记忆？', okText: '放弃修改', cancelText: '继续编辑' })) return;
    setEditing(null); setChanged(false); onDirty(false); setFeedback(null);
  };
  const remove = async (memory: Memory) => {
    if (!memory.id) return;
    const copy = memoryDeleteConfirm(memory.title || '这条记忆', memory.scope === 'team' ? '团队' : '仅自己');
    if (!await modal.confirm({ title: copy.title, content: <><p>{copy.object} · {copy.scope}</p><p>{copy.consequence}</p></>, okText: copy.confirmLabel, cancelText: '取消操作', autoFocusButton: 'cancel', okButtonProps: { danger: true } })) return;
    setBusy(true); setFeedback(null);
    try { await api.deleteMemory(memory.id); result.setData(current => current?.filter(row => row.id !== memory.id) || []); onReceipt({ kind: 'memory-delete', object: copy.object, scope: copy.scope, consequence: copy.consequence, text: `已删除记忆「${copy.object}」。` }); }
    catch (e) { setFeedback({ kind: 'error', text: settingsError(e, '记忆未删除，请重试。') }); }
    finally { setBusy(false); }
  };
  return <section className="settings-editor settings-list-panel">
    <div className="settings-list-tools"><Input.Search aria-label="搜索记忆" placeholder="搜索记忆" value={query} allowClear onChange={e => { setQuery(e.target.value); setPage(1); }} /><Button type={editing ? 'text' : 'primary'} className={editing ? '' : 'settings-primary'} onClick={() => open({ enabled: true, scope: 'private', editable: true })}>新建记忆</Button></div>
    <LoadState {...result} retry={result.reload}>
      {!rows.length && <p className="settings-help">{query ? '没有匹配的记忆。' : '尚无记忆。可以记录下次任务需要复用的偏好。'}</p>}
      {rows.slice((page - 1) * 10, page * 10).map(memory => <RecordRow key={memory.id} data-memory-row={memory.id} title={<TruncatableText text={memory.title || '未命名记忆'} />} meta={memory.scope === 'team' ? '团队共享' : '仅自己'} status={memory.enabled === false ? '已停用' : '已启用'} actions={<ActionGroup><Button type="text" onClick={() => open(memory)}>{memory.editable === false ? '查看' : '编辑'}</Button>{memory.editable !== false && <Button type="text" danger disabled={busy} data-memory-delete={memory.id} onClick={() => void remove(memory)}>删除</Button>}</ActionGroup>} />)}
      {rows.length > 10 && <Pagination current={page} total={rows.length} pageSize={10} showSizeChanger={false} onChange={setPage} />}
    </LoadState>{!editing && <FeedbackLine value={feedback} />}
    <Drawer title={editing?.id ? '记忆详情' : '新建记忆'} open={Boolean(editing)} onClose={() => void close()} className="settings-memory-drawer" width="min(100vw, var(--drawer-w-sm))" destroyOnHidden maskClosable={!changed && !busy} keyboard={!busy}>
      <HorizontalForm key={editingSequence} initialValues={{ title: '', body_md: '', enabled: true, ...editing }} disabled={busy || editing?.editable === false} onValuesChange={() => { setChanged(true); onDirty(true); setFeedback(null); }} onFinish={async values => {
        setBusy(true); setFeedback(null);
        try {
          const body = { title: String(values.title), body_md: String(values.body_md), scope: editing?.scope || 'private', enabled: Boolean(values.enabled) };
          const saved = (editing?.id ? await api.updateMemory(editing.id, body) : await api.createMemory(body)) as Memory;
          result.setData(current => editing?.id ? current?.map(row => row.id === editing.id ? saved : row) || [saved] : [saved, ...(current || [])]);
          setEditing(null); setChanged(false); onDirty(false); setFeedback({ kind: 'success', text: '记忆已保存。' });
        } catch (e) { setFeedback({ kind: 'error', text: settingsError(e, '记忆未保存，请重试。') }); }
        finally { setBusy(false); }
      }}>
        <Form.Item label="标题" name="title" rules={[{ required: true, whitespace: true, message: '请填写标题。' }]}><Input /></Form.Item>
        <Form.Item className="ui-field-stacked" label="内容" name="body_md" rules={[{ required: true, whitespace: true, message: '请填写内容。' }]}><Input.TextArea rows={7} /></Form.Item>
        <Form.Item name="enabled" label="使用状态" valuePropName="checked"><Checkbox>在适用任务中使用</Checkbox></Form.Item>
        <p className="settings-help">{editing?.scope === 'team' ? '这条记忆保留原有团队范围；个人设置不扩大共享范围。' : '仅自己可见，不改变企业资料和业务权限。'}</p>
        {editing?.version && <details className="settings-details"><summary>版本信息</summary><p>版本 {editing.version}</p></details>}
        <FeedbackLine value={feedback} />{editing?.editable !== false && <Button htmlType="submit" type="primary" className="settings-primary" loading={busy}>保存记忆</Button>}
      </HorizontalForm>
    </Drawer>{holder}
  </section>;
}
