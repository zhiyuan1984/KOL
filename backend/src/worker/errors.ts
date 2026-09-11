import type { Json } from "../types.js";

export class CodexUnavailable extends Error {
  next_action: string;

  constructor(message: string, nextAction: string) {
    super(message);
    this.next_action = nextAction;
  }

  asDict(): Json {
    return {
      code: "generation_unavailable",
      status: "暂时无法生成",
      message: this.message,
      next_action: this.next_action,
      ok: false,
      synthesized: false,
    };
  }
}
