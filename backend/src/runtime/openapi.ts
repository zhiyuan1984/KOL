import { HttpFail } from "../host/errors.js";
import { parseDocument } from "yaml";
import type { HttpTool } from "./store.js";

export type OpenApiPreview = { tools: HttpTool[]; warnings: string[] };
type JsonObject = Record<string, unknown>;
const METHODS = ["get", "post", "put", "patch", "delete"] as const;
const ALLOWED_METHODS = new Set(METHODS);

function fail(code: string): never { throw new HttpFail(400, { code }); }
function plain(value: unknown): value is JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return (proto === Object.prototype || proto === null)
    && !Object.keys(value).some((key) => key === "__proto__" || key === "prototype" || key === "constructor");
}
function clone<T>(value: T): T { return structuredClone(value); }

function pointer(document: JsonObject, ref: string): unknown {
  if (!ref.startsWith("#/")) fail("runtime_openapi_external_ref_forbidden");
  let current: unknown = document;
  for (const token of ref.slice(2).split("/")) {
    const key = token.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!plain(current) || !(key in current)) fail("runtime_openapi_ref_not_found");
    current = current[key];
  }
  return current;
}
function resolve(document: JsonObject, value: unknown, seen = new Set<string>(), depth = 0): unknown {
  if (depth > 32) fail("runtime_openapi_ref_too_deep");
  if (Array.isArray(value)) return value.map((item) => resolve(document, item, new Set(seen), depth + 1));
  if (!plain(value)) return value;
  if (typeof value.$ref === "string") {
    const ref = value.$ref;
    if (!ref.startsWith("#/")) fail("runtime_openapi_external_ref_forbidden");
    if (seen.has(ref)) fail("runtime_openapi_cyclic_ref");
    seen.add(ref);
    const resolved = resolve(document, pointer(document, ref), seen, depth + 1);
    if (!plain(resolved)) fail("runtime_openapi_ref_invalid");
    const override = { ...value }; delete override.$ref;
    const resolvedOverride = resolve(document, override, new Set(seen), depth + 1);
    if (!plain(resolvedOverride)) fail("runtime_openapi_ref_invalid");
    return { ...resolved, ...resolvedOverride };
  }
  const output: JsonObject = Object.create(null) as JsonObject;
  for (const [key, child] of Object.entries(value)) output[key] = resolve(document, child, new Set(seen), depth + 1);
  return output;
}
function text(value: unknown, fallback = ""): string { return typeof value === "string" ? value.trim() : fallback; }
function uniqueName(operationId: string, used: Set<string>): string {
  const cleaned = operationId.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 160);
  if (!cleaned) return "";
  if (!used.has(cleaned)) { used.add(cleaned); return cleaned; }
  let index = 2; while (used.has(`${cleaned}_${index}`)) index += 1;
  const output = `${cleaned}_${index}`; used.add(output); return output;
}
function supportedSchema(schema: JsonObject, depth = 0): boolean {
  if (depth > 32) return false;
  if (schema.type !== undefined && schema.type !== "object" && schema.type !== "string" && schema.type !== "number"
    && schema.type !== "integer" && schema.type !== "boolean" && schema.type !== "array") return false;
  if (["oneOf", "anyOf", "allOf", "not", "if", "then", "else", "discriminator", "contentMediaType", "contentEncoding", "contains", "prefixItems"].some((key) => key in schema)) return false;
  if (schema.properties !== undefined) {
    if (!plain(schema.properties) || !Object.values(schema.properties).every((child) => plain(child) && supportedSchema(child, depth + 1))) return false;
  }
  if (schema.items !== undefined && (!plain(schema.items) || !supportedSchema(schema.items, depth + 1))) return false;
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== "boolean"
    && (!plain(schema.additionalProperties) || !supportedSchema(schema.additionalProperties, depth + 1))) return false;
  return true;
}
function operationParameters(document: JsonObject, pathItem: JsonObject, operation: JsonObject, warnings: string[], title: string): {
  properties: JsonObject; required: string[]; query: Record<string, string>;
} | null {
  const all = [...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []), ...(Array.isArray(operation.parameters) ? operation.parameters : [])];
  const properties: JsonObject = {}; const required: string[] = []; const query: Record<string, string> = {};
  const seen = new Set<string>();
  for (const raw of all) {
    let parameter: JsonObject;
    try { parameter = resolve(document, raw) as JsonObject; } catch { warnings.push(`${title}：参数引用不受支持`); return null; }
    const where = text(parameter.in); const name = text(parameter.name);
    if (!name || !["path", "query"].includes(where) || !plain(parameter.schema)) {
      warnings.push(`${title}：仅支持带 JSON Schema 的 path/query 参数`); return null;
    }
    if (seen.has(`${where}:${name}`)) { warnings.push(`${title}：参数 ${name} 重复`); return null; }
    seen.add(`${where}:${name}`);
    const schema = parameter.schema as JsonObject;
    if (!supportedSchema(schema)) { warnings.push(`${title}：参数 ${name} 的 Schema 不受支持`); return null; }
    properties[name] = clone(schema);
    if (parameter.required === true || where === "path") required.push(name);
    if (where === "query") query[name] = name;
  }
  return { properties, required: [...new Set(required)], query };
}
function requestBody(document: JsonObject, operation: JsonObject, warnings: string[], title: string): { properties: JsonObject; required: string[]; body: Record<string, string> } | null {
  if (!operation.requestBody) return { properties: {}, required: [], body: {} };
  let request: JsonObject;
  try { request = resolve(document, operation.requestBody) as JsonObject; } catch { warnings.push(`${title}：requestBody 引用不受支持`); return null; }
  if (!plain(request.content) || !plain((request.content as JsonObject)["application/json"])) {
    warnings.push(`${title}：仅支持 application/json 请求体`); return null;
  }
  const content = (request.content as JsonObject)["application/json"] as JsonObject;
  if (!plain(content.schema)) { warnings.push(`${title}：请求体缺少对象 Schema`); return null; }
  const schema = content.schema as JsonObject;
  if (!supportedSchema(schema) || schema.type !== "object" || !plain(schema.properties)) {
    warnings.push(`${title}：仅支持扁平对象 JSON 请求体`); return null;
  }
  const properties = clone(schema.properties as JsonObject);
  const required = Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === "string") : [];
  return { properties, required, body: Object.fromEntries(Object.keys(properties).map((key) => [key, key])) };
}

