import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SETTINGS_RECEIPT_KEY,
  clearSettingsReceipts,
  readSettingsReceipt,
  writeSettingsReceipt,
  type SettingsReceiptKind,
  type SettingsReceiptScope,
} from "./settingsReceipt";

const scopeA: SettingsReceiptScope = { accountId: "account-a" };
const scopeACompany: SettingsReceiptScope = { accountId: "account-a", companyId: "company-1" };
const scopeB: SettingsReceiptScope = { accountId: "account-b" };

function receipt(kind: SettingsReceiptKind = "memory-delete") {
  return {
    kind,
    object: "测试对象",
    scope: "仅自己",
    consequence: "会永久删除",
    text: "已完成测试操作。",
    at: "2026-10-11T01:02:03.000Z",
  };
}

function storedReceiptValues(): unknown[] {
  return Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
    .filter((key): key is string => Boolean(key) && key !== SETTINGS_RECEIPT_KEY)
    .map((key) => JSON.parse(localStorage.getItem(key)!));
}

describe("settings receipt storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("isolates receipts between accounts and never falls back from a company scope", () => {
    writeSettingsReceipt(receipt(), scopeA);
    writeSettingsReceipt({ ...receipt("session-delete"), object: "B 的会话" }, scopeB);
    writeSettingsReceipt({ ...receipt("starry-unbind"), object: "公司绑定" }, scopeACompany);

    expect(readSettingsReceipt()).toBeNull();
    expect(readSettingsReceipt(scopeA)?.object).toBe("测试对象");
    expect(readSettingsReceipt(scopeB)?.object).toBe("B 的会话");
    expect(readSettingsReceipt(scopeACompany)?.object).toBe("公司绑定");
    expect(readSettingsReceipt({ accountId: "account-a", companyId: "company-2" })).toBeNull();
  });

  it("rejects absent scope and never reads or writes the legacy unowned key", () => {
    const legacy = receipt("session-delete");
    localStorage.setItem(SETTINGS_RECEIPT_KEY, JSON.stringify(legacy));

    expect(readSettingsReceipt()).toBeNull();
    expect(readSettingsReceipt(scopeA)).toBeNull();
    expect(writeSettingsReceipt(receipt())).toEqual(expect.objectContaining(receipt()));
    expect(localStorage.getItem(SETTINGS_RECEIPT_KEY)).toBe(JSON.stringify(legacy));
    expect(localStorage.length).toBe(1);
  });

  it("rejects malformed JSON and tampered owner, category, or receipt data", () => {
    writeSettingsReceipt(receipt(), scopeA);
    const [key] = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter((value): value is string => Boolean(value));
    expect(key).toBeTruthy();

    localStorage.setItem(key, "{");
    expect(readSettingsReceipt(scopeA)).toBeNull();

    localStorage.setItem(key, JSON.stringify({
      version: 2,
      owner: { accountId: "account-b" },
      category: "memories",
      receipt: receipt(),
    }));
    expect(readSettingsReceipt(scopeA)).toBeNull();

    localStorage.setItem(key, JSON.stringify({
      version: 2,
      owner: scopeA,
      category: "privacy",
      receipt: receipt(),
    }));
    expect(readSettingsReceipt(scopeA)).toBeNull();

    localStorage.setItem(key, JSON.stringify({
      version: 2,
      owner: scopeA,
      category: "memories",
      receipt: { ...receipt(), at: "not-a-date" },
    }));
    expect(readSettingsReceipt(scopeA)).toBeNull();
  });

  it("stores category and owner affiliation for every supported receipt kind", () => {
    const categories: Array<[SettingsReceiptKind, string]> = [
      ["memory-delete", "memories"],
      ["session-delete", "privacy"],
      ["starry-unbind", "starry"],
    ];

    categories.forEach(([kind, category], index) => {
      localStorage.clear();
      const scope = { accountId: `account-${index}`, companyId: `company-${index}` };
      writeSettingsReceipt(receipt(kind), scope);
      expect(storedReceiptValues()).toEqual([
        expect.objectContaining({
          version: 2,
          owner: scope,
          category,
          receipt: expect.objectContaining({ kind }),
        }),
      ]);
    });
  });

  it("clears only the requested account's receipts and preserves audit and other settings", () => {
    writeSettingsReceipt(receipt(), scopeA);
    writeSettingsReceipt(receipt("starry-unbind"), scopeACompany);
    writeSettingsReceipt(receipt("session-delete"), scopeB);
    localStorage.setItem(SETTINGS_RECEIPT_KEY, JSON.stringify(receipt()));
    localStorage.setItem("audit:settings", "retain");
    localStorage.setItem("ui:left-collapsed", "true");

    clearSettingsReceipts("account-a");

    expect(readSettingsReceipt(scopeA)).toBeNull();
    expect(readSettingsReceipt(scopeACompany)).toBeNull();
    expect(readSettingsReceipt(scopeB)?.kind).toBe("session-delete");
    expect(localStorage.getItem(SETTINGS_RECEIPT_KEY)).toBeNull();
    expect(localStorage.getItem("audit:settings")).toBe("retain");
    expect(localStorage.getItem("ui:left-collapsed")).toBe("true");

    clearSettingsReceipts();
    expect(readSettingsReceipt(scopeB)).toBeNull();
    expect(localStorage.getItem("audit:settings")).toBe("retain");
    expect(localStorage.getItem("ui:left-collapsed")).toBe("true");
  });
});
