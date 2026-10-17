#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/release-gate.yml'), 'utf8');
const match = workflow.match(/<<'STAGING'\n([\s\S]*?)\n {10}STAGING/);
assert.ok(match, 'The staging bootstrap must be an inspectable, source-owned heredoc.');
const bootstrap = match[1].split('\n').map(line => line.startsWith('          ') ? line.slice(10) : line).join('\n') + '\n';
assert.ok(!/reset\s+--hard|switch[^\n]*--force|checkout[^\n]*--force/.test(bootstrap));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kol-staging-bootstrap-'));
const seed = path.join(temp, 'seed');
const bin = path.join(temp, 'bin');
fs.mkdirSync(seed); fs.mkdirSync(bin);
const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
  assert.equal(result.status, 0, `${args.join(' ')}\n${result.stderr}`);
  return result.stdout.trim();
}
function write(file, content, executable = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  if (executable) fs.chmodSync(file, 0o755);
}
function scenario(name) {
  const home = path.join(temp, name); fs.mkdirSync(home);
  const repo = path.join(home, 'kol-e2e');
  git(home, 'clone', '--quiet', seed, repo);
  git(repo, 'remote', 'add', 'github', seed);
  git(repo, 'switch', '--detach', oldRevision);
  return { home, repo, trace: path.join(home, 'trace.txt') };
}
function run(s, revision = newRevision, command = bootstrap) {
  return spawnSync('bash', ['-s'], {
    cwd: s.home, input: command, encoding: 'utf8', timeout: 30_000,
    env: { ...env, HOME: s.home, PATH: `${bin}:${process.env.PATH}`, TRACE_FILE: s.trace,
      E2E_REVISION: revision, E2E_SPECS: 'e2e/source-bound.spec.ts' },
  });
}
try {
  git(seed, 'init', '--quiet');
  git(seed, 'config', 'user.name', 'Bootstrap test');
  git(seed, 'config', 'user.email', 'test@example.invalid');
  write(path.join(seed, 'scripts/server-e2e.sh'), '#!/bin/bash\necho "old bootstrap: Cannot find module backend/scripts/e2e-database.mjs" >&2\nexit 42\n', true);
  write(path.join(seed, 'frontend/.keep'), 'fixture\n');
  git(seed, 'add', '.'); git(seed, 'commit', '--quiet', '-m', 'old bootstrap');
  var oldRevision = git(seed, 'rev-parse', 'HEAD');
  write(path.join(seed, 'scripts/server-e2e.sh'), '#!/bin/bash\nset -euo pipefail\nprintf "script:%s:%s\\n" "$(git rev-parse HEAD)" "$*" >> "$TRACE_FILE"\n', true);
  git(seed, 'add', '.'); git(seed, 'commit', '--quiet', '-m', 'current bootstrap');
  var newRevision = git(seed, 'rev-parse', 'HEAD');
  write(path.join(bin, 'npm'), '#!/bin/bash\nset -euo pipefail\nprintf "npm:%s:%s:%s\\n" "$(git rev-parse HEAD)" "$(basename "$PWD")" "$*" >> "$TRACE_FILE"\n', true);

  const old = scenario('old-negative');
  const oldResult = run(old, newRevision, 'cd ~/kol-e2e\n./scripts/server-e2e.sh --rev "$E2E_REVISION" $E2E_SPECS\n');
  assert.equal(oldResult.status, 42);
  assert.match(oldResult.stderr, /old bootstrap.*Cannot find module/);
  assert.equal(git(old.repo, 'rev-parse', 'HEAD'), oldRevision);
  assert.ok(!fs.existsSync(old.trace));
  console.log('PASS: old bootstrap invoked before source selection is a real negative.');

  const selected = scenario('selected-source');
  const selectedResult = run(selected);
  assert.equal(selectedResult.status, 0, selectedResult.stderr);
  assert.equal(git(selected.repo, 'rev-parse', 'HEAD'), newRevision);
  const lines = fs.readFileSync(selected.trace, 'utf8').trim().split('\n');
  assert.deepEqual(lines, [
    `script:${newRevision}:--rev ${newRevision} e2e/source-bound.spec.ts`,
    `script:${newRevision}:--rev ${newRevision} --no-build --no-schema --config=playwright.runtime.config.ts`,
    `npm:${newRevision}:frontend:run test:e2e:agents`,
  ]);
  console.log('PASS: source selected before interpreting it; all three unchanged test groups use the same revision.');

  const dirty = scenario('dirty-tree');
  const tracked = path.join(dirty.repo, 'frontend/.keep'); fs.appendFileSync(tracked, 'must be preserved\n');
  const dirtyResult = run(dirty);
  assert.notEqual(dirtyResult.status, 0); assert.match(dirtyResult.stderr, /local changes/);
  assert.equal(git(dirty.repo, 'rev-parse', 'HEAD'), oldRevision);
  assert.match(fs.readFileSync(tracked, 'utf8'), /must be preserved/);
  assert.ok(!fs.existsSync(dirty.trace));
  console.log('PASS: dirty tracked staging files block selection and remain intact.');

  const unknown = scenario('unknown-revision');
  assert.notEqual(run(unknown, '0'.repeat(40)).status, 0);
  assert.equal(git(unknown.repo, 'rev-parse', 'HEAD'), oldRevision);
  assert.ok(!fs.existsSync(unknown.trace));
  console.log('PASS: unknown revision cannot execute stale source.');

  const invalid = scenario('invalid-revision');
  assert.notEqual(run(invalid, 'main; unsafe-command').status, 0);
  assert.equal(git(invalid.repo, 'rev-parse', 'HEAD'), oldRevision);
  assert.ok(!fs.existsSync(invalid.trace));
  console.log('PASS: only an exact 40-character source revision is accepted.');
  console.log('5/5 staging bootstrap contracts passed (local disposable Git fixtures, no SSH/production access).');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
