import { describe, expect, it } from "vitest";
import { classify, extractHandle } from "../src/host/intent.js";
import { extractCreatorId } from "../src/host/creator.js";
import { stubClassifyIntent } from "../src/tasks/openai-intent.js";

describe("creator_profile classify", () => {
  it("maps 达人画像 / 创作者画像 / skill mention", () => {
    for (const t of ["达人画像", "创作者画像", "@达人画像", "/达人画像", "创建创作者画像任务"]) {
      expect(classify(t).type, t).toBe("chat");
      expect(stubClassifyIntent(t).task_type, t).toBe("creator_profile");
    }
  });

  it("extracts bili creator id and 硬核拆解 handle", () => {
    const text = "为 bili 创作者 cr_bili_NDI3NDk0ODcw（硬核拆解）创建创作者画像任务";
    expect(extractCreatorId(text)).toBe("cr_bili_NDI3NDk0ODcw");
    expect(extractHandle(text)).toBe("硬核拆解");
    const i = classify(text, "creator_profile");
    expect(i.type).toBe("creator_profile");
    expect(i.handle).toBe("硬核拆解");
    expect(i.extras.creator_id).toBe("cr_bili_NDI3NDk0ODcw");
  });

  it("frontend intent creator_profile needs a worker", () => {
    const i = classify("帮我看画像", "creator_profile");
    expect(i.type).toBe("creator_profile");
    expect(i.needs_worker).toBe(true);
  });
});
