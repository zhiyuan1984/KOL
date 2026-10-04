import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { HttpFail } from "../host/errors.js";
import type { Json } from "../types.js";

/** Diagnostics contain reviewed field names and types, never submitted values or AJV paths. */
export class RuntimeToolArgumentsInvalid extends HttpFail {
  constructor(schemas: Json[], args: Json) {
    const issues: Json[] = [];
    const object = args && typeof args === "object" && !Array.isArray(args) ? args : {};
    for (const schema of schemas) {
      const properties = (schema.properties || {}) as Json;
      for (const [field, definition] of Object.entries(properties)) {
        if (field.length > 128) continue;
        const value = object[field];
        if (value === undefined) {
          if (Array.isArray(schema.required) && schema.required.includes(field)) issues.push({ field, issue: "required" });
          continue;
        }
        const type = (definition as Json)?.type;
        const types = Array.isArray(type) ? type : [type];
        const actual = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
        if (types.every(expected => typeof expected === "string") && !types.includes(actual)
          && !(types.includes("integer") && typeof value === "number" && Number.isInteger(value))) {
          issues.push({ field, issue: "type", expected: types, actual });
        }
      }
    }
    const unique = [...new Map(issues.map(issue => [JSON.stringify(issue), issue])).values()].slice(0, 8);
    super(422, { code: "runtime_tool_arguments_invalid", argument_issues: unique.length ? unique : [{ field: "$", issue: "schema_constraint" }],
      dispatched: false });
  }
}

export function assertRuntimeToolArguments(schemas: Json[], args: Json): void {
  let valid: boolean;
  try {
    const validator = new AjvJsonSchemaValidator();
    valid = schemas.every(schema => validator.getValidator(schema as object)(args).valid);
  } catch { throw new HttpFail(422, { code: "runtime_tool_schema_invalid" }); }
  if (!valid) throw new RuntimeToolArgumentsInvalid(schemas, args);
}
