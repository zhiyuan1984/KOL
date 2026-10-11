import { useEffect, useRef, useState } from 'react';
import { Descriptions, Modal, Tabs } from 'antd';
import { useBlocker, useSearchParams } from 'react-router-dom';
import { useAccount } from '../components/AuthGate';
import { TaskTheme } from '../tasks/TaskTheme';
import StarryBindForm from '../components/StarryBindForm';
import { formatSettingsReceiptTime, readSettingsReceipt, writeSettingsReceipt, type SettingsReceipt } from '../settingsReceipt';
import '../settings/settings.css';
import { ProfileSettings, PreferenceSettings, PasswordSettings, MemorySettings, PrivacySettings } from '../settings/SettingsPanels';

const categories = [
  { key: 'profile', label: '个人资料' }, { key: 'starry', label: '账号与邮箱' },
  { key: 'preferences', label: '工作偏好' }, { key: 'security', label: '账户安全' },
  { key: 'memories', label: '记忆' }, { key: 'privacy', label: '隐私与数据' },
];
export default function AccountSettings() {
  const { account, refresh } = useAccount();
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab') || 'profile';
  const tab = categories.some(item => item.key === requested) ? requested : 'profile';
  const [dirty, setDirty] = useState(false);
  const [receipt, setReceipt] = useState<SettingsReceipt | null>(null);
  const [modal, modalHolder] = Modal.useModal();
  const blocker = useBlocker(dirty);
  const confirming = useRef(false);
  const owner = account?.id || '';
  useEffect(() => { setReceipt(owner ? readSettingsReceipt({ accountId: owner }) : null); setDirty(false); }, [owner]);
  useEffect(() => { setDirty(false); }, [tab]);
  useEffect(() => {
    if (blocker.state !== 'blocked') { confirming.current = false; return; }
    if (blocker.state !== 'blocked' || confirming.current) return;
    confirming.current = true;
    void (async () => {
      const leave = await modal.confirm({ title: '放弃未保存的修改？', content: '当前修改尚未保存。', okText: '放弃修改', cancelText: '继续编辑', autoFocusButton: 'cancel' });
      if (leave) { setDirty(false); blocker.proceed(); } else blocker.reset();
    })();
  }, [blocker, modal]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [dirty]);
  const changeTab = async (key: string) => {
    if (key === tab) return;
    const next = new URLSearchParams(params);
    if (key === 'profile') next.delete('tab'); else next.set('tab', key);
    setParams(next);
  };
  const recordReceipt = (value: Omit<SettingsReceipt, 'at'>) => setReceipt(writeSettingsReceipt(value, { accountId: owner }));
  const receiptTab = receipt?.kind === 'memory-delete' ? 'memories' : receipt?.kind === 'session-delete' ? 'privacy' : 'starry';
  return <TaskTheme><div className="settings-page settings-v2">
    <h1>个人设置</h1>
    <Tabs className="settings-navigation" activeKey={tab} items={categories} onChange={key => void changeTab(key)} aria-label="设置分类" />
    <div className="settings-content" key={`${owner}:${tab}`}>
      {tab === 'profile' && <ProfileSettings onDirty={setDirty} onSaved={refresh} />}
      {tab === 'starry' && <StarryBindForm onSaved={() => void refresh()} onReceipt={recordReceipt} onDirty={setDirty} />}
      {tab === 'preferences' && <PreferenceSettings onDirty={setDirty} />}
      {tab === 'security' && <PasswordSettings onDirty={setDirty} />}
      {tab === 'memories' && <MemorySettings onDirty={setDirty} onReceipt={recordReceipt} />}
      {tab === 'privacy' && <PrivacySettings onDirty={setDirty} onReceipt={recordReceipt} />}
      {receipt && receiptTab === tab && <details className="settings-operation-receipt" data-settings-receipt={receipt.kind}>
        <summary>最近操作 · {formatSettingsReceiptTime(receipt.at)}</summary>
        <p data-settings-receipt-text>{receipt.text}</p>
        <Descriptions column={1} size="small" items={[
          { key: 'object', label: '对象', children: <span data-settings-receipt-object>{receipt.object}</span> },
          { key: 'scope', label: '范围', children: <span data-settings-receipt-scope>{receipt.scope}</span> },
          { key: 'consequence', label: '后果', children: <span data-settings-receipt-consequence>{receipt.consequence}</span> },
        ]} />
      </details>}
    </div>{modalHolder}
  </div></TaskTheme>;
}
