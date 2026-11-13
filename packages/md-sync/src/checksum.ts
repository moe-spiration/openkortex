import { createHash } from "node:crypto";

/** JSON with recursively sorted object keys; `undefined` values are dropped. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return value === undefined ? "null" : JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? "null" : stableStringify(v))).join(",")}]`;
  }
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(",")}}`;
}

export const CHECKSUM_PREFIX = "sha256:";

/** `sha256:<hex>` over normalized frontmatter fields + trimmed markdown body. */
export function sha256Checksum(fields: Record<string, unknown>, body: string): string {
  const hash = createHash("sha256");
  hash.update(stableStringify(fields));
  hash.update("\n---\n");
  hash.update(body.trim());
  return CHECKSUM_PREFIX + hash.digest("hex");
}
