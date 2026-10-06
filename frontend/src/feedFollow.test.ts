import { describe, expect, it } from "vitest";
import { NO_UNREAD, newContentLabel, newContentSince } from "./feedFollow";

describe("newContentSince", () => {
  it("counts the messages that arrived after the reader left the bottom", () => {
    expect(newContentSince({ items: 4, height: 900 }, 7, 1400)).toEqual({ count: 3, grew: false });
    expect(newContentLabel(newContentSince({ items: 4, height: 900 }, 7, 1400))).toBe("有 3 条新内容");
  });

  it("does not invent a count when a streamed message is rewritten in place", () => {
    const unread = newContentSince({ items: 4, height: 900 }, 4, 1400);
    expect(unread).toEqual({ count: 0, grew: true });
    expect(newContentLabel(unread)).toBe("有新内容");
  });

  it("stays silent while nothing changed and before the reader ever scrolled away", () => {
    expect(newContentSince({ items: 4, height: 900 }, 4, 900)).toEqual(NO_UNREAD);
    expect(newContentLabel(NO_UNREAD)).toBe("");
    expect(newContentSince(null, 12, 4000)).toEqual(NO_UNREAD);
  });

  it("ignores a shorter feed after the mark (route change, filtered message)", () => {
    expect(newContentSince({ items: 9, height: 900 }, 3, 500)).toEqual(NO_UNREAD);
  });
});
