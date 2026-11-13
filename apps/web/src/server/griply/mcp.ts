import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { McpPort } from "./service";

/* The real MCP side of the Griply connection: the SDK's OAuth helper and a short-lived client per call. */

const TIMEOUT_MS = 20_000;

async function withClient<T>(serverUrl: string, provider: OAuthClientProvider, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: "kortex", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(serverUrl), { authProvider: provider });
  await client.connect(transport, { timeout: TIMEOUT_MS });
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

export const sdkMcpPort: McpPort = {
  auth: (provider, options) => auth(provider, options),
  tools: (serverUrl, provider) => withClient(serverUrl, provider, async (c) => (await c.listTools(undefined, { timeout: TIMEOUT_MS })).tools.map((x) => x.name)),
  call: (serverUrl, provider, name, args) => withClient(serverUrl, provider, (c) => c.callTool({ name, arguments: args }, undefined, { timeout: TIMEOUT_MS })),
};
