import { describe, expect, it } from "vitest";
import { AccountPatchSchema, accountFrom, formatBytes, maskEmail, metadataFor, planOf } from "./account";

describe("account card", () => {
  it("masks the email", () => {
    expect(maskEmail("max.miller@gmail.com")).toBe("ma•••@gm•••.com");
    expect(maskEmail("a@b.de")).toBe("a•••@b•••.de");
    expect(maskEmail(null)).toBe("–");
  });

  it("builds the card from the auth user like the sidebar profile", () => {
    const a = accountFrom(
      { email: "max@example.com", created_at: "2026-03-04T10:00:00Z", user_metadata: { full_name: "Max L.", timezone: "Europe/Vienna", avatar_url: "http://insecure/x.png" }, app_metadata: { provider: "google" } },
      { entries: 12, storageBytes: 2048, tier: "founder" },
    );
    expect(a).toMatchObject({ displayName: "Max L.", initial: "M", timezone: "Europe/Vienna", avatarUrl: null, provider: "google", entries: 12, tier: "founder" });
    expect(accountFrom({ email: "sven@x.de" }, { entries: 0, storageBytes: null, tier: null })).toMatchObject({
      displayName: "Sven",
      timezone: "Europe/Berlin",
      tier: "free",
    });
  });

  it("validates patches and maps them to user_metadata", () => {
    expect(AccountPatchSchema.safeParse({ timezone: "Mars/Olympus" }).success).toBe(false);
    expect(AccountPatchSchema.safeParse({ displayName: " " }).success).toBe(false);
    expect(AccountPatchSchema.safeParse({ avatarUrl: "http://x" }).success).toBe(false);
    expect(AccountPatchSchema.safeParse({ email: "x@y.z" }).success).toBe(false);
    const ok = AccountPatchSchema.parse({ displayName: "Max", timezone: "Europe/London", avatarUrl: "" });
    expect(metadataFor(ok)).toEqual({ full_name: "Max", display_name: "Max", timezone: "Europe/London", avatar_url: null });
  });

  it("maps tiers and formats sizes", () => {
    expect(planOf("founder")).toEqual({ id: "pro", label: "Kortex Pro", founder: true });
    expect(planOf("team").label).toBe("Kortex Team");
    expect(planOf(null).id).toBe("free");
    expect(formatBytes(2.1 * 1024 ** 3)).toBe("2,1 GB");
    expect(formatBytes(640 * 1024 ** 2)).toBe("640 MB");
  });
});
