import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { callTool } from "./helpers";

// Spawns the real entry point to prove the stdio channel carries nothing but protocol messages.
describe("stdio entry point", () => {
  it("serves the tools over stdin/stdout", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "src/cli.ts"],
      env: { PATH: process.env.PATH ?? "", KORTEX_BACKEND: "memory" },
      stderr: "pipe",
    });
    const client = new Client({ name: "stdio-test", version: "1.0.0" });
    await client.connect(transport);
    try {
      expect((await client.listTools()).tools).toHaveLength(6);
      const saved = await callTool(client, "brain_save_item", {
        title: "Over stdio",
        content_md: "hi",
      });
      expect(saved.json.folder_path).toBe("00_Inbox");
    } finally {
      await client.close();
    }
  }, 30_000);
});
