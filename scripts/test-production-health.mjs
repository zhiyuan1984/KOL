import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isProductionHealthReady } from './check-production-health.mjs';

const ready = { ok: true, database_ready: true, runtime_mode: 'postgres-native', authority_store: 'postgresql', storage_adapter: 'pg-native', compat_bridge: false, codex_mode: 'real', codex_bin_ok: true, codex_stub_allowed: false };
assert.equal(isProductionHealthReady(ready), true);
const bad = [null, [], {}, { ...ready, ok: false }, { ...ready, database_ready: false }, { ...ready, runtime_mode: 'postgres-only' }, { ...ready, authority_store: 'sqlite' }, { ...ready, storage_adapter: 'compat' }, { ...ready, compat_bridge: true }, { ...ready, codex_mode: 'stub' }, { ...ready, codex_bin_ok: false }, { ...ready, codex_stub_allowed: true }];
for (const value of bad) assert.equal(isProductionHealthReady(value), false, JSON.stringify(value));
const script = fileURLToPath(new URL('./check-production-health.mjs', import.meta.url));
for (const [input, expected] of [[JSON.stringify(ready), 0], ['<html>login</html>', 1], ['{"ok":true}', 1], ['', 1]]) {
  assert.equal(spawnSync(process.execPath, [script], { input, encoding: 'utf8' }).status, expected);
}
console.log('production_health_contract: 1 native-ready + 12 fail-closed + 4 CLI cases passed');
