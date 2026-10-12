import { bodyLimit } from "hono/body-limit";

const DEFAULT_MAX_BYTES = 536870912;
// One file plus its filename, base and (at most 4000 characters) explanation.
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

export function documentMaxBytes(): number {
  const configured = Number(process.env.KNOWLEDGE_DOC_MAX_BYTES || DEFAULT_MAX_BYTES);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : DEFAULT_MAX_BYTES;
}

/** Bound received bytes before parseBody()/arrayBuffer(), including chunked requests. */
export const documentUploadBodyLimit: ReturnType<typeof bodyLimit> = async (c, next) => {
  const maxBytes = documentMaxBytes();
  return bodyLimit({
    maxSize: maxBytes + MULTIPART_OVERHEAD_BYTES,
    onError: context => context.json({ detail: {
      code: "knowledge_document_too_large",
      message: `单个文件不得超过 ${Math.floor(maxBytes / 1048576)} MiB（请求体含表单信息）`,
    } }, 413),
  })(c, next);
};
