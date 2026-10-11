import { useState } from 'react';
import { Alert, Button, Form, Modal, Select } from 'antd';
import { api } from '../api';
import { ActionGroup, HorizontalForm, RecordRow, TruncatableText } from './InformationLayout';
import { starryUnbindConfirm } from '../adminConfirm';
import type { SettingsReceipt } from '../settingsReceipt';
import { settingsClient, settingsError } from '../settingsClient';
import { FeedbackLine, LoadState, useLoad, type Feedback } from '../settings/SettingsState';

export default function StarryBindForm({ onSaved, onReceipt, onDirty }: {
  onSaved: () => void;
  onReceipt?: (receipt: Omit<SettingsReceipt, 'at'>) => void;
  onDirty?: (value: boolean) => void;
}) {
  const result = useLoad(settingsClient.context, '无法读取邮箱连接，请重试。');
  const [mailboxes, setMailboxes] = useState<Array<{ id: string; mailbox_email: string; owner_name: string; brand: string }>>([]);
  const [chosen, setChosen] = useState(''); const [busy, setBusy] = useState(''); const [feedback, setFeedback] = useState<Feedback>(null);
  const [modal, holder] = Modal.useModal();
  const probe = async () => {
    setBusy('probe'); setFeedback(null);
    try {
      const response = await api.probeStarryBinding(); setMailboxes(response.mailboxes || []); setChosen(''); onDirty?.(false);
      if (!response.mailboxes?.length) setFeedback({ kind: 'error', text: '当前没有可连接的邮箱，请联系管理员核对账号。' });
    } catch (e) { setFeedback({ kind: 'error', text: settingsError(e, '无法读取可用邮箱，请重试或联系管理员。') }); }
    finally { setBusy(''); }
  };
  const save = async () => {
    if (!chosen) { setFeedback({ kind: 'error', text: '请选择要连接的邮箱。' }); return; }
    setBusy('save'); setFeedback(null);
    try {
      const picked = mailboxes.find(row => row.mailbox_email === chosen);
      await api.saveStarryBinding({ mailbox_email: chosen, mailbox_id: picked?.id, owner_name: picked?.owner_name });
      setMailboxes([]); setChosen(''); onDirty?.(false); result.reload(); onSaved();
      setFeedback({ kind: 'success', text: '邮箱已连接。' });
    } catch (e) { setFeedback({ kind: 'error', text: settingsError(e, '邮箱未连接，请重试。') }); }
    finally { setBusy(''); }
  };
  return <section className="settings-editor settings-list-panel" data-starry-bind>
    <p className="settings-help">管理本人业务邮箱。连接正常不代表可以发送，执行时仍会校验权限。</p>
    <LoadState {...result} retry={result.reload}>
      {!result.data?.mailboxes.length && <p className="settings-help" data-starry-status="unbound">尚未连接业务邮箱。</p>}
      {result.data?.mailboxes.map(row => <RecordRow key={row.id || row.email} title={<TruncatableText text={row.email} />} meta={row.brand || undefined} status={<span data-starry-status={row.status}>{row.status === 'connected' ? '已连接' : row.status === 'expired' ? '连接已过期' : '待核验'}{row.is_default ? ' · 默认跟进邮箱' : ''}</span>} actions={<ActionGroup>
          {row.status !== 'connected' && <Button type="text" disabled={Boolean(busy)} onClick={() => void probe()}>重新验证</Button>}
          <Button type="text" danger data-starry-unbind disabled={Boolean(busy)} onClick={async () => {
            const copy = starryUnbindConfirm(row.email, '');
            if (!await modal.confirm({ title: copy.title, content: <><p>{copy.object} · {copy.scope}</p><p>{copy.consequence}</p>{row.is_default && <p>解除后不会自动改用其他邮箱。</p>}</>, okText: copy.confirmLabel, cancelText: '取消操作', autoFocusButton: 'cancel', okButtonProps: { danger: true } })) return;
            setBusy(row.email); setFeedback(null);
            try { await api.clearStarryBinding(row.email); result.reload(); setMailboxes([]); setChosen(''); onDirty?.(false); onReceipt?.({ kind: 'starry-unbind', object: copy.object, scope: copy.scope, consequence: copy.consequence, text: `已解除邮箱绑定「${copy.object}」。` }); onSaved(); }
            catch (e) { setFeedback({ kind: 'error', text: settingsError(e, '绑定未解除，请重试。') }); }
            finally { setBusy(''); }
          }}>解除绑定</Button>
        </ActionGroup>} />)}
    </LoadState>
    <FeedbackLine value={feedback} />
    <div className="settings-actions"><Button type={mailboxes.length ? 'text' : 'primary'} className={mailboxes.length ? '' : 'settings-primary'} data-starry-probe loading={busy === 'probe'} disabled={Boolean(busy)} onClick={() => void probe()}>读取可用邮箱</Button></div>
    {mailboxes.length > 0 && <HorizontalForm labelWidth="long" onFinish={() => void save()}>
      <Form.Item className="ui-field-wide" label="选择要连接的邮箱"><Select aria-label="选择要连接的邮箱" value={chosen || undefined} placeholder="请选择邮箱" showSearch optionFilterProp="label" disabled={Boolean(busy)} onChange={value => { setChosen(value); onDirty?.(true); setFeedback(null); }} options={mailboxes.map(box => ({ value: box.mailbox_email, label: `${box.mailbox_email}${box.brand ? ` · ${box.brand}` : ''}` }))} /></Form.Item>
      <div className="settings-actions ui-form-actions"><Button htmlType="submit" type="primary" className="settings-primary" data-starry-save loading={busy === 'save'} disabled={Boolean(busy) || !chosen}>绑定所选邮箱</Button><Button type="text" onClick={() => { setChosen(''); setMailboxes([]); onDirty?.(false); }}>取消</Button></div>
    </HorizontalForm>}
    {result.data?.mailboxes.some(row => row.status === 'expired') && <Alert type="warning" title="过期邮箱不可作为有效默认值，请恢复连接后再选择。" showIcon />}
    {holder}
  </section>;
}
