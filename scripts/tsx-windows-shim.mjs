// Some managed Windows runners return ENOMEM from uv_os_get_passwd even
// though USERNAME/USERPROFILE are available. tsx only needs the username to
// choose its temporary cache directory, so provide that non-sensitive value
// before the tsx CLI is imported.
import os from "node:os";

if (typeof process.geteuid !== "function") {
  // tsx prefers process.geteuid when present and only calls os.userInfo on
  // Windows. A synthetic uid is enough to select its cache directory.
  process.geteuid = () => -1;
}

const originalUserInfo = os.userInfo;
try {
  os.userInfo = () => ({
    username: process.env.USERNAME || process.env.USER || "codex",
    uid: -1,
    gid: -1,
    shell: process.env.ComSpec || "cmd.exe",
    homedir: process.env.USERPROFILE || os.tmpdir(),
  });
} catch {
  // Node may expose a non-writable built-in namespace; tsx will then report
  // the original environment error, which remains visible in the gate.
}

void originalUserInfo;
