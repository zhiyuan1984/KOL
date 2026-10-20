import {
  wecomOntologyUrls,
  type WecomCommitReceipt,
  type WecomCommitRequest,
  type WecomPreviewRequest,
  type WecomPreviewResponse,
  type WecomSnapshotPage,
  type WecomSourceRecordKind,
  type WecomStatusResponse,
} from '../../../shared/wecom-ontology';

export class WecomOntologyApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'WecomOntologyApiError';
  }
}

export type WecomReceiptLookupResponse = { receipt: WecomCommitReceipt | null };

function errorDetail(value: unknown): { message: string; code?: string; retryable: boolean } {
  const detail = value && typeof value === 'object' && 'detail' in value ? (value as { detail?: unknown }).detail : value;
  if (typeof detail === 'string') return { message: detail, retryable: false };
  if (detail && typeof detail === 'object') {
    const data = detail as { message?: unknown; code?: unknown; retryable?: unknown };
    return {
      message: typeof data.message === 'string' ? data.message : '企微本体来源请求失败',
      code: typeof data.code === 'string' ? data.code : undefined,
      retryable: data.retryable === true,
    };
  }
  return { message: '企微本体来源请求失败', retryable: false };
}

async function request<T>(url: string, companyId: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'X-Ontology-Company': companyId,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new WecomOntologyApiError('企微本体来源暂时无法连接；尚未确认是否已提交。请先查询回执或快照。', 0, 'wecom_network_unavailable', true);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new WecomOntologyApiError(response.ok ? '企微本体来源没有返回有效结果' : '企微本体来源请求失败', response.status, undefined, response.status >= 500);
  }
  if (!response.ok) {
    const detail = errorDetail(data);
    throw new WecomOntologyApiError(detail.message, response.status, detail.code, detail.retryable || response.status >= 500 || response.status === 408 || response.status === 429);
  }
  return data as T;
}

function snapshotUrl(input: { snapshotId?: string; kind?: WecomSourceRecordKind | null; cursor?: string | null; pageSize?: number }) {
  const query = new URLSearchParams();
  if (input.snapshotId) query.set('snapshotId', input.snapshotId);
  if (input.kind) query.set('kind', input.kind);
  if (input.cursor) query.set('cursor', input.cursor);
  if (input.pageSize) query.set('pageSize', String(input.pageSize));
  const text = query.toString();
  return text ? `${wecomOntologyUrls.snapshot}?${text}` : wecomOntologyUrls.snapshot;
}

function receiptUrl(companyId: string, commandId: string) {
  const query = new URLSearchParams({ companyId, commandId });
  return `/api/ontology/workspace/wecom/receipt?${query.toString()}`;
}

export const wecomOntologyApi = {
  status: (companyId: string, signal?: AbortSignal) => request<WecomStatusResponse>(wecomOntologyUrls.status, companyId, undefined, signal),
  preview: (input: WecomPreviewRequest, signal?: AbortSignal) => request<WecomPreviewResponse>(wecomOntologyUrls.preview, input.companyId, input, signal),
  commit: (input: WecomCommitRequest, signal?: AbortSignal) => request<WecomCommitReceipt>(wecomOntologyUrls.commit, input.companyId, input, signal),
  receipt: (companyId: string, commandId: string, signal?: AbortSignal) => request<WecomReceiptLookupResponse>(receiptUrl(companyId, commandId), companyId, undefined, signal),
  snapshot: (companyId: string, input: { snapshotId?: string; kind?: WecomSourceRecordKind | null; cursor?: string | null; pageSize?: number } = {}, signal?: AbortSignal) => request<WecomSnapshotPage | null>(snapshotUrl(input), companyId, undefined, signal),
};
