import { describe, expect, it } from "vitest";
import {
  connectorBindHref,
  connectorUseAccess,
  connectorUseStatus,
  isBindableConnector,
  preferCanonicalConnectors,
} from "./connectorUse";

describe("connector use-surface status", () => {
  it("splits expired from needs_personal_bind", () => {
    expect(connectorUseStatus("starrykol", { bound: true, status: "expired" })).toEqual({
      key: "expired",
      label: "已过期",
    });
    expect(connectorUseStatus("starrykol", { bound: false, status: "unbound" })).toEqual({
      key: "needs_personal_bind",
      label: "需个人绑定",
    });
    expect(connectorUseStatus("starrykol", { bound: true, status: "connected" })).toEqual({
      key: "available",
      label: "可用",
    });
    expect(connectorUseStatus("claw", { bound: false, status: "expired" })).toEqual({
      key: "available",
      label: "可用",
    });
  });

  it("projects access away from admin and builds the bind CTA", () => {
    expect(connectorUseAccess("read")).toBe("read");
    expect(connectorUseAccess("write")).toBe("write");
    expect(connectorUseAccess("admin")).toBe("write");
    expect(isBindableConnector("starrykol")).toBe(true);
    expect(connectorBindHref("starrykol")).toBe("/settings?tab=starry&from=connectors&connector=starrykol");
    expect(preferCanonicalConnectors([
      { id: "claw" },
      { id: "starrykol" },
      { id: "enterprise_mail" },
    ]).map((row) => row.id)).toEqual(["claw", "starrykol"]);
  });
});
