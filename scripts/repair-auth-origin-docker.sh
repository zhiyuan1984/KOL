#!/usr/bin/env bash
# Test-only APP_ORIGIN repair. Preserve the running image and every other service.
set -Eeuo pipefail
ROOT=/mnt/starrywork
ORIGIN=https://dev-lingong.askstarry.com
[[ "${CONFIG_TYPE:-}" == test && -d "$ROOT" && ! -L "$ROOT" ]] || { echo '[FAIL] unexpected environment'; exit 1; }
cd "$ROOT"
command -v docker >/dev/null
command -v python3 >/dev/null
command -v flock >/dev/null
if [[ "$(readlink /proc/$$/fd/9 2>/dev/null || true)" != "$ROOT/.deploy-docker.lock" ]]; then exec 9>"$ROOT/.deploy-docker.lock"; fi
flock -n 9 || { echo '[FAIL] another release is running'; exit 1; }
umask 077
BACKUP="$(mktemp -d "$ROOT/.auth-origin-backup.XXXXXX")"
CID="$(docker compose ps --quiet lingong)"
[[ -n "$CID" && "$CID" != *$'\n'* ]] || { echo '[FAIL] expected exactly one running API'; exit 1; }
docker inspect "$CID" > "$BACKUP/api-before.json"
# The maintenance build is only a carrier for scripts, never the running release.
readarray -t META < <(python3 - "$BACKUP/api-before.json" "$ROOT" <<'PY'
import json, os, re, sys
c=json.load(open(sys.argv[1]))[0]; labels=c['Config'].get('Labels',{})
if c['State']['Status']!='running': raise SystemExit('API is not running')
if labels.get('com.docker.compose.project.working_dir')!=sys.argv[2]: raise SystemExit('Unexpected Compose directory')
image=c['Config']['Image']
m=re.fullmatch(r'registry-vpc\.us-west-1\.aliyuncs\.com/askstarry/lingong:test_(\d+)',image)
if not m: raise SystemExit('Unexpected running image; no configuration changed')
files=labels.get('com.docker.compose.project.config_files','').split(',')
if not files or not files[0]: raise SystemExit('Missing Compose source file')
for f in files:
 if os.path.dirname(os.path.abspath(f))!=sys.argv[2] or os.path.islink(f) or not os.path.isfile(f): raise SystemExit('Unsafe Compose path')
print(image); print(m.group(1)); print(files[0]); print(','.join(files))
PY
)
[[ ${#META[@]} -eq 4 ]] || { echo '[FAIL] invalid runtime metadata'; exit 1; }
export SERVICE_IMAGE="${META[0]}" BUILD_NUMBER="${META[1]}" CONFIG_TYPE=test
SOURCE="${META[2]}"
export COMPOSE_FILE="${META[3]//,/:}"
COMPOSE=(docker compose --project-directory "$ROOT")
"${COMPOSE[@]}" config --format json > "$BACKUP/config-before.json"
python3 - "$BACKUP/config-before.json" "$SERVICE_IMAGE" "$ORIGIN" <<'PY'
import json,sys
c=json.load(open(sys.argv[1])); services=c['services']
for name in ['postgres','redis','lingong','outbox-publisher','execution-worker']:
 if name not in services: raise SystemExit('Missing required service: '+name)
a=services['lingong']; env=a.get('environment',{})
if a.get('image')!=sys.argv[2]: raise SystemExit('Resolved API image differs from running image')
if env.get('APP_ORIGIN') not in [None,'',sys.argv[3]]: raise SystemExit('Existing different origin requires review')
print(json.dumps({'check':'preflight','image_preserved':a['image'],'old_origin':env.get('APP_ORIGIN',''),'new_origin':sys.argv[3],'services':sorted(services)}))
PY
"${COMPOSE[@]}" ps --all --quiet > "$BACKUP/container-ids-before.txt"
while IFS= read -r id; do docker inspect "$id"; done < "$BACKUP/container-ids-before.txt" > "$BACKUP/containers-before.jsonl"
# Ensure the current runtime supports the exact configured-origin guard.
docker exec "$CID" node -e '
const fs=require("node:fs"); const s=fs.readFileSync("/app/backend/src/auth.ts","utf8");
if(!s.includes("process.env.APP_ORIGIN || process.env.CORS_ORIGIN") || !s.includes("cross-origin mutation rejected") || !s.includes("startsWith(\"https://\")")) throw Error("Unexpected auth implementation");
require("/app/backend/node_modules/yaml"); console.log("[PASS] explicit origin guard and Secure cookie path present");'
cp -p -- "$SOURCE" "$BACKUP/compose-original.yml"
sha256sum "$SOURCE" > "$BACKUP/source-before.sha256"
# ParseDocument preserves comments and existing YAML rather than rebuilding it.
docker exec -i -w /app/backend "$CID" node -e '
const fs=require("node:fs"), Y=require("yaml"); const doc=Y.parseDocument(fs.readFileSync(0,"utf8"));
if(doc.errors.length) throw doc.errors[0];
const a=doc.getIn(["services","lingong"]); if(!Y.isMap(a)) throw Error("Missing API mapping");
const e=doc.getIn(["services","lingong","environment"]); if(e && !Y.isMap(e)) throw Error("Environment is not a mapping");
doc.setIn(["services","lingong","environment","APP_ORIGIN"],"https://dev-lingong.askstarry.com");
process.stdout.write(String(doc));' < "$SOURCE" > "$BACKUP/compose-repaired.yml"
CHANGED=0
VERIFIED=0
NEW_HASH="$(sha256sum "$BACKUP/compose-repaired.yml" | cut -d' ' -f1)"
cleanup() {
  rc=$?
  trap - EXIT
  if [[ "$CHANGED" == 1 && "$VERIFIED" != 1 ]]; then
    echo '[ROLLBACK] restoring only the API origin configuration'
    if [[ "$(sha256sum "$SOURCE" | cut -d' ' -f1)" == "$NEW_HASH" ]]; then
      cp -p -- "$BACKUP/compose-original.yml" "$SOURCE"
      "${COMPOSE[@]}" up -d --no-deps --no-build --pull never lingong > "$BACKUP/rollback.log" 2>&1 || echo '[FAIL] API rollback needs operator review'
    else
      echo '[FAIL] source changed by another actor; refusing to overwrite it'
    fi
  fi
  echo "[EVIDENCE] private backup: $BACKUP"
  exit "$rc"
}
trap cleanup EXIT
# Preserve ownership, mode and all non-origin YAML settings.
python3 - "$SOURCE" "$BACKUP/compose-repaired.yml" <<'PY'
import os,stat,sys,tempfile
source,new=sys.argv[1:]; s=os.stat(source)
fd,tmp=tempfile.mkstemp(prefix='.auth-origin-install.',dir=os.path.dirname(source))
try:
 with os.fdopen(fd,'wb') as f:
  f.write(open(new,'rb').read()); f.flush(); os.fsync(f.fileno())
 os.chmod(tmp,stat.S_IMODE(s.st_mode)); os.chown(tmp,s.st_uid,s.st_gid); os.replace(tmp,source)
finally:
 if os.path.exists(tmp): os.unlink(tmp)
PY
CHANGED=1
"${COMPOSE[@]}" config --format json > "$BACKUP/config-after.json"
python3 - "$BACKUP/config-before.json" "$BACKUP/config-after.json" "$ORIGIN" <<'PY'
import json,sys
before=json.load(open(sys.argv[1])); after=json.load(open(sys.argv[2]))
before['services']['lingong'].setdefault('environment',{})['APP_ORIGIN']=sys.argv[3]
if before!=after: raise SystemExit('Change extends beyond APP_ORIGIN; rollback required')
print('[PASS] resolved Compose differs only in lingong.environment.APP_ORIGIN')
PY
"${COMPOSE[@]}" up -d --no-deps --no-build --pull never lingong > "$BACKUP/api-recreate.log" 2>&1
READY=0
for attempt in $(seq 1 60); do
  CURRENT="$("${COMPOSE[@]}" ps --quiet lingong)"
  if [[ -n "$CURRENT" ]] && docker exec "$CURRENT" node --input-type=module -e '
const r=await fetch("http://127.0.0.1:8765/api/health",{signal:AbortSignal.timeout(3000)}); const h=await r.json();
if(!r.ok || h.ok!==true || h.runtime_mode!=="postgres-native" || h.authority_store!=="postgresql" || h.compat_bridge!==false) process.exit(1);
' >/dev/null 2>&1; then READY=1; break; fi
  sleep 2
done
[[ "$READY" == 1 ]] || { echo '[FAIL] API health not ready'; exit 1; }
docker inspect "$CURRENT" > "$BACKUP/api-after.json"
python3 - "$BACKUP/api-before.json" "$BACKUP/api-after.json" "$ORIGIN" <<'PY'
import json,sys
b=json.load(open(sys.argv[1]))[0]; a=json.load(open(sys.argv[2]))[0]
e=dict(x.split('=',1) for x in a['Config']['Env'] if '=' in x)
if a['Image']!=b['Image']: raise SystemExit('API image digest changed')
if e.get('APP_ORIGIN')!=sys.argv[3]: raise SystemExit('Runtime origin not applied')
print('[PASS] exact running image digest preserved; APP_ORIGIN applied')
PY
docker exec -i "$CURRENT" node --input-type=module - <<'JS'
for(const [origin,expected] of [
 ['https://dev-lingong.askstarry.com',401],
 ['http://dev-lingong.askstarry.com',403],
 ['https://dev-lingong.askstarry.com:444',403],
 ['https://untrusted.invalid',403],
 ['null',403]
]) {
 const r=await fetch('http://127.0.0.1:8765/api/auth/password',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(5000)});
 const text=await r.text();
 console.log(JSON.stringify({check:'origin-boundary',origin,status:r.status,expected}));
 if(r.status!==expected || (expected===403 && !text.includes('cross-origin mutation rejected'))) throw Error('Origin boundary failed');
}
const r=await fetch('http://127.0.0.1:8765/api/auth/status',{signal:AbortSignal.timeout(5000)});
const s=await r.json(); if(!r.ok || s.authenticated!==false) throw Error('Unexpected anonymous auth status');
console.log(JSON.stringify({check:'anonymous-auth-status',setup_required:s.setup_required,authenticated:s.authenticated}));
JS
# Require every non-API container to remain the exact same running instance.
python3 - "$BACKUP/containers-before.jsonl" <<'PY' > "$BACKUP/other-container-ids.txt"
import json,sys
s=open(sys.argv[1]).read(); d=json.JSONDecoder(); i=0
while i<len(s):
 while i<len(s) and s[i].isspace(): i+=1
 if i==len(s): break
 arr,n=d.raw_decode(s,i); i=n
 for c in arr:
  if c['Config'].get('Labels',{}).get('com.docker.compose.service')!='lingong': print(c['Id'])
PY
while IFS= read -r id; do
  [[ "$(docker inspect --format '{{.State.Status}}' "$id")" == running ]] || { echo '[FAIL] unrelated container changed state'; exit 1; }
done < "$BACKUP/other-container-ids.txt"
VERIFIED=1
printf '[SUCCESS] HTTPS origin repaired; exact API image preserved; other containers retained; database and volumes untouched.\n'
