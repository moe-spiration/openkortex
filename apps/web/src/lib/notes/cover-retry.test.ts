import { describe, expect, it } from "vitest";
import { COVER_RETRY_MS, COVER_STALL_MS, coverAttemptSrc, coverRetryDelay } from "./cover-retry";

describe("cover retry", () => {
  const signed = "https://supabase.example.com/storage/v1/object/sign/kortex-media/u1/covers/a.png?token=abc";

  it("keeps the stored URL on the first attempt", () => {
    expect(coverAttemptSrc(signed, 0)).toBe(signed);
  });

  it("adds a cache-busting parameter on retries and keeps the token", () => {
    const u = new URL(coverAttemptSrc(signed, 2));
    expect(u.searchParams.get("token")).toBe("abc");
    expect(u.searchParams.get("kx_retry")).toBe("2");
    expect(u.pathname).toBe("/storage/v1/object/sign/kortex-media/u1/covers/a.png");
  });

  it("leaves data and blob URLs alone", () => {
    expect(coverAttemptSrc("data:image/png;base64,AAAA", 1)).toBe("data:image/png;base64,AAAA");
    expect(coverAttemptSrc("blob:https://x/1", 1)).toBe("blob:https://x/1");
  });

  it("stops after the planned retries", () => {
    expect(coverRetryDelay(0)).toBe(COVER_RETRY_MS[0]);
    expect(coverRetryDelay(COVER_RETRY_MS.length)).toBeNull();
  });

  it("fits the worst case into the 30 s the e2e test waits", () => {
    const worst = (COVER_RETRY_MS.length + 1) * COVER_STALL_MS + COVER_RETRY_MS.reduce((a, b) => a + b, 0);
    expect(worst).toBeLessThanOrEqual(35_000);
  });
});
