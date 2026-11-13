import assert from "node:assert/strict";
import { test } from "node:test";
import {
  convertTranscript,
  dropEmptySections,
  isHallucinatedEntry,
  planContentBackfill,
  planType,
  toggleBlock,
} from "./backfill-content.mjs";

const lib = {
  typeFromUrl: (u) =>
    u?.includes("amazon.de/") ? { type: "book", confidence: 0.92, rule: "amazon-isbn" } : null,
  typeFromTags: (tags) => (tags.includes("buch") ? "book" : null),
  isWhisperHallucination: (t) => /amara\.org|fürs zuschauen/i.test(t),
};

test("voice <details> raw transcript becomes the last toggle block", () => {
  const md = "## TL;DR\n\nKurz.\n\n<details>\n<summary>Rohtranskript</summary>\n\nEins zwei.\n\n</details>";
  assert.equal(
    convertTranscript(md),
    "## TL;DR\n\nKurz.\n\n> [!toggle]- Transkript\n>\n> Eins zwei.",
  );
});

test("meeting transcript section moves to the end, lines become paragraphs, empty sections drop", () => {
  const md =
    "# M\n\n## Vollständiges Transkript\n\n[00:00:01] Max: Hallo\n[00:00:05] Anna: Hi\n\n## Getroffene Entscheidungen\n\n- Keine\n\n## Summary\n\nText";
  const out = convertTranscript(md);
  assert.ok(!out.includes("Keine"));
  assert.ok(out.endsWith("> [!toggle]- Transkript\n>\n> [00:00:01] Max: Hallo\n>\n> [00:00:05] Anna: Hi"));
  assert.ok(out.indexOf("## Summary") < out.indexOf("[!toggle]"));
});

test("media transcript after a rule keeps its ### headings and drops the placeholder", () => {
  const md = "# V\n\n> Kein Transkript verfügbar.\n\n## Kernpunkte\n\n- a\n\n---\n\n## Transkript\n\n### [0:00] Intro\n\n[0:00] Hallo";
  const out = convertTranscript(md);
  assert.ok(!out.includes("Kein Transkript"));
  assert.ok(!out.includes("\n---\n"));
  assert.ok(out.endsWith("> [!toggle]- Transkript\n>\n> ### [0:00] Intro\n>\n> [0:00] Hallo"));
});

test("is idempotent and leaves notes without a transcript alone", () => {
  const once = convertTranscript("# T\n\n## Transkript\n\nHallo");
  assert.equal(convertTranscript(once), once);
  assert.equal(convertTranscript("# T\n\nNur Text."), "# T\n\nNur Text.");
});

test("toggleBlock is empty for blank input; dropEmptySections keeps real sections", () => {
  assert.deepEqual(toggleBlock(["", "  "]), []);
  assert.equal(dropEmptySections("## A\n\n- x\n\n## B\n\n- Keine"), "## A\n\n- x\n");
});

test("types: URL rule or tag fix generic items, typed and other items stay", () => {
  assert.deepEqual(planType({ type: "article", source_url: "https://www.amazon.de/x/dp/0735211299" }, lib), {
    type: "book",
    reason: "url:amazon-isbn",
  });
  assert.deepEqual(planType({ type: "article", source_url: "https://blog.de/x", tags: ["buch"] }, lib), {
    type: "book",
    reason: "tag",
  });
  assert.equal(planType({ type: "video", tags: ["buch"] }, lib), null);
  assert.equal(planType({ type: "book", source_url: "https://www.amazon.de/x/dp/0735211299" }, lib), null);
});

test("Amara entries are listed, never changed; a real note with one stray line is not listed", () => {
  const amara = { id: "a", title: "Notiz", type: "voice", content_md: "Untertitel der Amara.org-Community" };
  const real = { id: "b", title: "Echt", type: "voice", content_md: "Ich muss morgen Vertrag senden und Preise prüfen.\n\nVielen Dank fürs Zuschauen" };
  assert.equal(isHallucinatedEntry(amara, lib), true);
  assert.equal(isHallucinatedEntry(real, lib), false);
  const plan = planContentBackfill([amara, real], lib);
  assert.deepEqual(plan.hallucinations.map((h) => h.id), ["a"]);
  assert.deepEqual(plan.transcripts, []);
});
