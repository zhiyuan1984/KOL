import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppUser } from "../src/auth.js";
import { canDecideCurrent } from "../src/approval/inbox.js";
import { chainIndexForViewer, isCurrentDecider, isVisibleToViewer } from "../src/approval/queue.js";
import type { Row } from "../src/types.js";

const canonicalTarget: AppUser = {
  id: "usr_org_zhang_huiling", username: "willa.zhang@amperetime.com", handle: "willa.zhang@amperetime.com",
  name: "张慧玲", email: "willa.zhang@amperetime.com", roles: ["employee", "admin"], role: "admin",
  brands: [], site: "", manager_user_id: null, active: true, exam_passed: true, exam_todo_count: 0, exam_module: "",
};
const sameNameAccount: AppUser = {
  ...canonicalTarget, id: "usr_same_name", username: "same-name@example.test", handle: "same-name@example.test", roles: ["employee"], role: "employee",
};
const unrelatedAdmin: AppUser = {
  ...canonicalTarget, id: "usr_other_admin", username: "other-admin@example.test", handle: "other-admin@example.test", name: "其他管理员",
};

const canonicalApproval: Row = {
  id: "appr_one", status: "pending", current_index: 0,
  chain: ["user:usr_org_zhang_huiling"],
  chain_detail: [{ name: "张慧玲", role: "本体变更 objects 单张授权终审人" }],
  payload: { scope: "objects", steps: [{ employee_id: "user:usr_org_zhang_huiling", name: "张慧玲" }] },
};

let previousAuthMode: string | undefined;

describe("canonical approval user node", () => {
  beforeEach(() => {
    previousAuthMode = process.env.AUTH_MODE;
    process.env.AUTH_MODE = "enabled";
  });

  afterEach(() => {
    if (previousAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = previousAuthMode;
  });

  it("allows only the exact active canonical user and never admin wildcard or same-name fallback", () => {
    expect(canDecideCurrent(canonicalTarget, ["user:usr_org_zhang_huiling"], 0)).toBe(true);
    expect(canDecideCurrent(sameNameAccount, ["user:usr_org_zhang_huiling"], 0)).toBe(false);
    expect(canDecideCurrent(unrelatedAdmin, ["user:usr_org_zhang_huiling"], 0)).toBe(false);
    expect(canDecideCurrent({ ...canonicalTarget, active: false }, ["user:usr_org_zhang_huiling"], 0)).toBe(false);

    expect(chainIndexForViewer(canonicalApproval, canonicalTarget)).toBe(0);
    expect(isCurrentDecider(canonicalApproval, canonicalTarget)).toBe(true);
    expect(isVisibleToViewer(canonicalApproval, canonicalTarget)).toBe(true);
    expect(chainIndexForViewer(canonicalApproval, sameNameAccount)).toBe(-1);
    expect(isVisibleToViewer(canonicalApproval, sameNameAccount)).toBe(false);
    expect(isVisibleToViewer(canonicalApproval, unrelatedAdmin)).toBe(false);
  });

  it("retains exact legacy snapshot-node behavior without using it to resolve canonical nodes", () => {
    const legacyZhang: AppUser = {
      ...canonicalTarget, id: "usr_legacy_zhang", username: "legacy-zhang@example.test", handle: "legacy-zhang@example.test",
      name: "张总", roles: ["employee"], role: "employee",
    };
    const legacyApproval: Row = {
      ...canonicalApproval,
      chain: ["emp_zhang"],
      chain_detail: [{ name: "张总", role: "CEO" }],
      payload: { scope: "objects", steps: [{ employee_id: "emp_zhang", name: "张总" }] },
    };
    expect(canDecideCurrent(legacyZhang, ["emp_zhang"], 0)).toBe(true);
    expect(chainIndexForViewer(legacyApproval, legacyZhang)).toBe(0);
    expect(isVisibleToViewer(legacyApproval, legacyZhang)).toBe(true);
    expect(canDecideCurrent(legacyZhang, ["user:usr_org_zhang_huiling"], 0)).toBe(false);
  });
});
