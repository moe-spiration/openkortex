import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { denylistConfig, main, scanDenylist } from "./denylist.mjs";

function repo(files) {
  const root = mkdtempSync(join(tmpdir(), "kortex-denylist-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), text);
  }
  return root;
}
const silent = { log() {}, error() {} };

test("config merges the overlay file with KORTEX_DENYLIST", () => {
  const cfg = denylistConfig(
    { denylist: { terms: ["acme.test", " "], words: ["Zed"], privatePaths: ["docs"] } },
    { KORTEX_DENYLIST: "foo-org, acme.test" },
  );
  assert.deepEqual(cfg, {
    terms: ["acme.test", "foo-org"],
    words: ["Zed"],
    privatePaths: ["docs"],
  });
  assert.deepEqual(denylistConfig({}, {}), { terms: [], words: [], privatePaths: [] });
});

test("finds terms anywhere (any case) and words only as whole words, outside the private paths", () => {
  const root = repo({
    "src/a.ts": 'const url = "https://app.ACME.test";\nconst ok = "Zedekiah";\n',
    "src/b.ts": "// asked by Zed\n",
    "docs/private.md": "acme.test and Zed are fine here\n",
    "kortex.instance.json": '{"webUrl":"https://app.acme.test"}\n',
  });
  try {
    const hits = scanDenylist(root, {
      terms: ["acme.test"],
      words: ["Zed"],
      privatePaths: ["docs", "kortex.instance.json"],
    });
    assert.deepEqual(hits, [
      'src/a.ts:1:const url = "https://app.ACME.test";',
      "src/b.ts:1:// asked by Zed",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("main: passes without terms, fails with a leak, passes when clean", () => {
  const root = repo({ "src/a.ts": "const host = 'app.acme.test';\n" });
  try {
    assert.equal(main(root, {}, silent), 0);
    assert.equal(main(root, { KORTEX_DENYLIST: "acme.test" }, silent), 1);
    assert.equal(main(root, { KORTEX_DENYLIST: "other.test" }, silent), 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an identifier the owner published passes only in exactly its public form", () => {
  const root = repo({
    "README.md": "git clone https://github.com/zed-org/open.git\n",
    "src/a.ts": "// see zed-org/private\n",
  });
  try {
    const cfg = {
      terms: ["zed-org"],
      words: [],
      privatePaths: [],
      publicIdentifiers: ["zed-org/open"],
    };
    assert.deepEqual(scanDenylist(root, cfg), ["src/a.ts:1:// see zed-org/private"]);
    assert.equal(scanDenylist(root, { ...cfg, publicIdentifiers: [] }).length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
