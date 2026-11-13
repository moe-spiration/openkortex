import { strToU8, zipSync, type Zippable } from "fflate";

// A tiny EPUB 3 book (with an EPUB 2 NCX as well) built in memory.

const xhtml = (title: string, body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${title}</title><link rel="stylesheet" href="../style.css"/></head>
<body>${body}</body></html>`;

export const PNG_1PX = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

export function makeEpub(
  options: { withNav?: boolean; withNcx?: boolean; withCover?: boolean } = {},
): Uint8Array {
  const { withNav = true, withNcx = true, withCover = true } = options;
  const files: Zippable = {
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`),
    "OEBPS/content.opf": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:isbn:9783000000001</dc:identifier>
    <dc:title>Die Kunst der Wissensarbeit</dc:title>
    <dc:creator>Erika Mustermann</dc:creator>
    <dc:creator>Max Muster</dc:creator>
    <dc:language>de</dc:language>
    <dc:publisher>Kortex Verlag</dc:publisher>
    <dc:date>2026-01-15</dc:date>
    ${withCover ? '<meta name="cover" content="cover-img"/>' : ""}
  </metadata>
  <manifest>
    ${withNav ? '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' : ""}
    ${withNcx ? '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>' : ""}
    <item id="cover" href="text/cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch1-1" href="text/ch1-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="text/ch%202.xhtml" media-type="application/xhtml+xml"/>
    ${withCover ? '<item id="cover-img" href="images/cover.png" media-type="image/png"/>' : ""}
  </manifest>
  <spine${withNcx ? ' toc="ncx"' : ""}>
    <itemref idref="cover" linear="no"/>
    <itemref idref="ch1"/>
    <itemref idref="ch1-1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`),
    "OEBPS/text/cover.xhtml": strToU8(
      xhtml("Cover", '<img src="../images/cover.png" alt="Cover"/>'),
    ),
    "OEBPS/text/ch1.xhtml": strToU8(
      xhtml(
        "Kapitel 1",
        `<h1>Kapitel 1: Zettelkasten</h1><p>Der <strong>Zettelkasten</strong> von Niklas Luhmann verbindet Notizen &amp; Ideen.</p>
         <h2>Atomare Notizen</h2><p>Jede Notiz enthält genau einen Gedanken. Siehe <a href="ch1-1.xhtml">nächster Abschnitt</a>.</p>
         <img src="../images/fig.png"/>`,
      ),
    ),
    "OEBPS/text/ch1-1.xhtml": strToU8(
      xhtml("Verlinkung", "<h2>Verlinkung</h2><p>Links zwischen Notizen erzeugen ein Netz.</p>"),
    ),
    "OEBPS/text/ch 2.xhtml": strToU8(
      xhtml(
        "Kapitel 2",
        "<h1>Kapitel 2: Second Brain</h1><ul><li>Erfassen</li><li>Organisieren</li></ul><p>Fertig.</p>",
      ),
    ),
  };
  if (withNav) {
    files["OEBPS/nav.xhtml"] = strToU8(
      xhtml(
        "Inhalt",
        `<nav epub:type="landmarks"><ol><li><a href="text/cover.xhtml">Cover</a></li></ol></nav>
         <nav epub:type="toc" id="toc"><h1>Inhalt</h1><ol>
           <li><a href="text/ch1.xhtml">Kapitel 1: Zettelkasten</a>
             <ol><li><a href="text/ch1-1.xhtml#start">Verlinkung</a></li></ol>
           </li>
           <li><a href="text/ch%202.xhtml">Kapitel 2: Second Brain</a></li>
         </ol></nav>`,
      ),
    );
  }
  if (withNcx) {
    files["OEBPS/toc.ncx"] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint id="n1" playOrder="1"><navLabel><text>NCX Kapitel 1</text></navLabel><content src="text/ch1.xhtml"/>
      <navPoint id="n2" playOrder="2"><navLabel><text>NCX Verlinkung</text></navLabel><content src="text/ch1-1.xhtml"/></navPoint>
    </navPoint>
    <navPoint id="n3" playOrder="3"><navLabel><text>NCX Kapitel 2</text></navLabel><content src="text/ch%202.xhtml"/></navPoint>
  </navMap>
</ncx>`);
  }
  if (withCover) files["OEBPS/images/cover.png"] = PNG_1PX;
  return zipSync(files);
}
