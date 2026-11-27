import { describe, expect, it } from "vitest";
import { DEFAULT_SECTION, SETTINGS_GROUPS, SETTINGS_SECTIONS, resolveSection } from "./sections";

describe("settings chapters (Ruhe round 2)", () => {
  it("are grouped: account and general first, then workspace, AI and agents, connections, data and access", () => {
    expect(SETTINGS_GROUPS.map((g) => g.label)).toEqual(["Personal", "Workspace", "AI and agents", "Connections", "Data and access"]);
    expect(SETTINGS_SECTIONS.map((s) => s.id)).toEqual(["profile", "general", "look", "cap", "ai", "mcp", "connectors", "vault", "priv"]);
    expect(new Set(SETTINGS_SECTIONS.map((s) => s.id)).size).toBe(SETTINGS_SECTIONS.length);
  });

  it("keeps every deep link of 0.6.8 working", () => {
    for (const id of ["profile", "look", "ai", "connectors", "cap", "vault", "mcp", "priv"]) expect(resolveSection(id).id).toBe(id);
    // Notifications moved into "General".
    expect(resolveSection("notif").id).toBe("general");
    // No or an unknown section: Appearance, as before.
    expect(resolveSection(undefined).id).toBe(DEFAULT_SECTION);
    expect(resolveSection("nope").id).toBe("look");
  });
});
