import { createHash } from "node:crypto";

export function hashId(prefix, value) {
  return `${prefix}_${createHash("sha256").update(value, "utf8").digest("hex").slice(0, 12)}`;
}

export function nowIso() {
  return new Date().toISOString();
}
