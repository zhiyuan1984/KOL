import { randomBytes } from "node:crypto";

export function nid(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString("hex")}`;
}
