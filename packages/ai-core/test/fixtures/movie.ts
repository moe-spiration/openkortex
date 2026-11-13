// IMDb title pages as served to a link-preview client (2026-10): schema.org JSON-LD plus the
// Next.js page data. Trimmed to the fields the movie adapter reads; texts are made up.

const nextData = (pageProps: unknown) =>
  `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps } })}</script>`;

const credit = (name: string, character?: string) => ({
  name: { nameText: { text: name } },
  creditedRoles: {
    edges: character ? [{ node: { characters: { edges: [{ node: { name: character } }] } } }] : [],
  },
});

export const imdbMovieHtml = `<!DOCTYPE html><html lang="de"><head>
<title>Lehmgesicht (2026) - IMDb</title>
<meta property="og:title" content="Lehmgesicht (2026) ⭐ 7.5 | Horror, Thriller">
<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "Movie",
  url: "https://www.imdb.com/de/title/tt0000001/",
  name: "Lehmgesicht",
  image: "https://m.media-amazon.com/images/M/poster1.jpg",
  description: "Kurzbeschreibung aus dem JSON-LD.",
  review: { "@type": "Review", reviewBody: "Eine lange Nutzerkritik, die nicht in die Notiz gehört." },
  aggregateRating: { "@type": "AggregateRating", ratingCount: 31884, ratingValue: 7.5 },
  contentRating: "16",
  genre: ["Horror", "Thriller"],
  datePublished: "2026-10-22",
  keywords: "body horror,superschurke",
  trailer: { "@type": "VideoObject", url: "https://www.imdb.com/de/video/vi1/" },
  actor: [{ "@type": "Person", name: "Ada Beispiel" }],
  director: [{ "@type": "Person", name: "Jan Regie" }],
  creator: [
    { "@type": "Organization", url: "https://www.imdb.com/company/co1/" },
    { "@type": "Person", name: "Eva Autorin" },
  ],
  duration: "PT1H48M",
})}</script>
${nextData({
  aboveTheFoldData: {
    titleText: { text: "Lehmgesicht" },
    originalTitleText: { text: "Clayface" },
    releaseYear: { year: 2026, endYear: null },
    runtime: { seconds: 6480 },
    plot: { plotText: { plainText: "Ein Filmstar verwandelt sich in ein Monster aus Lehm." } },
    certificate: { rating: "16" },
    genres: { genres: [{ text: "Horror" }, { text: "Science-Fiction" }, { text: "Thriller" }] },
    countriesOfOrigin: { countries: [{ id: "GB" }] },
    principalCreditsV2: [
      { grouping: { text: "Regisseur/-in" }, credits: [{ name: { nameText: { text: "Jan Regie" } } }] },
      {
        grouping: { text: "Autoren" },
        credits: [{ name: { nameText: { text: "Eva Autorin" } } }, { name: { nameText: { text: "Tom Feder" } } }],
      },
      { grouping: { text: "Stars" }, credits: [{ name: { nameText: { text: "Ada Beispiel" } } }] },
    ],
  },
  mainColumnData: {
    castV2: [
      {
        grouping: { text: "Top-Besetzung" },
        credits: [credit("Ada Beispiel", "Matt Hagen"), credit("Ben Neben", "Fahrer"), credit("Cem Ohne")],
      },
    ],
  },
})}
</head><body><div>Werbung, Nutzerkritiken, „Mehr wie dieser“ …</div></body></html>`;

export const imdbSeriesHtml = `<!DOCTYPE html><html lang="de"><head>
<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "TVSeries",
  name: "Chemie-Lehrer",
  image: { "@type": "ImageObject", url: "https://m.media-amazon.com/images/M/poster2.jpg" },
  description: "Ein Lehrer wird zum Drogenkoch.",
  aggregateRating: { ratingCount: 2699258, ratingValue: 9.5 },
  genre: ["Krimi", "Drama"],
  datePublished: "2010-10-09",
  actor: [{ "@type": "Person", name: "Walt Darsteller" }],
  creator: [{ "@type": "Person", name: "Vince Idee" }],
})}</script>
${nextData({
  aboveTheFoldData: {
    titleText: { text: "Chemie-Lehrer" },
    originalTitleText: { text: "Chemie-Lehrer" },
    releaseYear: { year: 2008, endYear: 2013 },
    runtime: { seconds: 2880 },
    principalCreditsV2: [
      { grouping: { text: "Creator/-in" }, credits: [{ name: { nameText: { text: "Vince Idee" } } }] },
    ],
  },
})}
</head><body></body></html>`;
