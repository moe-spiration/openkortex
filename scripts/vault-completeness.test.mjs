import assert from "node:assert/strict";
import { test } from "node:test";
import { findMissingFiles, frontmatterId, main } from "./vault-completeness.mjs";

test("frontmatterId reads the id from the YAML block only", () => {
  assert.equal(frontmatterId("---\ntitle: x\nid: abc-1\n---\nid: nope"), "abc-1");
  assert.equal(frontmatterId('---\nid: "q"\n---\n'), "q");
  assert.equal(frontmatterId("no frontmatter\nid: x"), null);
});

test("reports items without a file; matches by frontmatter id or by folder/slug path", () => {
  const items = [
    { id: "1", title: "Session", slug: "session", folder_path: "30_Clippings/Sessions" },
    { id: "2", title: "Focus", slug: "Focus-Profile", folder_path: "40_AI_Memories" },
    { id: "3", title: "Gone", slug: "gone", folder_path: "10_Notes" },
    { id: "4", title: "Renamed", slug: "renamed", folder_path: "10_Notes" },
  ];
  const files = [
    { rel: "30_Clippings/Sessions/session.md", id: null },
    { rel: "40_AI_Memories/focus-profile.md", id: "2" },
    { rel: "10_Notes/other-name.md", id: "4" },
  ];
  const res = findMissingFiles(items, files);
  assert.equal(res.checked, 4);
  assert.deepEqual(res.missing, [{ id: "3", title: "Gone", expected: "10_Notes/gone.md" }]);
});

test("passes without env (skip) and with nothing to check", async () => {
  assert.deepEqual(findMissingFiles([], []), { checked: 0, missing: [] });
  assert.equal(await main([], {}), 0);
});
