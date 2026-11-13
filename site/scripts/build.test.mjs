import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { demoKey, render } from "./lib.mjs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("English and German texts have the same keys, and the page uses only known ones", () => {
  const en = JSON.parse(read("../src/i18n/en.json"));
  const de = JSON.parse(read("../src/i18n/de.json"));
  assert.deepEqual(Object.keys(de).sort(), Object.keys(en).sort());
  const template = read("../src/index.html");
  const values = { lang: "", home: "", otherHref: "", otherLang: "", otherLabel: "", autolang: "", repoUrl: "", repoName: "", siteUrl: "", canonical: "", mark: "", markLarge: "", fonts: "", codeUrl: "", guideUrl: "", contributeUrl: "", licenseUrl: "", imprintLink: "" };
  for (const [, name] of template.matchAll(/\{\{(icon:[a-z0-9-]+)\}\}/g)) values[name] = "";
  assert.doesNotThrow(() => render(template, en, values));
  assert.doesNotThrow(() => render(template, de, values));
  assert.throws(() => render("{{nope}}", en, values), /missing text "nope"/);
});

test("the demo shim names page payloads like the build", () => {
  // Run the shim in a bare context and read its key() through a fetch with the RSC header.
  let asked = "";
  const window = {
    fetch: (url) => ((asked = String(url)), Promise.resolve({ ok: false })),
    addEventListener() {},
  };
  const context = {
    window,
    location: { href: "http://x/home", origin: "http://x", pathname: "/home", search: "", hash: "" },
    history: { replaceState() {} },
    document: { readyState: "loading", getElementById: () => null },
    URL,
    Request: class {},
    Response: class {},
    setTimeout() {},
  };
  window.fetch.bind = () => window.fetch;
  runInNewContext(read("../demo-shim.js"), context);
  for (const path of ["/home", "/notes/n12", "/vault/10_Notes/Daily"]) {
    window.fetch(`http://x${path}?_rsc=abc`, { headers: { RSC: "1" } });
    assert.equal(asked, `/_demo/rsc/${demoKey(path)}.txt`);
  }
});

test("the demo shim answers the app's API without a server", async () => {
  const window = { fetch: () => assert.fail("no network"), addEventListener() {} };
  window.fetch.bind = () => window.fetch;
  const context = {
    window,
    location: { href: "http://x/home", origin: "http://x", pathname: "/home", search: "", hash: "" },
    history: { replaceState() {} },
    document: { readyState: "loading", getElementById: () => null },
    URL,
    Request: class {},
    Response,
    setTimeout() {},
  };
  runInNewContext(read("../demo-shim.js"), context);
  const res = await window.fetch("/api/chat", { method: "POST", body: "{}" });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error.code, "demo");
});
