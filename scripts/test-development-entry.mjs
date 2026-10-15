#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kol-development-entry-'));
const wrapper = path.join(root, 'scripts/development-exec.mjs');
const run = (name, intent, changedPath, code) => spawnSync(process.execPath, [wrapper,
  '--task-id', name, '--intent', intent, '--path', changedPath, '--out', path.join(temp, name),
  '--', process.execPath, '-e', code,
], { cwd: root, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
try {
  const passed = run('passed', 'knowledge UI async document navigation', 'frontend/src/admin/knowledge/DocumentRail.tsx',
    `let input='';process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>{for(const term of ['# 受治理开发任务','ux-task-and-state-design','information-architecture-navigation','async-job-observability','document-fidelity-viewing','templates/layout-contract.json'])if(!input.includes(term))process.exit(2);console.log('verified full skill input received')})`);
  assert.equal(passed.status, 0, passed.stderr);
  const receipt = JSON.parse(fs.readFileSync(path.join(temp, 'passed', 'entry-receipt.json')));
  assert.equal(receipt.exit_code, 0);
  assert.ok(receipt.supplied_files.some(file => file.path.includes('/async-job-observability/SKILL.md')));
  assert.ok(fs.statSync(path.join(temp, 'passed', 'entry-prompt.md')).size > 1000);
  const failed = run('cli-failed', 'backend', 'backend/src/health.ts', 'process.exit(7)');
  assert.equal(failed.status, 7);
  assert.equal(JSON.parse(fs.readFileSync(path.join(temp, 'cli-failed', 'entry-receipt.json'))).exit_code, 7);
  const marker = path.join(temp, 'not-authorized-marker');
  const invalid = run('invalid-path', 'backend', '../outside', `require('node:fs').writeFileSync(${JSON.stringify(marker)},'bad')`);
  assert.notEqual(invalid.status, 0);
  assert.equal(fs.existsSync(marker), false);
  console.log('development entry tests passed: actual stdin skill delivery, failed CLI receipt, preflight rejection before dispatch');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
