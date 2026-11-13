import { describe, expect, it } from "vitest";
import { countLinkedContext, extractLinkedTitles } from "./linked-context";

describe("linked context", () => {
  it("extracts link targets without alias/heading, unique, ignoring code", () => {
    const md = "Siehe [[Lea Hoffmann|Lea]], [[Projekt X#Ziele]] und ![[Unterseite]] und [[Lea Hoffmann]].\n`[[inline]]`\n```\n[[im Block]]\n```";
    expect(extractLinkedTitles(md)).toEqual(["Lea Hoffmann", "Projekt X", "Unterseite"]);
  });
  it("counts only resolvable links, never the note itself, capped", () => {
    const items = [
      { id: "a", title: "Lea" },
      { id: "b", title: "Projekt X" },
      { id: "me", title: "Diese" },
    ];
    expect(countLinkedContext("[[lea]] [[Projekt X]] [[Diese]] [[Unbekannt]]", "me", items)).toBe(2);
    const many = Array.from({ length: 9 }, (_, i) => ({ id: `i${i}`, title: `T${i}` }));
    expect(countLinkedContext(many.map((m) => `[[${m.title}]]`).join(" "), "me", many)).toBe(5);
  });
});
