#!/usr/bin/env python3
"""仅替换前端静态资源；不变更生产Git工作区、后端或服务。"""
import hashlib
import json
import os
import shutil
import subprocess
import tarfile
import tempfile
from pathlib import Path

ROOT = Path('/home/ecs-user/kol')
RELEASE = ROOT / 'backups/frontend-cta-90bd7b06-20261009'
DIST = ROOT / 'frontend/dist'
EXPECTED_HEAD = '318e5ad6b672a024a0e2c0fe2955636495e479fc'
EXPECTED_PATCH = '3c40f76e0a68ef1d50d669def33d0ddcdae80a918e23dac42e2a78dd419a1c33'
EXPECTED_OLD_INDEX = 'eddf39e164c8b4b76f4884e7dc7d9e4c59efc44ddac24d3e9f88b57c6b94ed94'
EXPECTED_PACKAGE = 'd6e49a3165053d4cf1b1774163dcc525150050cf049566b9c2f96ed907906833'

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)

def verify_baseline():
    assert git('rev-parse', 'HEAD').decode().strip() == EXPECTED_HEAD, '生产HEAD发生变化，停止发布'
    assert hashlib.sha256(git('diff', '--binary', '--', 'frontend')).hexdigest() == EXPECTED_PATCH, '生产前端源码发生变化，停止发布'
    assert digest(DIST / 'index.html') == EXPECTED_OLD_INDEX, '生产入口已被其他任务更新，停止发布'

verify_baseline()
package = RELEASE / 'frontend-release-90bd7b06.tar.gz'
assert digest(package) == EXPECTED_PACKAGE, '发布包校验失败'
staging = RELEASE / 'staging'
assert not staging.exists(), '隔离解包目录已存在，停止避免覆盖'
staging.mkdir()
with tarfile.open(package, 'r:gz') as tar:
    for member in tar.getmembers():
        p = Path(member.name)
        assert not p.is_absolute() and '..' not in p.parts and (member.isfile() or member.isdir()), '不安全的发布包条目'
    tar.extractall(staging, filter='data')
manifest = json.loads((RELEASE / 'asset-manifest.json').read_text())
assert {str(p.relative_to(staging)) for p in staging.rglob('*') if p.is_file()} == set(manifest), '发布文件集合不一致'
for name, expected in manifest.items():
    assert digest(staging / name) == expected, f'发布文件校验失败：{name}'
print(f'发布包及{len(manifest)}个静态文件验证通过', flush=True)
backup = RELEASE / 'previous-dist'
assert not backup.exists(), '备份目录已存在，停止避免覆盖'
shutil.copytree(DIST, backup)
print('完整旧静态资源已备份', flush=True)
verify_baseline()

def replace_file(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.cta-release-', dir=target.parent)
    os.close(fd)
    try:
        shutil.copyfile(source, temporary)
        os.chmod(temporary, 0o644)
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

# 先写入全部新哈希资源，保留旧资源；旧页面在入口切换前后都能加载原资源。
for name in manifest:
    if name != 'index.html':
        replace_file(staging / name, DIST / name)
        assert digest(DIST / name) == manifest[name]
verify_baseline()
replace_file(staging / 'index.html', DIST / 'index.html')
assert digest(DIST / 'index.html') == manifest['index.html']
record = {
    'frontend_revision': '90bd7b060185b9c9d811481e2e5cbb4d98d69e22',
    'production_source_head_unchanged': EXPECTED_HEAD,
    'knowledge_patch_sha256': EXPECTED_PATCH,
    'package_sha256': EXPECTED_PACKAGE,
    'index_sha256': manifest['index.html'],
    'asset_count': len(manifest),
    'backup': str(backup),
    'mode': 'frontend-static-only-no-service-restart',
}
(RELEASE / 'release-record.json').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(record, ensure_ascii=False), flush=True)
