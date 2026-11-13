import { describe, expect, it } from "vitest";
import { desktopConnectLink, desktopTokenName } from "./desktop-connect";

describe("Mit Windows-App verbinden", () => {
  it("builds the kortex://connect deep link with the token and the web origin", () => {
    const token = "kx_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";
    const link = desktopConnectLink(token, "https://kortex.example.com");
    expect(link).toBe(`kortex://connect?token=${token}&web=https%3A%2F%2Fkortex.example.com`);
    const parsed = new URL(link);
    expect(parsed.protocol).toBe("kortex:");
    expect(parsed.searchParams.get("token")).toBe(token);
    expect(parsed.searchParams.get("web")).toBe("https://kortex.example.com");
  });

  it("names each token after the device and the time", () => {
    expect(desktopTokenName(new Date(2026, 10, 3, 14, 5))).toMatch(/^Windows-App \(03\.11\.2026, 14:05\)$/);
  });
});
