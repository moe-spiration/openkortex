// Recipe pages modelled on Chefkoch (JSON-LD in @graph) and a food blog (HowToSection, nutrition).

export const chefkochHtml = `<!DOCTYPE html><html lang="de"><head>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[]}</script>
<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[
  {"@type":"WebSite","name":"Chefkoch"},
  {"@type":["Recipe","NewsArticle"],
   "name":"Zucchini-Lasagne &amp; Hackfleisch",
   "description":"Low-Carb-Lasagne ohne Nudelplatten.",
   "image":["https://img.chefkoch-cdn.de/lasagne.jpg","https://img.chefkoch-cdn.de/lasagne-2.jpg"],
   "recipeYield":"4 Portionen",
   "prepTime":"PT20M","cookTime":"PT40M","totalTime":"PT1H",
   "recipeIngredient":["2 Zucchini","500 g Hackfleisch, gemischt","1/2 TL Salz","1,5 EL Olivenöl","2-3 Knoblauchzehen","½ Bund Basilikum","200 ml Sahne","Pfeffer"],
   "recipeInstructions":"Zucchini längs in Scheiben schneiden.<br>Hackfleisch anbraten.\\nAbwechselnd schichten und 40 Minuten backen.",
   "recipeCategory":"Hauptspeise","recipeCuisine":"Italien","keywords":"low carb, lasagne, ofen",
   "author":{"@type":"Person","name":"LowCarbLisa"}}
]}
</script></head><body><h1>Zucchini-Lasagne</h1></body></html>`;

export const blogHtml = `<html><head><script type="application/ld+json">
{"@context":"https://schema.org","@type":"Recipe","name":"Keto Brot","recipeYield":10,
 "image":{"@type":"ImageObject","url":"https://blog.example.com/brot.jpg"},
 "recipeIngredient":["200 g Mandelmehl","4 Eier"],
 "recipeInstructions":[
   {"@type":"HowToSection","name":"Teig","itemListElement":[{"@type":"HowToStep","text":"Mehl und Eier verrühren."}]},
   {"@type":"HowToSection","name":"Backen","itemListElement":[{"@type":"HowToStep","text":"45 Minuten bei 180 °C backen."}]}
 ],
 "nutrition":{"@type":"NutritionInformation","calories":"210 kcal","carbohydrateContent":"4 g","fiberContent":"2,5 g","proteinContent":"9 g","fatContent":"17 g"}}
</script></head><body></body></html>`;

export const noRecipeHtml = `<html><head><script type="application/ld+json">{"@type":"Article","name":"Kochen lernen"}</script></head></html>`;

// Chefkoch recipe page as served in 2026-10: image and author are only `@id` references into the
// @graph, the steps sit in one "Zubereitung" HowToSection with HowToTips, plus rating and comments.
export const chefkochGraphHtml = `<!DOCTYPE html><html lang="de"><head>
<meta property="og:image" content="https://img.chefkoch-cdn.de/og/lasagne.jpg">
<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[
  {"@type":"Recipe","@id":"https://www.chefkoch.de/rezepte/1/Lasagne.html#recipe",
   "name":"Lasagne wie beim Italiener","description":"Klassisch geschichtet mit Bolognese und Béchamel.",
   "image":{"@id":"https://www.chefkoch.de/rezepte/1/Lasagne.html#primaryimage"},
   "author":{"@id":"https://www.chefkoch.de/user/profil/abc#author"},
   "recipeYield":["4","4 Portionen"],"prepTime":"PT30M","cookTime":"PT1H10M","totalTime":"PT1H40M",
   "recipeCategory":"Pasta & Nudel","recipeCuisine":"Italien","keywords":"Hauptspeise, Nudeln",
   "recipeIngredient":["1 Zwiebel(n)","500 g Hackfleisch, gemischtes","0,5 Liter Milch","Salz und Pfeffer"],
   "recipeInstructions":[{"@type":"HowToSection","name":"Zubereitung","itemListElement":[
     {"@type":"HowToStep","position":1,"text":"Zwiebel würfeln und das Hackfleisch krümelig anbraten."},
     {"@type":"HowToTip","text":"Viel Flüssigkeit? Hitze erhöhen."},
     {"@type":"HowToStep","position":2,"text":"Schichten und 40 Min. bei 180 °C backen."}]}],
   "nutrition":{"@type":"NutritionInformation","calories":"1015 kcal","proteinContent":"48.9 g","fatContent":"56.7 g","carbohydrateContent":"74.9 g"},
   "aggregateRating":{"@type":"AggregateRating","ratingCount":5033,"ratingValue":4.7,"bestRating":5},
   "comment":[{"@type":"Comment","text":"Kommentar, der nicht ins Rezept gehört."}]},
  {"@type":"ImageObject","@id":"https://www.chefkoch.de/rezepte/1/Lasagne.html#primaryimage","url":"https://img.chefkoch-cdn.de/rezepte/1/lasagne.jpg"},
  {"@type":"Person","@id":"https://www.chefkoch.de/user/profil/abc#author","name":"hexe1078"}
]}
</script></head><body><h1>Lasagne</h1><p>Werbung, Kommentare, Navigation …</p></body></html>`;

