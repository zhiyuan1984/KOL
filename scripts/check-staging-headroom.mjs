import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIB = 1024n * 1024n;
export function checkStagingHeadroom(paths, { minMiB = 2048, statfs = fs.statfsSync } = {}) {
  if (!Number.isSafeInteger(minMiB) || minMiB < 1024) {
    throw new Error('Staging minimum free space must be an integer of at least 1024 MiB');
  }
  if (!Array.isArray(paths) || !paths.length) throw new Error('At least one staging filesystem path is required');
  const reports = paths.map(target => {
    const stats = statfs(path.resolve(target), { bigint: true });
    const available = BigInt(stats.bavail) * BigInt(stats.bsize);
    return { path: path.resolve(target), availableMiB: Number(available / MIB), minimumMiB: minMiB };
  });
  const low = reports.filter(report => report.availableMiB < minMiB);
  if (low.length) {
    throw new Error(`Staging refused before dependency installation or database creation: insufficient free disk space (${low.map(report => `${report.path}: ${report.availableMiB} MiB available; ${report.minimumMiB} MiB required`).join('; ')}). No files removed. Reclaim approved disposable storage or expand the disk before retrying.`);
  }
  return reports;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const reports = checkStagingHeadroom(process.argv.slice(2), {
      minMiB: Number(process.env.LINGONG_E2E_MIN_FREE_MIB || 2048),
    });
    for (const report of reports) console.log(`Staging disk headroom: ${report.path} ${report.availableMiB} MiB available (minimum ${report.minimumMiB} MiB)`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