/** Preview only: no persistence, remote fetch, auth extraction, or tool execution. */
export function previewOpenApi(value: unknown): OpenApiPreview {
  let document: JsonObject;
  if (typeof value === "string") {
    if (!value.trim() || Buffer.byteLength(value, "utf8") > 2 * 1024 * 1024) fail("runtime_openapi_document_invalid");
    try {
      // JSON is a YAML subset. maxAliasCount=0 rejects aliases/expansion rather
      // than treating imported API definitions as an unbounded parser workload.
      const parsed = parseDocument(value, { uniqueKeys: true, prettyErrors: false });
      if (parsed.errors.length || parsed.warnings.length) fail("runtime_openapi_invalid_document");
      document = parsed.toJS({ maxAliasCount: 0 }) as JsonObject;
    } catch (error) {
      if (error instanceof HttpFail) throw error;
      fail("runtime_openapi_invalid_document");
    }
  } else if (plain(value)) document = value;
  else fail("runtime_openapi_document_invalid");
  if (typeof document.openapi !== "string" || !/^3\.(0|1)(?:\.\d+)?$/.test(document.openapi)) fail("runtime_openapi_version_unsupported");
  if (!plain(document.paths)) fail("runtime_openapi_paths_missing");
  const warnings: string[] = []; const tools: HttpTool[] = []; const used = new Set<string>();
  for (const [path, maybeItem] of Object.entries(document.paths)) {
    if (!plain(maybeItem) || !path.startsWith("/") || path.startsWith("//") || /[?#\\]/.test(path)) { warnings.push(`${path}：路径不安全或格式无效`); continue; }
    const item = maybeItem as JsonObject;
    for (const method of METHODS) {
      if (!(method in item)) continue;
      const rawOperation = item[method]; const title = `${method.toUpperCase()} ${path}`;
      if (!plain(rawOperation)) { warnings.push(`${title}：操作定义无效`); continue; }
      const operation = rawOperation as JsonObject;
      if (!ALLOWED_METHODS.has(method)) { warnings.push(`${title}：方法不受支持`); continue; }
      const operationId = text(operation.operationId);
      if (!operationId) { warnings.push(`${title}：缺少 operationId，未导入`); continue; }
      const params = operationParameters(document, item, operation, warnings, title); if (!params) continue;
      const body = requestBody(document, operation, warnings, title); if (!body) continue;
      const overlap = Object.keys(params.properties).filter((name) => name in body.properties);
      if (overlap.length) { warnings.push(`${title}：参数与请求体字段重名（${overlap.join("、")}），未导入`); continue; }
      const requestSchema = { type: "object", properties: { ...params.properties, ...body.properties },
        ...(params.required.length || body.required.length ? { required: [...new Set([...params.required, ...body.required])] } : {}), additionalProperties: false };
      const name = uniqueName(operationId, used); if (!name) { warnings.push(`${title}：operationId 无效`); continue; }
      if (operation.security || document.security) warnings.push(`${title}：认证要求未从 OpenAPI 自动导入；请在连接实例中单独配置凭据引用。`);
      tools.push({ name, description: text(operation.summary, text(operation.description, `${method.toUpperCase()} ${path}`)).slice(0, 4000),
        inputSchema: requestSchema, method: method.toUpperCase() as HttpTool["method"], path,
        ...(Object.keys(params.query).length ? { query: params.query } : {}), ...(Object.keys(body.body).length ? { body: body.body } : {}) });
    }
  }
  return { tools, warnings };
}
