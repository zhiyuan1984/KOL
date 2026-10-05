import { HttpFail } from "../host/errors.js";
import type { Json } from "../types.js";

/** Only raised after this executor proves no side-effect dispatch occurred
 * and persists its rejection. Error codes alone are never such evidence. */
export class ExecutionNotDispatched extends HttpFail {
  constructor(status: number, detail: Json, readonly code: string) {
    super(status, detail);
  }
}
