import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frontend = path.join(root, 'frontend');
const configUrl = pathToFileURL(path.join(frontend, 'playwright.native-knowledge.config.ts')).href;
const cases = [
  { name: 'default output root', env: {}, expected: path.join(frontend, 'test-results-native-knowledge', 'data') },
  { name: 'relative output root', env: { PLAYWRIGHT_OUTPUT_DIR: 'native-config-relative-results' }, expected: path.join(frontend, 'native-config-relative-results', 'data') },
  { name: 'explicit absolute data root', env: { LINGONG_DATA: path.join(root, 'native-config-explicit-data') }, expected: path.join(root, 'native-config-explicit-data') },
  { name: 'explicit relative data root', env: { LINGONG_DATA: 'native-config-relative-data' }, expected: path.join(frontend, 'native-config-relative-data') },
];
const code = `
  const { default: config } = await import(${JSON.stringify(configUrl)});
  console.log(JSON.stringify({
    workerData: process.env.LINGONG_DATA,
    serverData: config.webServer.env.LINGONG_DATA,
    auth: config.webServer.env.E2E_AUTH_MODE,
    workers: config.workers,
    retries: config.retries,
    sourceEvidenceFixture: process.env.CODEX_BIN
  }));
`;
for (const item of cases) {
  const env = { ...process.env };
  for (const key of ['LINGONG_DATA', 'PLAYWRIGHT_OUTPUT_DIR', 'E2E_AUTH_STATE', 'E2E_REVIEWER_AUTH_STATE', 'CODEX_BIN']) delete env[key];
  Object.assign(env, { NODE_ENV: 'test', E2E_MODE: 'stub', E2E_AUTH_MODE: 'enabled', ...item.env });
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', code], { cwd: frontend, env, encoding: 'utf8' });
  assert.equal(result.status, 0, `${item.name}: config load failed: ${result.stderr}`);
  const value = JSON.parse(result.stdout.trim());
  assert.equal(value.workerData, item.expected, `${item.name}: worker must use the canonical data root`);
  assert.equal(value.serverData, item.expected, `${item.name}: API must share that same root`);
  assert.equal(path.isAbsolute(value.workerData), true);
  assert.equal(value.auth, 'enabled', 'normal login must remain mandatory');
  assert.equal(value.workers, 1);
  assert.equal(value.retries, 0, 'configuration fixes must not hide failures via retries');
  assert.equal(value.sourceEvidenceFixture, path.join(root, 'backend', 'tests', 'support', 'source-evidence-codex-fixture.mjs'));
  console.log(`PASS ${item.name}`);
}
console.log('Native knowledge configuration: 4 passed, 0 failed. No API or business writes.');
