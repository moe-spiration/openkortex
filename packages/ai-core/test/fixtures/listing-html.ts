// Listing pages for the web clipper tests: a news front page with cards (kicker + headline + teaser),
// an ad card, chrome and inline links, and a link aggregator laid out as a table.

const card = (n: number, kicker: string, headline: string, teaser: string) => `
  <article class="teaser">
    <a href="/news/artikel-${n}.html">
      <figure><img src="/img/thumb-${n}.jpg" alt="Bild ${n}"></figure>
      <header><h3><span class="kicker">${kicker}</span><span class="headline">${headline}</span></h3></header>
      <p class="synopsis">${teaser}</p>
      <footer><span>${n * 3}</span></footer>
    </a>
  </article>`;

export const newsListingHtml = `<!doctype html>
<html lang="de"><head>
  <title>Technik-News | Beispiel Online</title>
  <meta property="og:title" content="Technik-News">
  <meta property="og:description" content="Aktuelle Nachrichten aus der IT.">
  <meta property="og:site_name" content="Beispiel Online">
  <meta property="og:image" content="https://news.example.com/og.png">
</head><body>
  <header class="site-header"><a href="/">Zur Startseite</a><nav><a href="/news/">News</a><a href="/tests/">Tests</a></nav></header>
  <div class="cookie-banner"><p>Wir verwenden Cookies, um Ihnen das beste Erlebnis zu bieten.</p><a href="/datenschutz">Mehr zum Datenschutz erfahren hier</a></div>
  <main>
    <h1>Technik-News</h1>
    <section>
      ${card(1, "Chipindustrie", "Neue Fabrik für europäische Halbleiter", "Die EU fördert ein Werk in Dresden mit mehreren Milliarden Euro.")}
      ${card(2, "Raumfahrt", "Voyager 1 meldet sich wieder", "Nach einer kurzen Funkstille hat die Nasa wieder Kontakt zur Sonde.")}
      ${card(3, "Smartphones", "Erstes Klapphandy mit E-Ink-Display", "Der Hersteller setzt auf lange Akkulaufzeit statt auf Farbe.")}
      <article class="teaser"><span>Anzeige</span><a href="https://shop.example.net/angebot"><h3>Jetzt den neuen Laptop sichern</h3><p>Nur heute mit 20 Prozent Rabatt auf alle Modelle im Shop.</p></a></article>
      ${card(4, "Sicherheit", "Lücke in verbreitetem Router gefunden", "Angreifer können ohne Passwort die Konfiguration ändern.")}
      ${card(5, "Software", "Linux-Kernel 7.2 ist erschienen", "Die neue Version bringt besseren Support für ARM-Laptops mit.")}
      ${card(6, "KI", "Sprachmodell läuft komplett auf dem Handy", "Forscher zeigen ein Modell, das ohne Cloud auskommt und schnell antwortet.")}
      ${card(7, "Energie", "Rechenzentren verbrauchen mehr Wasser als gedacht", "Eine Studie warnt vor Wasserstress in mehreren Regionen.")}
      <p>Mehr Hintergründe lesen Sie in unserem <a href="/dossier/ki">Dossier zu künstlicher Intelligenz und Arbeit</a> und im Archiv der letzten Monate, das täglich wächst.</p>
    </section>
    <a href="/news/seite-2">Ältere Artikel</a>
  </main>
  <footer class="site-footer"><a href="/impressum">Impressum und rechtliche Hinweise</a></footer>
</body></html>`;

const row = (n: number, title: string, host: string) => `
  <tr class="athing"><td class="rank">${n}.</td><td><a href="vote?id=${n}"></a></td>
    <td class="title"><span class="titleline"><a href="https://${host}/post-${n}">${title}</a> <span>(<a href="from?site=${host}">${host}</a>)</span></span></td></tr>
  <tr><td colspan="2"></td><td class="subtext">${n * 10} points by <a href="user?id=u${n}">u${n}</a> <a href="item?id=${n}">${n} hours ago</a> | <a href="item?id=${n}">${n * 2} comments</a></td></tr>`;

export const aggregatorHtml = `<!doctype html>
<html><head><title>Link News</title></head><body>
  <table><tbody>
    ${row(1, "A new database written in Rust is fast", "db.example.org")}
    ${row(2, "Why small teams ship better software", "blog.example.com")}
    ${row(3, "The history of the floppy disk in aviation", "history.example.net")}
    ${row(4, "Show LN: A tiny tool to clip web pages", "tool.example.dev")}
    ${row(5, "Understanding vector databases from scratch", "vectors.example.io")}
    ${row(6, "How we cut our cloud bill in half this year", "ops.example.co")}
    ${row(7, "A field guide to reading research papers", "papers.example.edu")}
  </tbody></table>
</body></html>`;
