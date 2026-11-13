import { describe, expect, it } from "vitest";
import { DOMAIN_OBJECT_FOLDERS, SYSTEM_FOLDER_PATHS } from "@kortex/db";
import { renderAgentsGuide } from "@kortex/mcp-server/agents-guide";
import { copilotSystemPrompt } from "../chat/prompts";
import {
  isRoutingQuestion,
  pickSections,
  routingContext,
  routingGuide,
} from "../chat/routing-guide";

describe("G6b routing context for the copilot", () => {
  it.each([
    "Wo lege ich eine neue Person ab?",
    "Wo finde ich meine Meeting-Protokolle?",
    "Wie lege ich ein Rezept ab?",
    "Wohin gehört ein PDF-Buch?",
    "In welchen Ordner kommt ein Projekt?",
    "Wo ist mein Tagebuch von gestern?",
    "Where should I put a ChatGPT export?",
    "Which folder holds my web clips?",
  ])("recognises a routing question: %s", (q) => {
    expect(isRoutingQuestion(q)).toBe(true);
  });

  it.each([
    "Wie lautet der Kortex-E2E-Testcode?",
    "Fasse das Meeting von gestern zusammen.",
    "Was sind die offenen Punkte zum Sync?",
    "Explain the pricing decision.",
  ])("leaves other questions alone: %s", (q) => {
    expect(isRoutingQuestion(q)).toBe(false);
  });

  it("takes only the routing sections of the agents guide", () => {
    const guide = routingGuide();
    expect(guide).toMatch(/^## Vault structure/);
    expect(guide).toContain("## Routing rules");
    expect(guide).toContain("## Domain objects");
    expect(guide).not.toContain("## Frontmatter");
    expect(guide).not.toContain("## MCP tools");
    expect(guide).not.toContain("## Conventions");
    // Every system folder and every object folder is named, straight from the code constants.
    for (const f of SYSTEM_FOLDER_PATHS) expect(guide).toContain(`\`${f}\``);
    for (const f of Object.values(DOMAIN_OBJECT_FOLDERS)) expect(guide).toContain(`\`${f}\``);
    // Short: well under half of the full guide.
    expect(guide.length).toBeLessThan(renderAgentsGuide().length / 2);
    expect(routingGuide()).toBe(guide); // cached
  });

  it("pickSections matches title prefixes and keeps order", () => {
    const md = "intro\n\n## A one\n\na\n\n## B\n\nb\n\n## C two\n\nc\n";
    expect(pickSections(md, ["C", "A"])).toBe("## A one\n\na\n\n## C two\n\nc");
  });

  it("adds the routing block and source folders only for routing questions", () => {
    const citations = [
      {
        n: 1,
        item_id: "a1",
        title: "Anna Schmidt",
        type: "person",
        page_or_timestamp: null,
        folder_path: "70_Objects/People",
        source_url: null,
        snippet: "CTO bei Acme",
      },
    ];
    const plain = copilotSystemPrompt("brain", citations, "2026-10-31");
    expect(plain).not.toContain("Ablage-Wissen");
    expect(plain).toContain("[1] Anna Schmidt (person)\nOrdner: 70_Objects/People\nCTO bei Acme");

    const routed = copilotSystemPrompt("brain", citations, "2026-10-31", { routing: true });
    expect(routed).toContain(routingContext());
    expect(routed).toContain("| `person` | `70_Objects/People` |");
    expect(routed.indexOf("Ablage-Wissen")).toBeLessThan(routed.indexOf("Quellen:"));
  });
});
