import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Alert, Button, Skeleton } from 'antd';
import { settingsError } from '../settingsClient';
export type Feedback = { kind: 'success' | 'error'; text: string } | null;
export function FeedbackLine({ value }: { value: Feedback }) {
  return value ? <Alert type={value.kind} title={value.text} showIcon role={value.kind === 'error' ? 'alert' : 'status'} /> : null;
}
export function useLoad<T>(load: () => Promise<T>, fallback: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [generation, setGeneration] = useState(0);
  const reload = useCallback(() => setGeneration(n => n + 1), []);
  useEffect(() => {
    let alive = true; setLoading(true); setError('');
    void load().then(result => { if (alive) setData(result); })
      .catch(e => { if (alive) setError(settingsError(e, fallback)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [load, fallback, generation]);
  return { data, setData, loading, error, reload };
}
export function LoadState({ loading, error, retry, children }: { loading: boolean; error: string; retry: () => void; children: ReactNode }) {
  if (loading) return <div aria-label="正在读取设置" aria-busy="true"><Skeleton active paragraph={{ rows: 3 }} /></div>;
  if (error) return <Alert type="error" title={error} showIcon action={<Button type="text" onClick={retry}>重试</Button>} />;
  return <>{children}</>;
}
export type DirtyProps = { onDirty: (value: boolean) => void };
