import { describe, expect, it } from "vitest";
import { organize, type Enrichment, type OrganizerContext } from "../src/enrichment/auto-organizer";
import {
  MAX_ROUTING_GUIDE_CHARS,
  renderOrganizerPrompt,
  routingGuideFromAgentsGuide,
} from "../src/prompts/organizer";
import { mockModel } from "./helpers";

// Shape of renderAgentsGuide({ heading: false }) from @kortex/mcp-server, shortened.
const agentsGuide = [
  "Kortex is the user's AI-native second brain.",
  "",
  "Access paths:",
  "",
  "- **MCP server** (`kortex-brain`): remote …",
  "",
  "## Vault structure",
  "",
  "| Folder | Holds | Item types |",
  "| --- | --- | --- |",
  "| `00_Inbox` | Unsorted captures. | any |",
  "| `70_Objects/People` | People. | person |",
  "",
  "## Routing rules (what goes where)",
  "",
  "1. A person, project, organization, concept, tool, asset or goal is a domain object: write it into its `70_Objects/<Type>/` folder.",
  "2. `is_manual_placement = true` is final: never move such items.",
  "",
  "## Item types",
  "",
  "`note`, `article`",
  "",
  "## Domain objects",
  "",
  "| Type | Folder | `metadata` fields |",
  "| --- | --- | --- |",
  "| `person` | `70_Objects/People` | `role`, `organization` |",
  "",
  "## MCP tools",
  "",
  '- **`brain_search`**: Find items first.',
  "",
].join("\n");

const ctx: OrganizerContext = {
  existingTags: ["people/team"],
  existingClusters: [],
  existingObjects: [],
};

const promptVars = {
  existingClusters: [],
  existingTags: ["people/team"],
  existingObjects: [],
  manualPlacement: false,
};

const answer: Enrichment = {
  title: "Sven Krüger",
  summary: "Sven ist CTO bei Acme und betreut die Deepgram-Anbindung.",
  key_points: [],
  cluster_name: null,
  suggested_folder_path: "70_Objects/People",
  placement_confidence: 0.9,
  tags: ["people/team", "acme"],
  entities: [{ name: "Sven Krüger", type: "person" }],
  action_items: [],
};

const note = {
  type: "note" as const,
  sourcePlatform: "manual",
  contentMd: "# Sven Krüger\n\nCTO bei Acme, kümmert sich um Deepgram.",
  isManualPlacement: false,
};

const systemOf = (model: ReturnType<typeof mockModel>) =>
  JSON.stringify(model.doGenerateCalls[0]?.prompt.filter((m) => m.role === "system"));

describe("routingGuideFromAgentsGuide (G6b)", () => {
  it("keeps only vault structure, routing rules and domain objects", () => {
    const guide = routingGuideFromAgentsGuide(agentsGuide);
    expect(guide.startsWith("## Vault structure")).toBe(true);
    expect(guide).toContain("## Routing rules (what goes where)");
    expect(guide).toContain("## Domain objects");
    expect(guide).toContain("`70_Objects/People`");
    expect(guide).not.toContain("## MCP tools");
    expect(guide).not.toContain("## Item types");
    expect(guide).not.toContain("Access paths");
  });

  it("returns an empty string for text without those sections and caps the length", () => {
    expect(routingGuideFromAgentsGuide("# Something else\n\nNo guide here.")).toBe("");
    const long = `## Routing rules\n\n${"- rule\n".repeat(5_000)}`;
    expect(routingGuideFromAgentsGuide(long).length).toBeLessThanOrEqual(MAX_ROUTING_GUIDE_CHARS);
  });
});

describe("organizer prompt with routing guide (G6b)", () => {
  it("is unchanged without a guide (also for an empty one)", () => {
    const plain = renderOrganizerPrompt(promptVars);
    expect(plain).not.toContain("Vault routing guide");
    expect(plain).not.toContain("<routing_guide>");
    expect(plain.endsWith("\n\nReturn only the JSON object.")).toBe(true);
    expect(renderOrganizerPrompt({ ...promptVars, routingGuide: "  " })).toBe(plain);
  });

  it("adds the guide block before the closing line", () => {
    const guide = routingGuideFromAgentsGuide(agentsGuide);
    const prompt = renderOrganizerPrompt({ ...promptVars, routingGuide: guide });
    expect(prompt).toContain(`<routing_guide>\n${guide}\n</routing_guide>`);
    expect(prompt).toContain('"70_Objects/<Type>" folder');
    expect(prompt.endsWith("</routing_guide>\n\nReturn only the JSON object.")).toBe(true);
    // Everything before the block is the old prompt.
    const plain = renderOrganizerPrompt(promptVars);
    expect(prompt.startsWith(plain.replace("Return only the JSON object.", ""))).toBe(true);
  });
});

describe("organize with routing guide (G6b)", () => {
  it("without a guide sends the old prompt", async () => {
    const model = mockModel(answer);
    await organize(note, ctx, { model });
    const system = systemOf(model);
    expect(system).not.toContain("routing_guide");
    expect(system).toContain("Return only the JSON object.");
  });

  it("with a guide sends the routing rules and files a person note into 70_Objects/People", async () => {
    const model = mockModel(answer);
    const guide = routingGuideFromAgentsGuide(agentsGuide);
    const out = await organize(note, { ...ctx, routingGuide: guide }, { model });

    const system = systemOf(model);
    expect(system).toContain("<routing_guide>");
    expect(system).toContain("domain object: write it into its `70_Objects/<Type>/` folder");
    expect(system).toContain("never move such items");
    expect(system).not.toContain("brain_search");

    expect(out.folderPath).toBe("70_Objects/People");
    expect(out.placementConfidence).toBe(0.9);
    expect(out.tags).toContain("people/team");
  });

  it("still keeps a manual placement, guide or not", async () => {
    const model = mockModel(answer);
    const out = await organize(
      { ...note, isManualPlacement: true },
      { ...ctx, routingGuide: routingGuideFromAgentsGuide(agentsGuide) },
      { model },
    );
    expect(out.folderPath).toBeNull();
    expect(systemOf(model)).toContain("Manual placement active: yes");
  });
});
