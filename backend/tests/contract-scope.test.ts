import { describe, expect, it } from "vitest";
import { agentPublishState, agentSubmissionAllowed, departmentHeadAccessForUser, kolAgentScopeContext } from "../src/contract-scope.js";

describe("KOL contract scope", () => {
  it("loads canonical organization, brand and region scope into the harness context", () => {
    const scope = kolAgentScopeContext();
    expect(scope.agent_id).toBe("agent:kol");
    expect(scope.organization_scope).toEqual(["org:lt_team", "org:pq_ro_tb_team"]);
    expect(scope.brand_scope).toEqual(["brand:lt", "brand:pq", "brand:ro", "brand:tb"]);
    expect(scope.region_scope).toEqual(["region:eu", "region:us", "region:ca_au"]);
    expect(scope.owner_ref).toBe("resp:kol_business_owner");
    expect(scope.department_head_scope_policy).toMatchObject({ company_wide: true, brand_scope: "all", region_scope: "all" });
  });

  it("grants confirmed department heads company-wide ordinary data scope", () => {
    expect(departmentHeadAccessForUser({ name: "张慧玲" })).toMatchObject({
      company_wide: true,
      brand_scope: "all",
      region_scope: "all",
      data_actions: ["read", "write"],
    });
    expect(departmentHeadAccessForUser({ name: "刘敏" })).toMatchObject({ company_wide: true });
    expect(departmentHeadAccessForUser({ name: "未确认人员" })).toBeNull();
  });

  it("always allows stub submissions and follows the manifest publish gate in real mode", () => {
    expect(agentSubmissionAllowed("stub")).toBe(true);
    expect(agentSubmissionAllowed("real")).toBe(agentPublishState().employee_submission);
  });
});
