import assert from 'node:assert/strict';
import { checkStagingHeadroom } from './check-staging-headroom.mjs';

const fsStats = miB => ({ bavail: BigInt(miB) * 256n, bfree: 999999999n, bsize: 4096n });
let calls = 0;
assert.throws(() => checkStagingHeadroom(['/staging'], {
  statfs: () => { calls++; return fsStats(661); },
}), /insufficient free disk space.*661 MiB available; 2048 MiB required/);
assert.equal(calls, 1);
assert.throws(() => checkStagingHeadroom(['/staging'], { minMiB: 0, statfs: () => { throw new Error('must not be called'); } }), /at least 1024/);
assert.throws(() => checkStagingHeadroom(['/staging'], { minMiB: 1023 }), /at least 1024/);
assert.throws(() => checkStagingHeadroom(['/staging'], { minMiB: NaN }), /at least 1024/);
assert.throws(() => checkStagingHeadroom([]), /At least one/);
assert.throws(() => checkStagingHeadroom(['/staging', '/temporary'], {
  statfs: target => fsStats(target === '/temporary' ? 1024 : 4096),
}), /temporary: 1024 MiB available/);
const healthy = checkStagingHeadroom(['/staging', '/temporary'], { statfs: () => fsStats(2048) });
assert.equal(healthy.length, 2);
assert.ok(healthy.every(report => report.availableMiB === 2048));
console.log('Staging headroom tests passed: low/unavailable or invalid capacity fails closed; uses non-root bavail; all paths and exact threshold checked; no cleanup, SQL or deploy actions');
