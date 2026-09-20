import { describe, expect, it } from "vitest";
import { DISCOVERY_KEYWORD_PACKS, discoveryTemplate } from "../src/discovery-template.js";
import { DISCOVERY_DIRECTION_PACKS, defaultDiscoveryBrief } from "../../frontend/src/home/discoveryTemplate.js";

describe("discovery direction packs", () => {
  it("keeps the frontend fallback identical to the backend packs", () => {
    expect(
      DISCOVERY_DIRECTION_PACKS.map((row) => ({ id: row.code, label: row.label, keywords: row.keywords })),
    ).toEqual(
      DISCOVERY_KEYWORD_PACKS.map((row) => ({ id: row.id, label: row.label, keywords: [...row.keywords] })),
    );
  });

  it("serves the same packs as directions on the template endpoint", () => {
    const template = discoveryTemplate() as Record<string, unknown>;
    expect(template.directions).toEqual(
      DISCOVERY_KEYWORD_PACKS.map((pack) => ({ id: pack.id, label: pack.label, keywords: [...pack.keywords] })),
    );
    expect(template.defaults).toMatchObject({
      platforms: [],
      directions: [],
      keywords: ["camping", "portable power station"],
    });
  });

  it("defaults to no platform, 全球英文, no direction and the outdoor keywords", () => {
    expect(defaultDiscoveryBrief()).toMatchObject({
      platforms: [],
      region: "global_en",
      directions: [],
      keywords: ["camping", "portable power station"],
    });
  });
});
