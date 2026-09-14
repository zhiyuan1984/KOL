import fs from "node:fs";
import { Hono } from "hono";
import { expertAvatarPath, getPublishedExpert, listPublishedExperts, summonExpert } from "../experts.js";
import { HttpFail } from "../host/errors.js";

export const experts = new Hono();

experts.get("/experts", (c) => c.json(listPublishedExperts()));

experts.get("/experts/:id/avatar", (c) => {
  getPublishedExpert(c.req.param("id"));
  const file = expertAvatarPath(c.req.param("id"));
  if (!fs.existsSync(file)) throw new HttpFail(404, { code: "expert_not_found", message: "未找到该专家" });
  c.header("Content-Type", "image/svg+xml; charset=utf-8");
  c.header("Cache-Control", "public, max-age=3600");
  return c.body(Uint8Array.from(fs.readFileSync(file)));
});

experts.get("/experts/:id", (c) => c.json(getPublishedExpert(c.req.param("id"))));

experts.post("/experts/:id/summon", (c) => c.json(summonExpert(c.req.param("id"))));
