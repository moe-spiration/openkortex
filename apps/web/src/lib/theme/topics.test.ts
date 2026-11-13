import { describe, expect, it } from "vitest";
import { lifeTopic, spaceHeroTopic, spaceTopic } from "./topics";

describe("theme topics", () => {
  it("maps auto-space keys, videos to video", () => {
    expect(spaceTopic("videos")).toBe("video");
    expect(spaceTopic("recipes")).toBe("recipes");
    expect(spaceTopic("nope")).toBeNull();
  });
  it("hero topic only for space scopes", () => {
    expect(spaceHeroTopic("space:books")).toBe("books");
    expect(spaceHeroTopic("object:project")).toBeNull();
    expect(spaceHeroTopic("vault:10_Notes")).toBeNull();
  });
  it("life areas", () => {
    expect(lifeTopic("health")).toBe("health");
    expect(lifeTopic("overview")).toBeNull();
  });
});
