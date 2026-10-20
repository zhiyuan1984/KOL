import { Alert, Checkbox, Drawer, Input } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type WecomCommitReceipt,
  type WecomPreviewResponse,
  type WecomSnapshotPage,
  type WecomSnapshotRow,
  type WecomSourceRecordKind,
  type WecomStatusResponse,
} from '../../../shared/wecom-ontology';
import CompactButton from '../components/CompactButton';
import { PropertyList } from '../components/InformationLayout';
import { useTransientReceipt } from '../components/useTransientReceipt';
import { WecomOntologyApiError, wecomOntologyApi } from './wecomApi';

type RecordKindFilter = WecomSourceRecordKind | 'all';
type UncertainCommit = { commandId: string; message: string; checking?: boolean };
type StoredPendingCommit = {
  commandId: string;
  preview: WecomPreviewResponse;
  reason: string;
  confirmed: boolean;
  savedAt: number;
};

const kindNames: Record<WecomSourceRecordKind, string> = {
  department: '部门',
  person: '员工',
  membership: '成员关系',
};

const rowPageSize = 20;
const supportedKinds: Array<RecordKindFilter> = ['all', 'department', 'person', 'membership'];

function text(value: unknown, empty = '—'): string {
  if (value === null || value === undefined || value === '') return empty;
  if (Array.isArray(value)) return value.length ? value.map(item => text(item, '')).filter(Boolean).join('、') : empty;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function timestamp(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Math.abs(value) < 100_000_000_000 ? value * 1000 : value;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function time(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return '未提供';
  const milliseconds = timestamp(value);
  return milliseconds === null ? String(value) : new Date(milliseconds).toLocaleString('zh-CN', { hour12: false });
}

function objectProperties(row: WecomSnapshotRow) {
  return row.ontologyProperties || {};
}

function rowTitle(row: WecomSnapshotRow) {
  const properties = objectProperties(row);
  if (row.kind === 'department') return text(properties.wecom_name ?? row.attributes.name ?? row.upstreamId);
  if (row.kind === 'person') return text(properties.wecom_name ?? row.attributes.name ?? row.upstreamId);
  return `${text(properties.wecom_member_user_id ?? row.attributes.userId ?? row.upstreamId)} → ${text(properties.wecom_department_id ?? row.attributes.departmentId)}`;
}

function propertySummary(row: WecomSnapshotRow) {
  const properties = objectProperties(row);
  if (row.kind === 'department') return `上级 ${text(properties.wecom_parent_id ?? row.attributes.parentId)} · 路径 ${text(properties.wecom_path ?? row.attributes.path)}`;
  if (row.kind === 'person') return `职位文本 ${text(properties.wecom_position_text ?? row.attributes.position)} · 主部门 ${text(properties.wecom_main_department_id ?? row.attributes.mainDepartmentId)}`;
  return `主关系 ${text(properties.wecom_is_main ?? row.attributes.isMain)} · 负责人 ${text(properties.wecom_is_leader ?? row.attributes.isLeader)}`;
}

function reference(value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) {
    const items = value.slice(0, 4).map(item => typeof item === 'object' ? '已记录引用' : text(item)).filter(Boolean);
    return `${items.join('、') || '—'}${value.length > 4 ? ` 等 ${value.length} 项` : ''}`;
  }
  return typeof value === 'object' ? '已记录引用' : text(value);
}

function relationSummary(row: WecomSnapshotRow) {
  const properties = objectProperties(row);
  if (row.kind === 'department') return `负责人：${reference(properties.wecom_leader_user_ids ?? row.relations.wecom_leaders ?? row.relations.leaderUserIds)}`;
  if (row.kind === 'person') return `归属部门：${reference(properties.wecom_departments ?? row.relations.wecom_member_departments ?? row.attributes.departments)}；直属上级：${reference(properties.wecom_direct_leader_ids ?? row.relations.wecom_direct_leaders ?? row.attributes.directLeaderUserIds)}`;
  return `成员：${reference(properties.wecom_member_user_id ?? row.relations.wecom_member)}；组织：${reference(properties.wecom_department_id ?? row.relations.wecom_organization)}`;
}

function localCommandId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `wecom-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : '企微本体来源操作失败，请稍后重试。';
}

function canBeUncertain(error: unknown) {
  return error instanceof WecomOntologyApiError && (error.status === 0 || error.retryable);
}

function pendingStorageKey(companyId: string) {
  return `wecom-ontology-pending:${companyId}`;
}

function readPendingCommit(companyId: string): StoredPendingCommit | null {
  if (!companyId || typeof window === 'undefined') return null;
  try {
    const value = JSON.parse(window.sessionStorage.getItem(pendingStorageKey(companyId)) || 'null') as Partial<StoredPendingCommit> | null;
    return value?.commandId && value.preview?.companyId === companyId ? value as StoredPendingCommit : null;
  } catch {
    return null;
  }
}

function savePendingCommit(companyId: string, value: StoredPendingCommit) {
  if (typeof window !== 'undefined') window.sessionStorage.setItem(pendingStorageKey(companyId), JSON.stringify(value));
}

function clearPendingCommit(companyId: string) {
  if (typeof window !== 'undefined') window.sessionStorage.removeItem(pendingStorageKey(companyId));
}

function propertyDetails(row: WecomSnapshotRow) {
  return JSON.stringify({ ontologyProperties: row.ontologyProperties, attributes: row.attributes }, null, 2);
}

export default function WecomOntologySourcePanel({ open, companyId, onClose }: { open: boolean; companyId: string; onClose: () => void }) {
  const [status, setStatus] = useState<WecomStatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState('');
  const [preview, setPreview] = useState<WecomPreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState('');
  const [uncertain, setUncertain] = useState<UncertainCommit | null>(null);
  const [receipt, setReceipt] = useState<WecomCommitReceipt | null>(null);
  const [snapshotPages, setSnapshotPages] = useState<WecomSnapshotPage[]>([]);
  const [snapshotIndex, setSnapshotIndex] = useState(0);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotError, setSnapshotError] = useState('');
  const [snapshotEmpty, setSnapshotEmpty] = useState('');
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [recordKind, setRecordKind] = useState<RecordKindFilter>('all');
  const [previewPage, setPreviewPage] = useState(0);
  const commandId = useRef('');
  const panelGeneration = useRef(0);
  const statusSequence = useRef(0);
  const snapshotSequence = useRef(0);
  const receiptSequence = useRef(0);
  const previewSequence = useRef(0);
  const commitSequence = useRef(0);
  const recordKindRef = useRef<RecordKindFilter>('all');
  const { receipt: transientReceipt, showReceipt, clearReceipt } = useTransientReceipt();

  useEffect(() => {
    recordKindRef.current = recordKind;
  }, [recordKind]);

  const loadSnapshot = useCallback(async (input: { snapshotId?: string; cursor?: string | null; append?: boolean; kind?: RecordKindFilter } = {}) => {
    if (!companyId) {
      return null;
    }
    const generation = panelGeneration.current;
    const sequence = ++snapshotSequence.current;
    const isCurrent = () => generation === panelGeneration.current && sequence === snapshotSequence.current;
    setSnapshotLoading(true);
    setSnapshotError('');
    setSnapshotEmpty('');
    const kind = input.kind === undefined ? recordKindRef.current : input.kind;
    try {
      const page = await wecomOntologyApi.snapshot(companyId, {
        snapshotId: input.snapshotId,
        cursor: input.cursor,
        kind: kind === 'all' ? null : kind,
        pageSize: rowPageSize,
      });
      if (!isCurrent()) return null;
      if (!page) {
        setSnapshotPages([]);
        setSnapshotIndex(0);
        setSnapshotEmpty('暂无已导入来源快照。读取来源状态不代表已导入或保存本体来源快照。');
        return null;
      }
      setSnapshotPages(previous => input.append ? [...previous, page] : [page]);
      setSnapshotIndex(previous => input.append ? previous + 1 : 0);
      return page;
    } catch (error) {
      if (isCurrent() && error instanceof WecomOntologyApiError && error.status === 404 && !input.snapshotId) {
        setSnapshotPages([]);
        setSnapshotIndex(0);
        setSnapshotEmpty('暂无已导入来源快照。读取来源状态不代表已导入或保存本体来源快照。');
      } else if (isCurrent()) {
        setSnapshotError(errorText(error));
      }
      return null;
    } finally {
      if (isCurrent()) setSnapshotLoading(false);
    }
  }, [companyId]);

  const readStatus = useCallback(async () => {
    if (!companyId) return;
    const generation = panelGeneration.current;
    const sequence = ++statusSequence.current;
    const isCurrent = () => generation === panelGeneration.current && sequence === statusSequence.current;
    setStatusLoading(true);
    setStatusError('');
    try {
      const next = await wecomOntologyApi.status(companyId);
      if (isCurrent()) setStatus(next);
    } catch (error) {
      if (isCurrent()) {
        setStatus(null);
        setStatusError(errorText(error));
      }
    } finally {
      if (isCurrent()) setStatusLoading(false);
    }
  }, [companyId]);

  const checkReceipt = useCallback(async (id: string) => {
    if (!companyId || !id) return;
    const generation = panelGeneration.current;
    const sequence = ++receiptSequence.current;
    const isCurrent = () => generation === panelGeneration.current && sequence === receiptSequence.current;
    setReceiptLoading(true);
    setUncertain(current => current?.commandId === id ? { ...current, checking: true } : { commandId: id, message: '正在只读查询该导入命令的回执…', checking: true });
    try {
      const result = await wecomOntologyApi.receipt(companyId, id);
      if (!isCurrent()) return;
      if (!result.receipt) {
        setUncertain({ commandId: id, message: `未查询到命令 ${id} 的导入回执。已恢复原幂等命令和候选预览，但不会自动重新提交。` });
        return;
      }
      setReceipt(result.receipt);
      setPreview(null);
      setReason('');
      setConfirmed(false);
      setUncertain(null);
      clearPendingCommit(companyId);
      showReceipt(`已只读确认导入回执 ${result.receipt.receiptId}；未重新提交。`);
      void loadSnapshot({ snapshotId: result.receipt.snapshotId, kind: recordKindRef.current });
      void readStatus();
    } catch (error) {
      if (isCurrent()) setUncertain({ commandId: id, message: `${errorText(error)}；尚未确认是否已提交，请稍后只读查询回执。` });
    } finally {
      if (isCurrent()) setReceiptLoading(false);
    }
  }, [companyId, loadSnapshot, readStatus, showReceipt]);

  useEffect(() => {
    ++panelGeneration.current;
    if (!open) return;
    setPreview(null);
    setReceipt(null);
    setReason('');
    setConfirmed(false);
    setCommitError('');
    setUncertain(null);
    setSnapshotPages([]);
    setSnapshotIndex(0);
    setSnapshotError('');
    setSnapshotEmpty('');
    setRecordKind('all');
    setPreviewPage(0);
    clearReceipt();
    const pending = readPendingCommit(companyId);
    commandId.current = pending?.commandId || '';
    if (pending) {
      setPreview(pending.preview);
      setReason(pending.reason);
      setConfirmed(pending.confirmed);
      setUncertain({ commandId: pending.commandId, message: '发现未确认结果的导入命令，正在只读查询回执…', checking: true });
      void checkReceipt(pending.commandId);
    }
    void readStatus();
  }, [open, companyId, checkReceipt, clearReceipt, readStatus]);

  const currentSnapshot = snapshotPages[snapshotIndex] || null;
  const sourceAvailable = !!status?.syncStatus.data?.initialized && !!status?.syncStatus.data?.queryEnabled && !status.syncStatus.errorCode;
  const sourcePublishedAt = status?.syncStatus.data?.publishedAt ?? status?.syncStatus.lastSyncedAt;
  const sourceAge = timestamp(sourcePublishedAt);
  const historicalSource = !!status && ((sourceAge !== null && Date.now() - sourceAge > 30 * 60_000) || (status.syncStatus.warnings?.length || 0) > 0);
  const previewRows = useMemo(() => preview?.rows.filter(row => recordKind === 'all' || row.kind === recordKind) || [], [preview, recordKind]);
  const previewPages = Math.max(1, Math.ceil(previewRows.length / rowPageSize));
  const shownPreviewRows = previewRows.slice(previewPage * rowPageSize, (previewPage + 1) * rowPageSize);
  const shownRows = currentSnapshot ? currentSnapshot.rows : shownPreviewRows;
  const shownVersion = currentSnapshot?.sourceVersion || preview?.sourceVersion || receipt?.sourceVersion || null;
  const countSource = receipt?.rowCounts || preview?.counts || null;

  const changeRecordKind = (next: RecordKindFilter) => {
    setRecordKind(next);
    setPreviewPage(0);
    if (receipt?.snapshotId || currentSnapshot?.snapshotId) {
      void loadSnapshot({ snapshotId: receipt?.snapshotId || currentSnapshot?.snapshotId, kind: next });
    }
  };

  const createPreview = async () => {
    if (!companyId || uncertain || receiptLoading) return;
    const generation = panelGeneration.current;
    const sequence = ++previewSequence.current;
    const isCurrent = () => generation === panelGeneration.current && sequence === previewSequence.current;
    setPreviewLoading(true);
    setPreviewError('');
    setCommitError('');
    setUncertain(null);
    setReceipt(null);
    setSnapshotPages([]);
    try {
      const next = await wecomOntologyApi.preview({ companyId, pageSize: 200, maxRows: 1000 });
      if (!isCurrent()) return;
      setPreview(next);
      setPreviewPage(0);
      setReason('');
      setConfirmed(false);
      commandId.current = localCommandId();
      showReceipt(`已生成候选预览 · 来源版本 ${next.sourceVersion.version} · 尚未导入`);
    } catch (error) {
      if (isCurrent()) setPreviewError(errorText(error));
    } finally {
      if (isCurrent()) setPreviewLoading(false);
    }
  };

  const commitPreview = async () => {
    if (!preview || !confirmed || !reason.trim() || uncertain || receiptLoading) return;
    const id = commandId.current || localCommandId();
    commandId.current = id;
    const generation = panelGeneration.current;
    const sequence = ++commitSequence.current;
    const isCurrent = () => generation === panelGeneration.current && sequence === commitSequence.current;
    savePendingCommit(companyId, { commandId: id, preview, reason: reason.trim(), confirmed, savedAt: Date.now() });
    setCommitting(true);
    setCommitError('');
    setUncertain(null);
    try {
      const next = await wecomOntologyApi.commit({
        companyId,
        confirmed: true,
        previewToken: preview.previewToken,
        contentHash: preview.contentHash,
        commandId: id,
        reason: reason.trim(),
      });
      clearPendingCommit(companyId);
      if (!isCurrent()) return;
      setReceipt(next);
      setPreview(null);
      setReason('');
      setConfirmed(false);
      showReceipt(`${next.replayed ? '已确认既有' : '已导入'}本体来源快照 · 回执 ${next.receiptId}`);
      await loadSnapshot({ snapshotId: next.snapshotId, kind: recordKind });
      void readStatus();
    } catch (error) {
      if (!isCurrent()) return;
      if (canBeUncertain(error)) {
        setUncertain({ commandId: id, message: errorText(error) });
      } else {
        clearPendingCommit(companyId);
        setCommitError(errorText(error));
      }
    } finally {
      if (isCurrent()) setCommitting(false);
    }
  };

  const sourceVersionItems = shownVersion ? [
    { key: 'source', label: '来源', value: shownVersion.source },
    { key: 'version', label: '版本', value: shownVersion.version },
    { key: 'department-batch', label: '部门批次', value: shownVersion.departmentBatchId },
    { key: 'user-batch', label: '员工批次', value: shownVersion.userBatchId },
    { key: 'published-at', label: '来源发布时间', value: time(shownVersion.publishedAt) },
    { key: 'synced-at', label: '来源同步时间', value: time(shownVersion.lastSyncedAt) },
  ] : [];
  const requestClose = () => {
    ++panelGeneration.current;
    onClose();
  };

  return <Drawer
    className="wecom-ontology-drawer"
    title="企业微信来源"
    placement="right"
    size="var(--drawer-w-lg)"
    open={open}
    onClose={committing ? undefined : requestClose}
    mask={{ closable: !committing }}
    keyboard={!committing}
    destroyOnHidden
    footer={<div className="wecom-source-footer"><CompactButton onClick={requestClose} disabled={committing}>关闭</CompactButton></div>}
  >
    <section className="wecom-source-panel" aria-label="企业微信组织人员本体来源">
      <header className="wecom-source-heading">
        <div>
          <h2>组织与人员来源快照</h2>
          <p>只读取企业微信通讯录，生成可核对的本体来源快照与引用。</p>
        </div>
        <CompactButton onClick={() => void readStatus()} disabled={statusLoading || committing || receiptLoading}>{statusLoading ? '读取中…' : '重新读取状态'}</CompactButton>
      </header>

      <Alert className="wecom-source-boundary" type="info" showIcon title="来源边界" description="导入只保存版本化本体来源快照及外部引用；不会创建或变更真实组织、员工账号、角色权限、成员资格或 Agent 绑定。企业微信通讯录的职位仅是职位文本，不等于岗位编制、HR 合同或实时人事档案。" />

      {transientReceipt.text && <p className={`wecom-source-receipt is-transient${transientReceipt.visible ? ' is-visible' : ''}`} role="status" aria-live="polite">{transientReceipt.text}</p>}

      {statusLoading && <p className="wecom-source-loading" role="status">正在读取当前公司企微来源、运行时装配与已导入快照状态…</p>}
      {statusError && <Alert type="warning" showIcon title="来源当前不可用" description={<div><p>{statusError}</p><p>不会改写当前组织、账号或权限。若曾成功导入，可只读查询该公司最近的来源快照。</p><CompactButton onClick={() => void loadSnapshot({ kind: recordKind })} disabled={snapshotLoading}>读取已导入快照</CompactButton></div>} />}

      {status && <>
        <section className="wecom-source-section" aria-labelledby="wecom-source-status-title">
          <h3 id="wecom-source-status-title">当前来源状态</h3>
          <PropertyList labelWidth="long" items={[
            { key: 'company', label: '公司范围', value: status.companyId },
            { key: 'runtime', label: '运行路径', value: '平台 sync Agent → 已装配 skill → 企业微信连接器' },
            { key: 'skill', label: '装配 skill', value: status.runtimeBinding.skillId },
            { key: 'connector', label: '连接器', value: status.runtimeBinding.connectorId },
            { key: 'sync', label: '通讯录状态', value: status.syncStatus.data?.queryEnabled ? '可读取当前来源' : status.syncStatus.errorCode ? `不可用 · ${status.syncStatus.errorCode}` : '未就绪' },
            { key: 'source-time', label: '上次来源同步', value: time(status.syncStatus.lastSyncedAt) },
          ]} />
          {!sourceAvailable && <Alert type="warning" showIcon title="当前来源不可读取" description="连接器、平台 sync skill 或管理员公司范围尚未就绪。请在管理端完成连接器与 skill 装配后重新读取；本面不会伪造实时数据，也不自动重试。" />}
          <CompactButton onClick={() => void loadSnapshot({ kind: recordKind })} disabled={snapshotLoading || receiptLoading}>读取已导入快照</CompactButton>
        </section>

        {historicalSource && <Alert className="wecom-source-history-warning" type="warning" showIcon title="当前可读来源可能为历史快照" description={`上游来源版本 ${status.syncStatus.data?.publishedVersion ?? '—'}（来源发布：${time(status.syncStatus.data?.publishedAt)}）可能早于 30 分钟或带有来源告警。该状态只描述企业微信上游来源，不表示本工作台已导入或保存快照。`} />}

        <details className="wecom-source-section" aria-labelledby="wecom-source-binding-title">
          <summary id="wecom-source-binding-title">字段绑定与本体对象</summary>
          <p className="wecom-source-helper">字段仅保留企业微信来源事实和引用，不按姓名匹配、不推断 HR 在职状态。</p>
          <div className="wecom-source-bindings">
            {status.fieldBindings.map(binding => <article key={`${binding.kind}:${binding.sourceField}`}>
              <strong>{kindNames[binding.kind]}</strong><span>{binding.sourceField} → {binding.target}</span><small>{binding.meaning}</small>
            </article>)}
          </div>
          <div className="wecom-source-mappings">
            {status.objectMappings.map(mapping => <article key={mapping.kind}>
              <strong>{kindNames[mapping.kind]} → {mapping.objectCode}</strong>
              <span>属性：{mapping.properties.join('、')}</span>
              <span>关系：{mapping.relations.join('、')}</span>
            </article>)}
          </div>
          <p className="wecom-source-helper">本来源快照只投影组织、员工、成员关系这 3 个规范本体对象，供当前入口共同核对；不表示入口中其他本体对象已获得实例填值。</p>
        </details>
      </>}

      {previewError && <Alert type="error" showIcon title="未生成预览" description={previewError} />}
      {sourceAvailable && !preview && !receipt && <section className="wecom-source-section wecom-source-action" aria-labelledby="wecom-preview-title">
        <h3 id="wecom-preview-title">读取来源并生成候选预览</h3>
        <p>预览会读取当前企业微信已发布通讯录批次，最多保留 1,000 条来源记录供核对。预览本身不导入、不改写既有组织或权限。</p>
        <CompactButton emphasis="primary" size="md" onClick={() => void createPreview()} disabled={previewLoading || !!uncertain || receiptLoading}>{previewLoading ? '正在生成预览…' : '生成来源预览'}</CompactButton>
      </section>}

      {preview && <section className="wecom-source-section wecom-source-preview" aria-labelledby="wecom-preview-result-title">
        <h3 id="wecom-preview-result-title">候选预览 · 尚未导入</h3>
        <div className="wecom-source-counts" aria-label="候选数量"><span>部门 {preview.counts.department}</span><span>员工 {preview.counts.person}</span><span>成员关系 {preview.counts.membership}</span></div>
        <Alert type="warning" showIcon title="候选数据未导入" description={`来源版本 ${preview.sourceVersion.version}；预览有效至 ${time(preview.expiresAt)}。来源、版本、连接器或 skill 装配变化时，必须重新预览。`} />
        {preview.warnings.length > 0 && <ul className="wecom-source-warnings">{preview.warnings.map((warning, index) => <li key={`${warning.code}:${index}`}>{warning.message}{warning.detail ? ` · ${warning.detail}` : ''}</li>)}</ul>}
        <div className="wecom-source-confirm">
          <label htmlFor="wecom-import-reason">导入原因 *</label>
          <Input.TextArea id="wecom-import-reason" aria-label="导入原因" rows={2} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} placeholder="说明本次确认该来源快照的业务原因" disabled={committing || !!uncertain || receiptLoading} />
          <Checkbox checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={committing || !!uncertain || receiptLoading}>我已核对来源、版本、候选数量与影响边界；确认仅导入本体来源快照和引用</Checkbox>
          <p className="wecom-source-helper">确认不创建真实组织或账号，不变更角色权限、成员资格或 Agent 使用资格。</p>
          <CompactButton emphasis="primary" size="md" onClick={() => void commitPreview()} disabled={committing || !!uncertain || receiptLoading || !confirmed || !reason.trim()}>{committing ? '正在确认导入…' : '确认导入来源快照'}</CompactButton>
        </div>
      </section>}

      {commitError && <Alert type="error" showIcon title="导入未完成" description={commitError} />}
      {uncertain && <Alert type="warning" showIcon title="导入结果待核查" description={<div><p>{uncertain.message}</p><p>已保留命令标识 {uncertain.commandId}。结果未确认前，不能重新提交或生成新的预览。</p><CompactButton onClick={() => void checkReceipt(uncertain.commandId)} disabled={receiptLoading}>{receiptLoading || uncertain.checking ? '正在查询导入回执…' : '只读查询导入回执'}</CompactButton></div>} />}

      {(preview || receipt || currentSnapshot || snapshotEmpty) && <section className="wecom-source-section" aria-labelledby="wecom-record-title">
        <h3 id="wecom-record-title">来源实例记录</h3>
        <p className="wecom-source-helper">部门、员工、成员关系与人员汇报引用均是来源事实；不将职位文本解释为岗位主数据或人事状态。</p>
        {countSource && <div className="wecom-source-counts" aria-label="来源计数"><span>部门 {countSource.department}</span><span>员工 {countSource.person}</span><span>成员关系 {countSource.membership}</span></div>}
        {sourceVersionItems.length > 0 && <PropertyList className="wecom-source-version" labelWidth="long" items={sourceVersionItems} />}
        {receipt && <Alert type="success" showIcon title={`真实导入回执 ${receipt.receiptId}`} description={`快照 ${receipt.snapshotId} · ${receipt.replayed ? '本次请求已命中既有幂等回执' : '本次已保存新的版本化来源快照'} · ${time(receipt.createdAt)}`} />}
        {snapshotError && <Alert type="error" showIcon title="快照读取失败" description={snapshotError} />}
        {snapshotEmpty && <Alert type="info" showIcon title="暂无已导入来源快照" description={snapshotEmpty} />}
        <div className="wecom-source-record-tabs" role="tablist" aria-label="来源记录类型">
          {supportedKinds.map(kind => <button key={kind} type="button" role="tab" aria-selected={recordKind === kind} onClick={() => changeRecordKind(kind)}>{kind === 'all' ? '全部记录' : kindNames[kind]}</button>)}
        </div>
        {snapshotLoading && <p role="status" className="wecom-source-loading">正在读取版本化来源快照…</p>}
        {!snapshotLoading && <div className="wecom-source-table-wrap"><table className="wecom-source-table"><thead><tr><th>实例</th><th>本体对象</th><th>来源属性</th><th>关系／汇报证据</th></tr></thead><tbody>{shownRows.map(row => <tr key={row.externalId}><td><strong>{rowTitle(row)}</strong><small>{row.externalId}</small></td><td>{row.objectCode}</td><td title={propertySummary(row)}><span>{propertySummary(row)}</span><details><summary>查看完整属性</summary><pre>{propertyDetails(row)}</pre></details></td><td title={relationSummary(row)}>{relationSummary(row)}</td></tr>)}</tbody></table>{shownRows.length === 0 && !snapshotEmpty && <p className="wecom-source-empty">当前页没有{recordKind === 'all' ? '' : kindNames[recordKind]}来源实例。</p>}</div>}
        {preview && !currentSnapshot && <div className="wecom-source-pagination"><span>预览第 {previewPage + 1}/{previewPages} 页 · 当前类型 {previewRows.length} 条</span><CompactButton onClick={() => setPreviewPage(page => Math.max(0, page - 1))} disabled={previewPage === 0}>上一页</CompactButton><CompactButton onClick={() => setPreviewPage(page => Math.min(previewPages - 1, page + 1))} disabled={previewPage >= previewPages - 1}>下一页</CompactButton></div>}
        {currentSnapshot && <div className="wecom-source-pagination"><span>快照第 {snapshotIndex + 1} 页 · 每页 {currentSnapshot.pageSize} 条</span><CompactButton onClick={() => setSnapshotIndex(index => Math.max(0, index - 1))} disabled={snapshotIndex === 0 || snapshotLoading}>上一页</CompactButton><CompactButton onClick={() => currentSnapshot.nextCursor && void loadSnapshot({ snapshotId: currentSnapshot.snapshotId, cursor: currentSnapshot.nextCursor, append: true })} disabled={!currentSnapshot.nextCursor || snapshotLoading}>下一页</CompactButton></div>}
      </section>}
    </section>
  </Drawer>;
}
