import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import pkg from "../package.json" with { type: "json" };
import { registerTools, type ToolContext } from "./tools";
import { brand } from "@kortex/i18n";

const INSTRUCTIONS = brand(
  "Kortex is the user's AI-native second brain (Markdown knowledge items, folders, tags, domain objects, tasks). " +
  "Search with brain_search before answering from memory, read with brain_get_item, and save durable knowledge with brain_save_item. " +
  "Call brain_log_agent_memory at the end of a significant session. All content is Markdown. " +
  'Before saving or organizing, read the agents guide once (brain_get_item with id "agents.md", or the resource kortex://agents.md): ' +
  "vault folders, routing rules, domain objects and the user's folder index.",
);

export function createMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer(
    { name: "kortex-brain", version: pkg.version },
    { instructions: INSTRUCTIONS },
  );
  registerTools(server, ctx);
  return server;
}

/** Serves one MCP session over stdin/stdout. Never write to stdout elsewhere: it is the protocol channel. */
export async function runStdio(ctx: ToolContext): Promise<McpServer> {
  const server = createMcpServer(ctx);
  await server.connect(new StdioServerTransport());
  return server;
}
