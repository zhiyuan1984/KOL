import { describe, expect, it, beforeEach } from "vitest";
import { RECENT_SKILLS_EVENT, RECENT_SKILLS_KEY, RECENT_SKILLS_LIMIT, pushRecentSkill, readRecentSkills } from "./recents";

const memory = new Map<string, string>();
const events: unknown[] = [];

beforeEach(() => {
  memory.clear();
  events.length = 0;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => { memory.set(key, value); },
      removeItem: (key: string) => { memory.delete(key); },
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      dispatchEvent: (event: Event) => {
        if ((event as CustomEvent).type === RECENT_SKILLS_EVENT) events.push((event as CustomEvent).detail);
        return true;
      },
    },
  });
});

describe("composer recent skills", () => {
  it("returns an empty list for missing or corrupt storage", () => {
    expect(readRecentSkills()).toEqual([]);
    memory.set(RECENT_SKILLS_KEY, "{not json");
    expect(readRecentSkills()).toEqual([]);
    memory.set(RECENT_SKILLS_KEY, JSON.stringify({ id: "email_compose" }));
    expect(readRecentSkills()).toEqual([]);
    memory.set(RECENT_SKILLS_KEY, JSON.stringify(["email_compose", 7, "", null]));
    expect(readRecentSkills()).toEqual(["email_compose"]);
  });

  it("keeps the newest first, de-duplicated and capped", () => {
    const pushed = ["a", "b", "c", "d", "e", "f"].map((id) => pushRecentSkill(id));
    expect(pushed[pushed.length - 1]).toEqual(["f", "e", "d", "c", "b"]);
    expect(readRecentSkills()).toHaveLength(RECENT_SKILLS_LIMIT);

    expect(pushRecentSkill("d")).toEqual(["d", "f", "e", "c", "b"]);
    expect(readRecentSkills()).toEqual(["d", "f", "e", "c", "b"]);
    expect(events[events.length - 1]).toEqual(["d", "f", "e", "c", "b"]);
  });

  it("ignores empty ids", () => {
    expect(pushRecentSkill("  ")).toEqual([]);
    expect(memory.get(RECENT_SKILLS_KEY)).toBeUndefined();
  });
});
