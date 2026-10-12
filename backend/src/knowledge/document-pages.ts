import { HttpFail } from "../host/errors.js";

type Normalization = { mode?: unknown; page_map?: unknown; pages?: unknown } | undefined;
/** Both OCR paths may reflow one source page into multiple indexed PDF pages. */
export function originalDocumentPage(normalize: Normalization, indexedPage: number): number {
  const mapped = normalize?.mode === "scanned-ocr" || normalize?.mode === "pptx-ocr" || normalize?.mode === "pptx-convert";
  const mapping = normalize?.page_map as Record<string, unknown> | undefined;
  const original = mapped ? Number(mapping?.[String(indexedPage)]) : indexedPage;
  const total = Number(normalize?.pages);
  if (!Number.isInteger(indexedPage) || indexedPage < 1 || !Number.isInteger(original) || original < 1 || (Number.isInteger(total) && total > 0 && original > total)) {
    throw new HttpFail(502, { code: "knowledge_invalid_citation", message: "缺少有效原件页码映射，请重新解析资料" });
  }
  return original;
}
