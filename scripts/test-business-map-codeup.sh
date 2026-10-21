#!/usr/bin/env bash
# Business-map-only verification. Never use the deployed application's database.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPORT_DIR="$ROOT/.business-map-ci"
mkdir -p "$REPORT_DIR"
PG_VERSION=''
cleanup() {
  if [[ -n "$PG_VERSION" ]]; then pg_ctlcluster "$PG_VERSION" main stop >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

if [[ "${BUSINESS_MAP_CI_BOOTSTRAP:-0}" == '1' ]]; then
  # Disposable PostgreSQL inside the CI build container only. These are not
  # credentials for any application, developer, test-host or production service.
  PG_VERSION="$(pg_lsclusters --no-header | awk 'NR==1 {print $1}')"
  [[ -n "$PG_VERSION" ]] || { echo '[FAIL] CI PostgreSQL is not installed'; exit 1; }
  pg_ctlcluster "$PG_VERSION" main start
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c "ALTER USER postgres PASSWORD 'business_map_disposable_ci_only'" >/dev/null
  export TEST_DATABASE_URL='postgresql://postgres:business_map_disposable_ci_only@127.0.0.1:5432/postgres'
fi
: "${TEST_DATABASE_URL:?A dedicated localhost test database is required}"
node -e 'const u=new URL(process.env.TEST_DATABASE_URL);if(!["127.0.0.1","localhost","[::1]"].includes(u.hostname))throw new Error("CI tests require a dedicated localhost database")'
export TEST_DB_TEMPLATE=template0
export PW_EXECUTABLE_PATH="${PW_EXECUTABLE_PATH:-/usr/bin/chromium}"

cd "$ROOT/backend"
echo '[TEST] Business-map backend typecheck and scoped PostgreSQL tests'
npm run typecheck
mapfile -t TEST_FILES < <(find tests -maxdepth 1 -type f -name 'business-map*.test.ts' | sort)
[[ ${#TEST_FILES[@]} -gt 0 ]] || { echo '[FAIL] No business-map backend tests'; exit 1; }
for test_file in "${TEST_FILES[@]}"; do
  report_name="$(basename "$test_file" .ts)"
  if [[ "$test_file" == *postgres* ]]; then
    npm test -- "$test_file" --maxWorkers=1 --no-file-parallelism --reporter=json --outputFile="$REPORT_DIR/backend-$report_name.json"
  else
    ./node_modules/.bin/vitest run "$test_file" --maxWorkers=1 --no-file-parallelism --reporter=json --outputFile="$REPORT_DIR/backend-$report_name.json"
  fi
done

cd "$ROOT/frontend"
echo '[TEST] Business-map frontend typecheck and component tests'
npm run typecheck
./node_modules/.bin/vitest run --config vitest.business-map.config.ts --reporter=json --outputFile="$REPORT_DIR/component-results.json"
echo '[TEST] Build exact frontend source before browser verification'
npm run build
echo '[TEST] Business-map isolated browser workflows'
PLAYWRIGHT_JSON_OUTPUT_FILE="$REPORT_DIR/browser-results.json" ./node_modules/.bin/playwright test --config playwright.business-map.config.ts --reporter=list,json

cd "$ROOT"
node --input-type=module - "$REPORT_DIR" <<'JS'
import fs from 'node:fs';
import path from 'node:path';
const directory=process.argv[2];
const summary={scope:'business-map',database:'disposable-localhost-postgresql',realBusinessDataChanged:false};
const backendReports=fs.readdirSync(directory).filter(name=>name.startsWith('backend-business-map')&&name.endsWith('.json')).map(name=>JSON.parse(fs.readFileSync(path.join(directory,name),'utf8')));
const backend={numPassedTests:0,numFailedTests:0,numPendingTests:0,testResults:[]};
for(const report of backendReports){backend.numPassedTests+=report.numPassedTests;backend.numFailedTests+=report.numFailedTests;backend.numPendingTests+=report.numPendingTests;backend.testResults.push(...report.testResults);}
fs.writeFileSync(path.join(directory,'backend-results.json'),JSON.stringify(backend)+'\n');
for(const [key,file] of [['backend','backend-results.json'],['component','component-results.json']]) {
  const r=JSON.parse(fs.readFileSync(path.join(directory,file),'utf8'));
  if(r.numPassedTests<1||r.numFailedTests!==0||r.numPendingTests!==0)throw new Error(key+' tests are incomplete');
  summary[key]={passed:r.numPassedTests,failed:r.numFailedTests,skipped:r.numPendingTests};
}
const browser=JSON.parse(fs.readFileSync(path.join(directory,'browser-results.json'),'utf8'));
if(browser.stats.expected<1||browser.stats.unexpected!==0||browser.stats.skipped!==0||browser.stats.flaky!==0)throw new Error('Browser tests are incomplete or unstable');
summary.browser={passed:browser.stats.expected,failed:browser.stats.unexpected,skipped:browser.stats.skipped};
fs.writeFileSync(path.join(directory,'summary.json'),JSON.stringify(summary,null,2)+'\n');
console.log('[BUSINESS_MAP_TESTS_PASSED] '+JSON.stringify(summary));
JS
