#!/usr/bin/env bash
# Codeup/Flow Docker adapter. Existing deploy.sh remains the native systemd entry.
# Run on the authorized test host after extracting /app/scripts from SERVICE_IMAGE.
set -Eeuo pipefail

DEPLOY_DIR="${1:-/mnt/starrywork}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
: "${SERVICE_IMAGE:?SERVICE_IMAGE is required}"
: "${CONFIG_TYPE:?CONFIG_TYPE is required}"
: "${BUILD_NUMBER:?BUILD_NUMBER is required}"
[[ "$CONFIG_TYPE" == "test" ]] || { echo '[FAIL] This adapter is restricted to the test environment' >&2; exit 1; }
[[ "$DEPLOY_DIR" == "/mnt/starrywork" ]] || { echo '[FAIL] Unexpected deployment directory' >&2; exit 1; }
cd "$DEPLOY_DIR"
command -v docker >/dev/null
command -v flock >/dev/null
exec 9>"$DEPLOY_DIR/.deploy-docker.lock"
flock -n 9 || { echo '[FAIL] Another Docker release holds the deployment lock' >&2; exit 1; }
COMPOSE=(docker compose --project-directory "$DEPLOY_DIR")

redact_logs() {
  sed -E "s#postgres(ql)?://[^[:space:]\"'<>]+#postgresql://[REDACTED]#g; s#((PASSWORD|TOKEN|SECRET|API_KEY|DATABASE_URL)[[:space:]]*[=:][[:space:]]*)[^[:space:]]+#\\1[REDACTED]#gI"
}
failed() {
  local rc="$1"
  trap - ERR
  set +e
  echo "[FAIL] Docker release failed (exit $rc). Existing data volumes are retained." >&2
  "${COMPOSE[@]}" ps -a
  "${COMPOSE[@]}" logs --no-color --tail=100 postgres redis lingong outbox-publisher execution-worker 2>&1 | redact_logs
  exit "$rc"
}
trap 'failed "$?"' ERR

# Validate only non-secret deployment facts. Never print the resolved environment.
# The trusted application image parses the config over stdin without network access.
"${COMPOSE[@]}" config --format json | docker run --rm -i --network none \
  -e "EXPECTED_IMAGE=$SERVICE_IMAGE" --entrypoint node "$SERVICE_IMAGE" -e '
  let text=""; process.stdin.setEncoding("utf8");
  process.stdin.on("data", chunk=>text+=chunk);
  process.stdin.on("end", ()=>{
    const config=JSON.parse(text); const services=config.services||{};
    const required=["postgres","redis","lingong","outbox-publisher","execution-worker"];
    for(const name of required) if(!services[name]) throw new Error("Missing Compose service: "+name);
    for(const name of ["lingong","outbox-publisher","execution-worker"])
      if(services[name].image!==process.env.EXPECTED_IMAGE) throw new Error("Compose image does not match this release: "+name);
    const env=services.postgres.environment||{};
    if(!env.POSTGRES_PASSWORD) throw new Error("POSTGRES_PASSWORD is empty; existing volumes were not removed");
    for(const name of ["lingong","outbox-publisher","execution-worker"])
      if(!services[name].environment?.DATABASE_URL) throw new Error("Missing DATABASE_URL for "+name);
    console.log(JSON.stringify({check:"compose-config",required_services:required,postgres_image:services.postgres.image,postgres_password_present:true,release_images_match:true}));
  });'

# Preserve the PG major version, existing named volumes and Redis persistence.
# Readiness failure emits the actual container logs and prevents app initialization.
echo '[STEP] Wait for PostgreSQL and Redis health'
"${COMPOSE[@]}" up -d --wait --wait-timeout 120 postgres redis

# Compose injects the resolved DATABASE_URL/REDIS_URL into this disposable role.
# apply-postgres-schema.sh requires /app/.env to exist but preserves injected vars;
# the empty marker contains no secrets and exists only in the disposable container.
echo '[STEP] Apply native PostgreSQL schema and idempotent reference seed'
"${COMPOSE[@]}" run --rm --no-deps --entrypoint bash lingong -c '
  set -euo pipefail
  cd /app
  : "${DATABASE_URL:?DATABASE_URL is required}"
  test -r /app/scripts/apply-postgres-schema.sh
  test -r /app/scripts/check-production-health.mjs
  if [ ! -f /app/.env ]; then umask 077; touch /app/.env; fi
  bash /app/scripts/apply-postgres-schema.sh
  cd /app/backend
  npm run db:seed:reference
'

echo '[STEP] Start API, Outbox and Execution Worker with this release image'
"${COMPOSE[@]}" up -d --wait --wait-timeout 120 lingong outbox-publisher execution-worker

# HTTP success alone, HTML/login pages and a live process are not readiness.
# Reuse the repository strict PG-native + real Codex health contract inside API.
echo '[STEP] Verify strict PG-native application health'
healthy=0
for attempt in $(seq 1 60); do
  if "${COMPOSE[@]}" exec -T lingong bash -o pipefail -c '
    node --input-type=module -e '\''
      const port=process.env.LINGONG_PORT||"8765";
      const response=await fetch("http://127.0.0.1:"+port+"/api/health", {signal:AbortSignal.timeout(3000)});
      if(!response.ok) process.exit(1);
      process.stdout.write(await response.text());
    '\'' | node /app/scripts/check-production-health.mjs
  ' >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 2
done
[[ "$healthy" == "1" ]] || { echo '[FAIL] Strict application health did not become ready' >&2; false; }

# Reject workers that exit immediately; no queued/business action is generated here.
sleep 3
for service in lingong outbox-publisher execution-worker; do
  container_id="$("${COMPOSE[@]}" ps --all --quiet "$service")"
  [[ -n "$container_id" ]] || { echo "[FAIL] Missing runtime container: $service" >&2; false; }
  while IFS= read -r id; do
    [[ "$(docker inspect --format '{{.State.Status}}' "$id")" == 'running' ]] \
      || { echo "[FAIL] Runtime container is not running: $service" >&2; false; }
  done <<< "$container_id"
done
"${COMPOSE[@]}" ps -a
echo '[SUCCESS] PostgreSQL/Redis ready; schema and seed completed; API strict health passed; API/Outbox/Execution containers running.'
echo '[SCOPE] This Docker release does not claim Cron activation or business-job acceptance.'
