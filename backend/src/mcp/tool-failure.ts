import type { Json } from '../types.js';

/** Bounded metadata only. Arbitrary provider text never becomes a public error. */
export function remoteBusinessCode(value: unknown): string | undefined {
  const queue: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  for (let visited = 0; queue.length && visited < 24; visited++) {
    const item = queue.shift()!;
    if (item.depth > 4) continue;
    if (typeof item.value === 'string') {
      if (item.value.length > 8192) continue;
      try { queue.push({ value: JSON.parse(item.value), depth: item.depth + 1 }); } catch { /* not JSON */ }
      continue;
    }
    if (Array.isArray(item.value)) {
      for (const value of item.value.slice(0, 8)) queue.push({ value, depth: item.depth + 1 });
      continue;
    }
    if (!item.value || typeof item.value !== 'object') continue;
    const row = item.value as Json;
    for (const key of ['code', 'errCode', 'errorCode']) {
      const code = row[key];
      if (['0', '200', 'success', 'ok'].includes(String(code).toLowerCase())) continue;
      if ((typeof code === 'string' || typeof code === 'number') && (/^\d{1,20}$/.test(String(code)) || ['starrykol_login_required', 'starrykol_api_key_required', 'success', 'ok'].includes(String(code)))) return String(code);
    }
    // Recognize reviewed authentication messages, not arbitrary provider prose.
    const message = typeof row.message === 'string' ? row.message : typeof row.text === 'string' ? row.text : '';
    if (/登录过期|请先登录/.test(message)) return 'starrykol_login_required';
    if (/Invalid or missing X-MCP-API-KEY/.test(message)) return 'starrykol_api_key_required';
    for (const key of ['data', 'result', 'error', 'text', 'content']) {
      if (row[key] !== undefined) queue.push({ value: row[key], depth: item.depth + 1 });
    }
  }
  return undefined;
}

export class RemoteToolFailure extends Error {
  readonly upstreamCode?: string;
  constructor(value: unknown) {
    const code = remoteBusinessCode(value);
    super(code === '10141103' || code === 'starrykol_login_required' ? '登录过期，请先登录'
      : code === 'starrykol_api_key_required' ? 'Invalid or missing X-MCP-API-KEY' : 'remote MCP tool failed');
    this.name = 'RemoteToolFailure';
    this.upstreamCode = code;
  }
}

/** An explicit rejection always wins over a nested successful-looking list. */
export function explicitRemoteRejection(value: Json): boolean {
  const queue: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  for (let visited = 0; queue.length && visited < 24; visited++) {
    const item = queue.shift()!;
    if (item.depth > 4) continue;
    if (typeof item.value === 'string' && item.value.length <= 8192) {
      try { queue.push({ value: JSON.parse(item.value), depth: item.depth + 1 }); } catch { /* not JSON */ }
      continue;
    }
    if (!item.value || typeof item.value !== 'object' || Array.isArray(item.value)) continue;
    const row = item.value as Json;
    if (row.isError === true || row.success === false || row.ok === false) return true;
    for (const key of ['code', 'errCode', 'errorCode']) {
      const code = row[key];
      if ((typeof code === 'string' || typeof code === 'number') && !['0', '200', 'success', 'ok'].includes(String(code).toLowerCase())) return true;
    }
    for (const key of ['data', 'result', 'error']) if (row[key] !== undefined) queue.push({ value: row[key], depth: item.depth + 1 });
  }
  return false;
}
