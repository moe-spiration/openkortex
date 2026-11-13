import { describe, expect, it } from "vitest";
import { DOMAIN_OBJECT_FOLDERS, DOMAIN_OBJECT_TYPES, SYSTEM_FOLDER_PATHS } from "@kortex/db";
import {
  MAX_ROUTING_GUIDE_CHARS,
  renderOrganizerPrompt,
  routingGuideFromAgentsGuide,
} from "@kortex/ai-core";
import { renderAgentsGuide, TOOL_GUIDE } from "../src/agents-guide";

// G6b: the organizer gets the routing part of the real agents guide.
describe("routing guide for the organizer", () => {
  const guide = routingGuideFromAgentsGuide(renderAgentsGuide({ heading: false }));

  it("holds every folder, the routing rules and the object folders", () => {
    expect(guide).toContain("## Vault structure");
    expect(guide).toContain("## Routing rules");
    expect(guide).toContain("## Domain objects");
    for (const f of SYSTEM_FOLDER_PATHS) expect(guide).toContain(`\`${f}\``);
    for (const t of DOMAIN_OBJECT_TYPES) expect(guide).toContain(`\`${DOMAIN_OBJECT_FOLDERS[t]}\``);
    expect(guide).toContain("is_manual_placement = true");
  });

  it("leaves out tools, frontmatter and access paths and stays short", () => {
    expect(guide).not.toContain("## MCP tools");
    expect(guide).not.toContain("## Frontmatter");
    expect(guide).not.toContain("Access paths");
    // Tool names appear in the routing rules, but not the tool examples.
    for (const t of TOOL_GUIDE) expect(guide).not.toContain(JSON.stringify(t.example));
    expect(guide.length).toBeLessThan(MAX_ROUTING_GUIDE_CHARS);
  });

  it("goes into the organizer prompt in full", () => {
    const prompt = renderOrganizerPrompt({
      existingClusters: [],
      existingTags: [],
      existingObjects: [],
      manualPlacement: false,
      routingGuide: guide,
    });
    expect(prompt).toContain(`<routing_guide>\n${guide}\n</routing_guide>`);
  });
});
