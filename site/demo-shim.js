// Live-demo shim, inlined at the top of every demo page by site/scripts/build-demo.mjs.
// The demo is the web app in mock mode saved as static files: there is no server behind it.
// This shim answers what the app would ask its server:
// - page data for client-side navigation (React Server Component payloads) from /_demo/rsc/,
//   so moving between pages keeps the in-memory demo state instead of reloading;
// - every call to /api/ (AI chat, capture, search, sync) with a friendly 503: no backend, no AI.
//   In mock mode the app already expects these to fail and shows its own empty or error state.
// It also shows a small "Live demo" badge that links back to the website.
/* global window, document, location, history */
(function () {
  // Some static hosts answer /journal with a redirect to /journal/; the app knows only /journal.
  if (location.pathname.length > 1 && /\/$/.test(location.pathname)) {
    history.replaceState(history.state, "", location.pathname.replace(/\/+$/, "") + location.search + location.hash);
  }
  var MSG = "Not available in the live demo: it runs only in your browser, without a server and without AI.";
  // FNV-1a, 32 bit: the same function names the recorded page payloads at build time.
  function key(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ("0000000" + h.toString(16)).slice(-8);
  }
  function header(init, req, name) {
    var h = (init && init.headers) || (req && req.headers);
    if (!h) return null;
    if (typeof h.get === "function") return h.get(name);
    if (Array.isArray(h)) {
      for (var i = 0; i < h.length; i++) if (String(h[i][0]).toLowerCase() === name.toLowerCase()) return h[i][1];
      return null;
    }
    for (var k in h) if (k.toLowerCase() === name.toLowerCase()) return h[k];
    return null;
  }
  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var req = typeof Request !== "undefined" && input instanceof Request ? input : null;
    var url;
    try {
      url = new URL(req ? req.url : String(input), location.href);
    } catch {
      return realFetch(input, init);
    }
    if (url.origin !== location.origin) return realFetch(input, init);
    var method = String((init && init.method) || (req && req.method) || "GET").toUpperCase();
    if (header(init, req, "RSC") === "1" && method === "GET") {
      var path = url.pathname.replace(/\/$/, "") || "/";
      return realFetch("/_demo/rsc/" + key(path) + ".txt").then(function (r) {
        if (!r.ok) return realFetch(input, init);
        return r.text().then(function (body) {
          return new Response(body, { status: 200, headers: { "content-type": "text/x-component" } });
        });
      });
    }
    if (url.pathname.indexOf("/api/") === 0) {
      var body = JSON.stringify({ ok: false, demo: true, error: { code: "demo", message: MSG } });
      return Promise.resolve(new Response(body, { status: 503, headers: { "content-type": "application/json" } }));
    }
    return realFetch(input, init);
  };
  function badge() {
    if (document.getElementById("okx-demo-badge")) return;
    var a = document.createElement("a");
    a.id = "okx-demo-badge";
    a.href = "/";
    a.title = MSG;
    a.textContent = "Live demo · back to OpenKortex";
    a.setAttribute(
      "style",
      "position:fixed;right:12px;bottom:12px;z-index:2147483000;font:500 12px/1 system-ui,sans-serif;" +
        "padding:8px 12px;border-radius:999px;background:rgba(99,102,241,.16);color:#c7c9ff;" +
        "text-decoration:none;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)"
    );
    document.body.appendChild(a);
  }
  // After hydration, so React never sees a node it did not render.
  if (document.readyState === "complete") setTimeout(badge, 1500);
  else window.addEventListener("load", function () { setTimeout(badge, 1500); });
})();
