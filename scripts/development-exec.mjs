#!/usr/bin/env node
/** Supply verified route/skill contents to a real stdin-capable development CLI. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');
const hash = data => createHash('sha256').update(data).digest('hex');
const argv = process.argv.slice(2);
if (argv.includes('--help') || !argv.length) {
  console.log('Usage: node scripts/development-exec.mjs --task-id ID --intent TEXT [--path PATH ...] --out DIR -- <CLI> <args ...>');
  console.log('Example: ... -- codex exec -   (verified instructions are provided through stdin)');
  process.exit(0);
}
const boundary = argv.indexOf('--');
if (boundary < 0 || !argv[boundary + 1]) throw new Error('Explicit development CLI and argument separator -- are required');
const preflightArgs = argv.slice(0, boundary);
const command = argv[boundary + 1], commandArgs = argv.slice(boundary + 2);
const outIndex = preflightArgs.indexOf('--out');
if (outIndex < 0 || !preflightArgs[outIndex + 1]) throw new Error('--out is required');
const out = path.resolve(preflightArgs[outIndex + 1]);
const preflight = spawnSync(process.execPath, [path.join(scriptDir, 'development-preflight.mjs'), ...preflightArgs], { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
if (preflight.status !== 0) {
  process.stderr.write(preflight.stderr || 'preflight failed\n');
  process.exit(preflight.status || 1);
}
const contractBytes = fs.readFileSync(path.join(out, 'task-contract.json'));
const contract = JSON.parse(contractBytes);
const bundle = JSON.parse(fs.readFileSync(path.join(out, 'loading-bundle.json')));
if (bundle.task_contract.sha256 !== hash(contractBytes)) throw new Error('Loading bundle task contract hash mismatch');
for (const file of bundle.files) {
  const filePath = path.resolve(root, file.path);
  if (!filePath.startsWith(root + path.sep)) throw new Error('Source escapes repository');
  if (hash(fs.readFileSync(filePath)) !== file.sha256 || hash(file.content) !== file.sha256) throw new Error(`Source changed before CLI dispatch: ${file.path}`);
}
const prompt = [
  '# 受治理开发任务',
  '以下为开工执行器实际加载的规则、技能与构造模板；先依任务契约逐项构造，再按相同契约验收。',
  '加载记录不证明专家判断已发生，模板草案不证明实现或生产验收通过。不要自行扩大权限、改变深链或代人核对审批发布。',
  '\n## 任务契约\n' + JSON.stringify(contract, null, 2),
  ...bundle.files.map(file => `\n## 已加载文件：${file.path} (sha256:${file.sha256})\n${file.content}`),
  '\n## 执行与交接\n完成后按开发任务契约提交设计、源码、测试日志与未验证事项；缺必需证据时明确未通过。'
].join('\n');
fs.writeFileSync(path.join(out, 'entry-prompt.md'), prompt + '\n', { mode: 0o600 });
const started = new Date().toISOString();
const result = spawnSync(command, commandArgs, { cwd: root, input: prompt + '\n', encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
fs.writeFileSync(path.join(out, 'entry-stdout.log'), result.stdout || '', { mode: 0o600 });
fs.writeFileSync(path.join(out, 'entry-stderr.log'), result.stderr || '', { mode: 0o600 });
const receipt = {
  schema_version: 1, task_id: contract.task.id,
  command, args: commandArgs, started_at: started, finished_at: new Date().toISOString(),
  task_contract_sha256: hash(contractBytes), supplied_prompt_sha256: hash(prompt + '\n'),
  supplied_files: bundle.files.map(({ path, sha256 }) => ({ path, sha256 })),
  exit_code: result.status, signal: result.signal || null, error: result.error?.message || null,
  scope: 'CLI stdin delivery only; does not prove the model used a skill or completed implementation/UX review'
};
fs.writeFileSync(path.join(out, 'entry-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
if (result.error) process.stderr.write(result.error.message + '\n');
process.exit(result.status ?? 1);