// Chefkoch magazine article: no Recipe JSON-LD (only NewsArticle), the recipe sits in the article
// between a story intro and teaser carousels, an author box and breadcrumbs.
export const chefkochMagazinHtml = `<!DOCTYPE html><html lang="de"><head>
<title>Apfeltarte: Französisch backen | Chefkoch</title>
<meta property="og:title" content="Apfeltarte mit Marzipan">
<meta property="og:description" content="Mürbeteig, Marzipancreme und Apfelspalten mit Honigglasur.">
<meta property="og:image" content="https://img.chefkoch-cdn.de/magazin/apfeltarte.jpg">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"NewsArticle","headline":"Apfeltarte"},{"@type":"BreadcrumbList","itemListElement":[]}]}</script>
</head><body>
<nav><a href="/">Startseite</a> <a href="/magazin/">Magazin</a></nav>
<main><article>
<h1>Apfeltarte mit Marzipan</h1>
<p>Herbstzeit ist Kuchenzeit</p>
<h2>Französische Apfeltarte mit Marzipanfüllung</h2>
<p>Wenn es draußen kühler wird, duftet es in der Küche nach Äpfeln. Diese Tarte verbindet knusprigen Mürbeteig mit einer cremigen Füllung und dünnen Apfelspalten. Sie gelingt auch ohne viel Erfahrung und passt zu jedem Kaffeetisch am Sonntag.</p>
<ul>
<li><strong>Arbeitszeit</strong>: ca. 40 Min.</li>
<li><strong>Koch-/Backzeit</strong>: ca. 45 Min.</li>
<li><strong>Ruhezeit</strong>: ca. 30 Min.</li>
<li><strong>Gesamtzeit</strong>: ca. 1 Std. 55 Min.</li>
<li><strong>Schwierigkeitsgrad</strong>: normal</li>
</ul>
<h3>Zutaten für 12 Portionen</h3>
<p><strong>Für den Teig:</strong></p>
<ul><li>200 g Mehl</li><li>120 g Butter, kalt</li><li>1 Ei</li></ul>
<p><strong>Für den Belag:</strong></p>
<ul><li>150 g Marzipanrohmasse</li><li>4 Äpfel, sauer</li><li>2 EL Honig</li></ul>
<h3>Zubereitung</h3>
<ol>
<li>Mehl, Butter und Ei zu einem Teig verkneten und 30 Minuten kalt stellen.</li>
<li>Ofen auf 180 °C vorheizen, Teig ausrollen und die Form auslegen.</li>
<li>Marzipan cremig rühren, aufstreichen, Äpfel darauf legen und 30 Minuten backen.</li>
</ol>
<h2>Französische Finesse</h2>
<p>In Frankreich gehört diese Tarte zu den Klassikern der Pâtisserie. Statt Honig könnt ihr auch Aprikosenkonfitüre nehmen, und wer wenig Zeit hat, greift zu fertigem Blätterteig, den man vorher blind backt.</p>
<p><a href="https://www.chefkoch.de/rezepte/2/Apple-Crumble.html"><img src="https://img.chefkoch-cdn.de/teaser/crumble.jpg" alt=""></a></p>
<ul><li><h3>Apple Crumble</h3><a href="https://www.chefkoch.de/rezepte/2/Apple-Crumble.html">Zum Rezept</a></li></ul>
<p>Wie gefällt dir dieser Artikel?</p>
<h2>Das passt zu diesem Artikel</h2>
<p>Felix Beispiel, Redakteur. Gelernter Koch, der gern über Kuchen schreibt.</p>
</article></main>
<footer>Impressum</footer>
</body></html>`;
