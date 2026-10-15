import os
import pathlib
import subprocess
import tempfile
import unittest

SOURCE = str(pathlib.Path(__file__).with_name('release-verified.sh'))
BASE = 'a' * 40
TARGET = 'b' * 40

class VerifiedRelease(unittest.TestCase):
    def run_case(self, scenario):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            (root / '.git').mkdir()
            (root / 'scripts').mkdir()
            (root / 'bin').mkdir()
            (root / 'operator-evidence.txt').write_text('do not discard\n')
            for name in ['apply-postgres-schema.sh', 'deploy.sh']:
                (root / 'scripts' / name).write_text(f'#!/bin/bash\necho {name} >> "$EVENTS"\n')
            mock = '''#!/usr/bin/env python3
import os,sys,pathlib
cmd=pathlib.Path(sys.argv[0]).name
args=sys.argv[1:]
root=pathlib.Path(os.environ['LINGONG_RELEASE_ROOT'])
scenario=os.environ['SCENARIO']
def event(s):
 with open(os.environ['EVENTS'],'a') as f:f.write(s+'\\n')
if cmd=='git':
 if args[0]=='diff':sys.exit(1 if scenario=='dirty' else 0)
 if args[:2]==['rev-parse','--path-format=absolute']:print(root/'.git')
 elif args[:2]==['rev-parse','--short']:print('bbbbbbbb')
 elif args[0]=='rev-parse':print(os.environ['TARGET'] if (root/'merged').exists() else os.environ['BASE'])
 elif args[0]=='fetch':event('fetch')
 elif args[0]=='merge-base':sys.exit(1 if scenario=='divergent' else 0)
 elif args[0]=='merge':
  assert args[1]=='--ff-only'
  event('fast-forward');(root/'merged').touch()
 elif args[0]=='status':print('?? operator-evidence.txt')
else:
 if cmd=='node':print('postgresql://fake:fake@127.0.0.1/fake' if '--input-type=module' in args else 'bbbbbbbb',end='')
 elif cmd=='pg_dump':
  event('pg_dump')
  if scenario=='backup-fails':sys.exit(1)
  pathlib.Path(next(x.split('=',1)[1] for x in args if x.startswith('--file='))).write_text('mock custom dump')
 elif cmd=='pg_restore':event('pg_restore');print('verified mock TOC')
 elif cmd=='curl':print('{"version":"bbbbbbbb","ok":true}')
'''
            for cmd in ['git', 'node', 'pg_dump', 'pg_restore', 'curl']:
                path = root / 'bin' / cmd
                path.write_text(mock)
                path.chmod(0o755)
            env = {**os.environ, 'PATH': f'{root}/bin:{os.environ["PATH"]}',
                   'LINGONG_RELEASE_ROOT': str(root), 'DEPLOY_REVISION': TARGET,
                   'LINGONG_RELEASE_BACKUP_DIR': str(root / 'backups'),
                   'EVENTS': str(root / 'events'), 'SCENARIO': scenario,
                   'BASE': BASE, 'TARGET': TARGET}
            run = subprocess.run(['bash', SOURCE], env=env, capture_output=True, text=True)
            events = (root / 'events').read_text().splitlines() if (root / 'events').exists() else []
            self.assertEqual((root / 'operator-evidence.txt').read_text(), 'do not discard\n')
            return run.returncode, events, run.stderr

    def test_dirty_checkout_has_no_backup_merge_or_deploy(self):
        code, events, _ = self.run_case('dirty')
        self.assertNotEqual(code, 0)
        self.assertEqual(events, [])

    def test_divergence_never_overwrites_history(self):
        code, events, _ = self.run_case('divergent')
        self.assertNotEqual(code, 0)
        self.assertEqual(events, ['fetch'])

    def test_backup_failure_precedes_any_code_or_schema_change(self):
        code, events, _ = self.run_case('backup-fails')
        self.assertNotEqual(code, 0)
        self.assertEqual(events, ['fetch', 'pg_dump'])

    def test_success_preserves_evidence_and_backup_order(self):
        code, events, stderr = self.run_case('success')
        self.assertEqual(code, 0, stderr)
        self.assertEqual(events, ['fetch', 'pg_dump', 'pg_restore', 'fast-forward', 'apply-postgres-schema.sh', 'deploy.sh'])

if __name__ == '__main__':
    unittest.main(verbosity=2)
