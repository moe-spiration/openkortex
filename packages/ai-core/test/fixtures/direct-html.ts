// Handwritten article pages for the keyless direct-fetch fallback.

const paragraphs = Array.from(
  { length: 6 },
  (_, i) =>
    `<p>Absatz ${i + 1}: Das Model Context Protocol verbindet Agenten mit Werkzeugen und Daten. ` +
    `Ein Second Brain wird so für Claude, Cursor und eigene Skripte erreichbar, ohne Glue-Code pro Integration.</p>`,
).join("\n");

export const articleHtml = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <title>MCP erklärt | Tech-Blog</title>
  <meta property="og:title" content="Model Context Protocol erklärt">
  <meta property="og:description" content="Was MCP ist und warum es für Second Brains zählt.">
  <meta property="og:image" content="/img/mcp-hero.jpg">
  <meta property="og:site_name" content="Tech-Blog">
  <meta property="article:published_time" content="2026-10-20T08:00:00+02:00">
  <link rel="canonical" href="https://blog.example.com/mcp-erklaert">
  <script>window.tracking = "x";</script>
  <style>body{font-family:serif}</style>
</head>
<body>
  <header><nav><a href="/">Start</a> <a href="/archiv">Archiv</a></nav></header>
  <aside class="newsletter">Jetzt Newsletter abonnieren!</aside>
  <main>
    <article>
      <h1>Model Context Protocol erklärt</h1>
      <p class="byline">Von Erika Muster</p>
      ${paragraphs}
      <h2>Wie es funktioniert</h2>
      <p>Mehr dazu im <a href="/docs/spec">Spezifikations-Überblick</a> und im <a href="#top">Inhaltsverzeichnis</a>.</p>
      <figure><img data-src="/img/diagram.png" src="data:image/gif;base64,R0lGOD" alt="Architekturdiagramm"></figure>
      <pre><code>npx @modelcontextprotocol/inspector</code></pre>
    </article>
  </main>
  <footer>© 2026 Tech-Blog · Impressum</footer>
  <script>console.log("bye")</script>
</body>
</html>`;

/** Short app-like page where Readability gives up; the body fallback still produces text. */
export const shortHtml = `<!DOCTYPE html><html><head><title>Kurzinfo</title></head>
<body><nav>Menü</nav><main><h1>Kurzinfo</h1><p>${"Ein kurzer Hinweis zur Wartung am Wochenende. ".repeat(6)}</p></main>
<footer>Footer</footer></body></html>`;

/** Latin-1 encoded page without a charset header (meta charset only). */
export const latin1Html = `<!DOCTYPE html><html lang="de"><head><meta charset="iso-8859-1"><title>Größenänderung</title></head>
<body><article><h1>Größenänderung</h1>${"<p>Übergrößen und Maße für Bücher, Österreich und Zürich. Straßen über Brücken.</p>".repeat(8)}</article></body></html>`;

export function latin1Bytes(text: string): Uint8Array {
  return Uint8Array.from(text, (c) => {
    const code = c.charCodeAt(0);
    if (code > 255) throw new Error(`not latin1: ${c}`);
    return code;
  });
}
