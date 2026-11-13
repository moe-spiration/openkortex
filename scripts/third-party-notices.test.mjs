import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { licenseFiles, packageEntry, renderNotices } from "./third-party-notices.mjs";

test("license and notice files are found, other files are not", () => {
  const dir = mkdtempSync(join(tmpdir(), "kortex-notices-"));
  try {
    for (const f of [
      "LICENSE",
      "LICENSE-MIT",
      "license.md",
      "NOTICE",
      "COPYING.txt",
      "OFL.txt",
      "README.md",
      "index.js",
    ])
      writeFileSync(join(dir, f), `${f}\n`);
    mkdirSync(join(dir, "LICENSES"));
    assert.deepEqual(licenseFiles(dir), [
      "COPYING.txt",
      "LICENSE",
      "LICENSE-MIT",
      "NOTICE",
      "OFL.txt",
      "license.md",
    ]);
    assert.deepEqual(licenseFiles(join(dir, "missing")), []);
    const entry = packageEntry({
      name: "a",
      version: "1.0.0",
      license: "MIT",
      ecosystem: "npm",
      dir,
    });
    assert.match(entry.text, /^COPYING\.txt\n\nLICENSE\n/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("identical texts are printed once, packages without a file say so", () => {
  const mit = "MIT License\n\nCopyright (c) Someone";
  const md = renderNotices(
    [
      {
        name: "b",
        version: "2.0.0",
        license: "MIT",
        homepage: "https://b.example",
        ecosystem: "npm",
        text: mit,
      },
      { name: "a", version: "1.0.0", license: "MIT", homepage: "", ecosystem: "npm", text: mit },
      { name: "c", version: "0.1.0", license: "ISC", homepage: "", ecosystem: "cargo", text: "" },
      {
        name: "d",
        version: "3.0.0",
        license: "Apache-2.0",
        homepage: "",
        ecosystem: "npm",
        text: "Has ``` inside",
      },
    ],
    { product: "Open", notes: ["note one"] },
  );
  assert.match(md, /^# Third-party notices\n\nOpen is licensed/);
  assert.match(md, /> note one/);
  assert.equal(md.match(/MIT License/g).length, 1);
  assert.match(md, /\| c \| 0\.1\.0 \| cargo \| ISC \| no license file in the package \|/);
  assert.match(md, /\| \[b\]\(https:\/\/b\.example\) \| 2\.0\.0 \| npm \| MIT \| T\d \|/);
  assert.match(md, /a@1\.0\.0, b@2\.0\.0/);
  assert.match(md, /````text\nHas ``` inside\n````/);
});
