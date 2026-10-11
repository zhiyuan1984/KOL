/** Durable on-page receipt for Settings L3 actions. Survives refresh; toast is not a substitute. */

export type SettingsReceiptKind = "memory-delete" | "session-delete" | "starry-unbind";
export type SettingsReceiptCategory = "memories" | "privacy" | "starry";

/** The owner required to read or persist a Settings receipt. */
export type SettingsReceiptScope = {
  accountId: string;
  companyId?: string;
};

export type SettingsReceipt = {
  kind: SettingsReceiptKind;
  object: string;
  scope: string;
  consequence: string;
  text: string;
  at: string;
};

type StoredSettingsReceipt = {
  version: 2;
  owner: SettingsReceiptScope;
  category: SettingsReceiptCategory;
  receipt: SettingsReceipt;
};

/** Legacy, unowned key. It is deliberately never read or written. */
export const SETTINGS_RECEIPT_KEY = "settings:l3-receipt";
const SETTINGS_RECEIPT_NAMESPACE = `${SETTINGS_RECEIPT_KEY}:v2`;

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeScope(scope?: SettingsReceiptScope): SettingsReceiptScope | null {
  if (!scope || typeof scope !== "object") return null;
  const accountId = nonEmptyString(scope.accountId);
  if (!accountId) return null;
  if (scope.companyId === undefined) return { accountId };
  const companyId = nonEmptyString(scope.companyId);
  return companyId ? { accountId, companyId } : null;
}

function receiptCategory(kind: unknown): SettingsReceiptCategory | null {
  switch (kind) {
    case "memory-delete": return "memories";
    case "session-delete": return "privacy";
    case "starry-unbind": return "starry";
    default: return null;
  }
}

function receiptKey(scope: SettingsReceiptScope): string {
  const account = encodeURIComponent(scope.accountId);
  const company = scope.companyId ? `:company:${encodeURIComponent(scope.companyId)}` : ":account";
  return `${SETTINGS_RECEIPT_NAMESPACE}:account:${account}${company}`;
}

function storageOrNull(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function isSettingsReceipt(value: unknown): value is SettingsReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const receipt = value as Record<string, unknown>;
  const category = receiptCategory(receipt.kind);
  const at = nonEmptyString(receipt.at);
  return Boolean(
    category
    && nonEmptyString(receipt.object)
    && nonEmptyString(receipt.scope)
    && nonEmptyString(receipt.consequence)
    && nonEmptyString(receipt.text)
    && at
    && !Number.isNaN(new Date(at).getTime()),
  );
}

function isOwnedReceipt(value: unknown, scope: SettingsReceiptScope): value is StoredSettingsReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const stored = value as Partial<StoredSettingsReceipt>;
  const owner = normalizeScope(stored.owner);
  if (!owner || stored.version !== 2 || !isSettingsReceipt(stored.receipt)) return false;
  return owner.accountId === scope.accountId
    && owner.companyId === scope.companyId
    && stored.category === receiptCategory(stored.receipt.kind);
}

/**
 * Returns only a receipt owned by the explicit account/company scope. There is
 * intentionally no fallback to an account-only or legacy key.
 */
export function readSettingsReceipt(scope?: SettingsReceiptScope): SettingsReceipt | null {
  const owner = normalizeScope(scope);
  const storage = storageOrNull();
  if (!owner || !storage) return null;
  try {
    const raw = storage.getItem(receiptKey(owner));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isOwnedReceipt(parsed, owner) ? parsed.receipt : null;
  } catch {
    return null;
  }
}

/**
 * Keeps the existing event-shaped receipt return value, but only persists it
 * when a valid owner scope is supplied.
 */
export function writeSettingsReceipt(
  receipt: Omit<SettingsReceipt, "at"> & { at?: string },
  scope?: SettingsReceiptScope,
): SettingsReceipt {
  const next: SettingsReceipt = {
    ...receipt,
    at: receipt.at || new Date().toISOString(),
  };
  const owner = normalizeScope(scope);
  const category = receiptCategory(next.kind);
  const storage = storageOrNull();
  if (!owner || !category || !isSettingsReceipt(next) || !storage) return next;
  try {
    const stored: StoredSettingsReceipt = { version: 2, owner, category, receipt: next };
    storage.setItem(receiptKey(owner), JSON.stringify(stored));
  } catch {
    /* ignore quota / private mode */
  }
  return next;
}

/** Removes receipt data only; audits and all unrelated browser settings remain untouched. */
export function clearSettingsReceipts(accountId?: string): void {
  const storage = storageOrNull();
  const account = accountId === undefined ? null : nonEmptyString(accountId);
  if (!storage || (accountId !== undefined && !account)) return;
  try {
    const accountPrefix = account ? `${SETTINGS_RECEIPT_NAMESPACE}:account:${encodeURIComponent(account)}:` : null;
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => Boolean(key));
    for (const key of keys) {
      if (key === SETTINGS_RECEIPT_KEY || (accountPrefix ? key.startsWith(accountPrefix) : key.startsWith(`${SETTINGS_RECEIPT_NAMESPACE}:`))) {
        storage.removeItem(key);
      }
    }
  } catch {
    /* ignore storage restrictions */
  }
}

export function formatSettingsReceiptTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return iso;
  }
}
