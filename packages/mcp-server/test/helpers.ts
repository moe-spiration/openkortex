import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { InMemoryBrainRepository } from "../src/memory-repository";
import { createMcpServer } from "../src/server";
import type { Embedder, ItemEnricher } from "../src/repository";

export const FIXED_NOW = new Date("2026-10-23T09:30:00.000Z");

export async function connect(opts: { embedder?: Embedder; enricher?: ItemEnricher } = {}) {
  const repo = new InMemoryBrainRepository(() => FIXED_NOW);
  const server = createMcpServer({ repo, now: () => FIXED_NOW, ...opts });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    repo,
    client,
    call: (name: string, args: Record<string, unknown>) => callTool(client, name, args),
    close: () => client.close(),
  };
}

export async function callTool(client: Client, name: string, args: Record<string, unknown>) {
  let res: CallToolResult;
  try {
    res = (await client.callTool({ name, arguments: args })) as CallToolResult;
  } catch (e) {
    // Older SDK paths reject invalid arguments with a protocol error instead of an isError result.
    return { isError: true, text: (e as Error).message, json: undefined as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  }
  const block = res.content[0];
  const text = block?.type === "text" ? block.text : "";
  return {
    isError: res.isError === true,
    text,
    /** Parsed JSON payload of a successful call. */
    json: (res.isError ? undefined : JSON.parse(text)) as any, // eslint-disable-line @typescript-eslint/no-explicit-any
  };
}
