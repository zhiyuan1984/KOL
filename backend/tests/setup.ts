import fs from "node:fs";

// Windows keeps SQLite/WAL and worker files open briefly after a test closes a
// connection. Vitest must not turn that OS-level cleanup race into a product
// failure. Retry normal cleanup, then leave the uniquely-created temp folder
// for the OS if a background worker still owns it; every test uses a fresh path.
const originalRmSync = fs.rmSync.bind(fs);
const originalChmodSync = fs.chmodSync.bind(fs);
fs.rmSync = ((path: fs.PathLike, options?: fs.RmDirOptions | fs.RmDirOptions & { maxRetries?: number; retryDelay?: number }) => {
  try {
    return originalRmSync(path, { ...(options || {}), maxRetries: 20, retryDelay: 50 });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EBUSY" || code === "ENOTEMPTY") return undefined;
    throw error;
  }
}) as typeof fs.rmSync;

// Windows does not use POSIX executable bits. Some Codex app-server fixtures
// still call chmodSync(755); make fixture setup portable without hiding other
// filesystem errors.
fs.chmodSync = ((path: fs.PathLike, mode: fs.Mode) => {
  try {
    return originalChmodSync(path, mode);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform === "win32" && code === "EPERM") return undefined;
    throw error;
  }
}) as typeof fs.chmodSync;
