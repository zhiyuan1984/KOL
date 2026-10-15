import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Current production is native PostgreSQL; a 200/HTML response is not health. */
export function isProductionHealthReady(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && value.ok === true
    && value.database_ready === true
    && value.runtime_mode === 'postgres-native'
    && value.authority_store === 'postgresql'
    && value.storage_adapter === 'pg-native'
    && value.compat_bridge === false
    && value.codex_mode === 'real'
    && value.codex_bin_ok === true
    && value.codex_stub_allowed === false);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const value = JSON.parse(readFileSync(0, 'utf8'));
    process.exitCode = isProductionHealthReady(value) ? 0 : 1;
  } catch {
    process.exitCode = 1;
  }
}
