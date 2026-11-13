// Shared helpers of the website build (build.mjs, build-demo.mjs) and their tests.

/** FNV-1a, 32 bit, as `key()` in site/demo-shim.js: names the recorded page payloads of the demo. */
export function demoKey(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Fills {{key}} from the page values, then the language file; an unknown key throws. */
export function render(template, strings, values) {
  return template.replace(/\{\{([\w.:-]+)\}\}/g, (_, k) => {
    const v = values[k] ?? strings[k];
    if (v === undefined) throw new Error(`site: missing text "${k}"`);
    return v;
  });
}

export const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
