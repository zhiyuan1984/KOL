import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Alert, Button, Skeleton } from 'antd';
import { settingsFailure, type SettingsFailure } from '../settingsClient';
const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type Feedback = {
  kind: 'success' | 'error' | 'info';
  text: string;
  description?: string;
  requestId?: string;
  retry?: () => void;
  retryLabel?: string;
} | null;
export function FeedbackLine({ value }: { value: Feedback }) {
  const [showDescription, setShowDescription] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  useEffect(() => { setShowDescription(false); setCopyStatus(''); }, [value?.description, value?.requestId, value?.text]);
  if (!value) return null;
  const requestId = value.requestId && requestIdPattern.test(value.requestId) ? value.requestId : undefined;
  const copyRequestId = async () => {
    if (!requestId || !navigator.clipboard?.writeText) {
      setCopyStatus('无法复制诊断编号，请手动记录。');
      return;
    }
    try {
      await navigator.clipboard.writeText(requestId);
      setCopyStatus('诊断编号已复制。');
    } catch {
      setCopyStatus('无法复制诊断编号，请手动记录。');
    }
  };
  const action = value.description || requestId || value.retry ? <div className="settings-actions">
    {value.description && <Button type="text" onClick={() => setShowDescription(current => !current)} aria-expanded={showDescription}>{showDescription ? '收起说明' : '查看说明'}</Button>}
    {requestId && <Button type="text" onClick={() => void copyRequestId()}>复制诊断编号</Button>}
    {value.retry && <Button type="text" onClick={value.retry}>{value.retryLabel || '重试'}</Button>}
    {copyStatus && <span role="status" className="settings-help">{copyStatus}</span>}
  </div> : null;
  return <Alert type={value.kind} title={value.text} description={<>{showDescription && value.description && <p>{value.description}</p>}{requestId && <p className="settings-help">诊断编号：{requestId}</p>}</>} showIcon role={value.kind === 'error' ? 'alert' : 'status'} action={action} />;
}
export function useLoad<T>(load: () => Promise<T>, fallback: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<SettingsFailure | null>(null);
  const [generation, setGeneration] = useState(0);
  const reload = useCallback(() => setGeneration(n => n + 1), []);
  useEffect(() => {
    let alive = true; setLoading(true); setError(null);
    void load().then(result => { if (alive) setData(result); })
      .catch(e => { if (alive) setError(settingsFailure(e, fallback)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [load, fallback, generation]);
  return { data, setData, loading, error, reload };
}
export function LoadState({ loading, error, retry, children }: { loading: boolean; error: SettingsFailure | null; retry: () => void; children: ReactNode }) {
  if (loading) return <div aria-label="正在读取设置" aria-busy="true"><Skeleton active paragraph={{ rows: 3 }} /></div>;
  if (error) return <FeedbackLine value={{ kind: error.kind, text: error.summary, description: error.description, requestId: error.requestId, retry: error.retryable ? retry : undefined }} />;
  return <>{children}</>;
}
export type DirtyProps = { onDirty: (value: boolean) => void };
