// Handwritten responses in the shape of Jina Reader (JSON mode) and Firecrawl /v1/scrape.

const articleMd = `# Model Context Protocol erklärt



Das **Model Context Protocol (MCP)** ist ein offener Standard von Anthropic, mit dem KI-Agenten auf Werkzeuge und Daten zugreifen.

## Warum MCP?

Bisher brauchte jede Integration eigenen Glue-Code. MCP definiert Server, die Tools, Ressourcen und Prompts bereitstellen.

## Fazit

Für Second-Brain-Systeme wie Obsidian oder Kortex ist MCP der naheliegende Weg, Wissen für Agenten zu öffnen.`;

export const jinaResponse = {
  code: 200,
  status: 20000,
  data: {
    title: "Model Context Protocol erklärt",
    description: "Was MCP ist und warum es wichtig wird.",
    url: "https://www.heise.de/hintergrund/mcp-erklaert-1234.html",
    content: articleMd,
    publishedTime: "2026-10-01T08:00:00+02:00",
    metadata: {
      "og:image": "https://heise.cloudimg.io/mcp.jpg",
      "og:site_name": "heise online",
      lang: "de",
    },
  },
};

export const firecrawlResponse = {
  success: true,
  data: {
    markdown: articleMd,
    metadata: {
      title: "MCP erklärt (Firecrawl)",
      description: "Was MCP ist.",
      ogImage: "https://heise.cloudimg.io/og.jpg",
      sourceURL: "https://www.heise.de/hintergrund/mcp-erklaert-1234.html",
      language: "de",
      statusCode: 200,
    },
  },
};
