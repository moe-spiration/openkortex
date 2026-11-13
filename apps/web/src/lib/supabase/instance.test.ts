import { describe, expect, it } from "vitest";
import { instanceInfo } from "./instance";

describe("instanceInfo (GET /api/instance)", () => {
  it("hands clients the public Supabase config of this deployment and nothing else", () => {
    const info = instanceInfo({ url: "https://supabase.example.com/", anonKey: "anon" }, "1.2.3");
    expect(info).toEqual({
      app: "kortex",
      version: "1.2.3",
      supabase: { url: "https://supabase.example.com", anonKey: "anon" },
    });
    expect(Object.keys(info).sort()).toEqual(["app", "supabase", "version"]);
  });

  it("reports a mock instance as supabase: null", () => {
    expect(instanceInfo(null, "1.2.3").supabase).toBeNull();
  });
});
