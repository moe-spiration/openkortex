import { describe, expect, it } from "vitest";
import { DOMAIN_OBJECT_TYPES } from "@kortex/db/domain";
import { OBJECT_FIELDS, convertMetadata, fieldsOf, folderSuggestionFor, validateMetadata } from "./schema";

describe("OBJECT_FIELDS", () => {
  it("covers every domain object type", () => {
    expect(Object.keys(OBJECT_FIELDS).sort()).toEqual([...DOMAIN_OBJECT_TYPES].sort());
  });

  it("puts the spec's pills first per type", () => {
    const pills = (t: (typeof DOMAIN_OBJECT_TYPES)[number]) => fieldsOf(t).filter(([, d]) => d.pill).map(([k]) => k);
    expect(pills("person")).toEqual(["role", "organization", "relationship"]);
    expect(pills("project")).toEqual(["project_status", "priority", "tech_stack", "target_date"]);
    expect(pills("asset")).toEqual(["asset_type", "location", "status", "monthly_value"]);
    expect(pills("goal")).toEqual(["goal_timeframe", "target_metric", "progress_pct"]);
  });
});

describe("validateMetadata", () => {
  it("keeps valid fields and coerces values", () => {
    const r = validateMetadata("project", { tech_stack: "Next.js, Supabase ,", priority: "high", target_date: "2026-12-15" });
    expect(r.errors).toEqual({});
    expect(r.metadata).toEqual({ tech_stack: ["Next.js", "Supabase"], priority: "high", target_date: "2026-12-15" });
  });

  it("reports invalid values and drops unknown keys", () => {
    const r = validateMetadata("goal", { progress_pct: 150, status: "Irgendwas", color: "red" });
    expect(r.errors.progress_pct).toBe("0 bis 100");
    expect(r.errors.status).toMatch(/^Erlaubt:/);
    expect(r.dropped).toEqual(["color"]);
    expect(r.metadata).toEqual({});
  });

  it("parses money, percent, dates, urls and records", () => {
    expect(validateMetadata("asset", { monthly_value: "4.200" }).metadata.monthly_value).toBe(4200);
    expect(validateMetadata("asset", { monthly_value: "4.200,50 €" }).metadata.monthly_value).toBe(4200.5);
    expect(validateMetadata("asset", { monthly_value: "4,5" }).metadata.monthly_value).toBe(4.5);
    expect(validateMetadata("asset", { monthly_value: "viel" }).errors.monthly_value).toBe("Keine Zahl");
    expect(validateMetadata("asset", { monthly_value: "4200" }).metadata.monthly_value).toBe(4200);
    expect(validateMetadata("goal", { progress_pct: "45 %" }).metadata.progress_pct).toBe(45);
    expect(validateMetadata("project", { target_date: "15.12.2026" }).errors.target_date).toBeTruthy();
    expect(validateMetadata("tool", { url: "claude.com/code" }).metadata.url).toBe("claude.com/code");
    expect(validateMetadata("tool", { url: "kein link" }).errors.url).toBeTruthy();
    expect(validateMetadata("person", { contact_info: "email: a@b.de, tel: 123" }).metadata.contact_info).toEqual({ email: "a@b.de", tel: "123" });
  });

  it("drops empty values instead of storing them", () => {
    expect(validateMetadata("person", { role: "  ", organization: "" }).metadata).toEqual({});
  });
});

describe("convertMetadata", () => {
  it("keeps shared fields when switching types", () => {
    expect(convertMetadata("organization", { location: "Freiburg", asset_type: "Immobilie" })).toEqual({ location: "Freiburg" });
  });

  it("drops values the target type doesn't allow", () => {
    // asset status "Gekauft" is not a valid goal status
    expect(convertMetadata("goal", { status: "Gekauft" })).toEqual({});
  });

  it("clears metadata when turned back into a note", () => {
    expect(convertMetadata("note", { role: "CTO" })).toEqual({});
  });
});

describe("folderSuggestionFor", () => {
  it("suggests the object folder", () => {
    expect(folderSuggestionFor("person", "10_Notes/Ideen/Sven.md")).toBe("70_Objects/People");
  });
  it("suggests nothing when already there or for notes", () => {
    expect(folderSuggestionFor("goal", "70_Objects/Goals/Hyrox.md")).toBeNull();
    expect(folderSuggestionFor("note", "70_Objects/Goals/Hyrox.md")).toBeNull();
  });
});
