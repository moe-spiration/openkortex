import { describe, expect, it } from "vitest";
import { createLogger, redact, redactString, requestId } from "./index";

describe("log redaction", () => {
  it("masks secret keys, emails, bearer tokens and JWTs", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk";
    const out = redact({ authorization: "Bearer abc", note: `mail me@x.de ${jwt}`, nested: { apiKey: "k", ok: 1 } }) as Record<string, unknown>;
    expect(out.authorization).toBe("[redacted]");
    expect(out.note).toBe("mail [redacted-email] [redacted-jwt]");
    expect(out.nested).toEqual({ apiKey: "[redacted]", ok: 1 });
    expect(redactString("Authorization: Bearer abc.def")).toContain("Bearer [redacted]");
  });

  it("writes one JSON line per event", () => {
    const lines: string[] = [];
    createLogger({ a: 1 }, (l) => lines.push(l)).child({ rid: "r1" }).info("hi me@x.de", { password: "p" });
    const rec = JSON.parse(lines[0]!);
    expect(rec).toMatchObject({ level: "info", msg: "hi [redacted-email]", a: 1, rid: "r1", password: "[redacted]" });
  });

  it("reuses a sane request id only", () => {
    expect(requestId(new Request("http://x", { headers: { "x-request-id": "abcdef123456" } }))).toBe("abcdef123456");
    expect(requestId(new Request("http://x", { headers: { "x-request-id": "bad id!" } }))).toMatch(/^[0-9a-f-]{36}$/);
  });
});
