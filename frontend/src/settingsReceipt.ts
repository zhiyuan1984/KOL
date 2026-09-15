/** Durable on-page receipt for Settings L3 actions. Survives refresh; toast is not a substitute. */

export type SettingsReceiptKind = "memory-delete" | "session-delete" | "starry-unbind";

export type SettingsReceipt = {
  kind: SettingsReceiptKind;
  object: string;
  scope: string;
  consequence: string;
  text: string;
  at: string;
};

export const SETTINGS_RECEIPT_KEY = "settings:l3-receipt";

export function readSettingsReceipt(): SettingsReceipt | null {
  try {
    const raw = localStorage.getItem(SETTINGS_RECEIPT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SettingsReceipt;
    if (!parsed?.kind || !parsed.object || !parsed.text) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeSettingsReceipt(receipt: Omit<SettingsReceipt, "at"> & { at?: string }): SettingsReceipt {
  const next: SettingsReceipt = {
    ...receipt,
    at: receipt.at || new Date().toISOString(),
  };
  try {
    localStorage.setItem(SETTINGS_RECEIPT_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota / private mode */
  }
  return next;
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
