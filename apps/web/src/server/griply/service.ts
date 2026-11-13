import { randomBytes } from "node:crypto";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { PRODUCT_NAME, t } from "@/i18n";
import {
  cleanServerUrl,
  createdTaskId,
  griplyTaskInput,
  nextCursor,
  parseHierarchy,
  toolErrorText,
  toolJson,
  type GriplyOverview,
  type HandoverTask,
} from "@/lib/griply";

/*
 * The Griply connection (docs/griply.md). Kortex is an OAuth client of the user's Griply MCP server:
 * the user pastes the server address, signs in at Griply and chooses there what Kortex may do (read,
 * or read and change). Tokens stay on the server (kortex.external_connections.secrets, service role).
 * Everything outside (the table, the MCP calls) is behind two small seams, so the tests run without
 * network.
 */

export interface GriplySecrets {
  client?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  verifier?: string;
  state?: string;
  redirect?: string;
}

export interface ConnectionRow {
  server_url: string;
  status: "pending" | "connected";
  access: "read" | "write" | null;
  secrets: GriplySecrets;
  connected_at: string | null;
}

export interface ConnectionStore {
  read(userId: string): Promise<ConnectionRow | null>;
  save(userId: string, row: ConnectionRow): Promise<void>;
  remove(userId: string): Promise<void>;
}

/** The MCP side: sign-in steps and tool calls. The real one wraps the MCP SDK (mcp.ts). */
export interface McpPort {
  auth(provider: OAuthClientProvider, options: { serverUrl: string; authorizationCode?: string }): Promise<"AUTHORIZED" | "REDIRECT">;
  tools(serverUrl: string, provider: OAuthClientProvider): Promise<string[]>;
  call(serverUrl: string, provider: OAuthClientProvider, name: string, args: Record<string, unknown>): Promise<unknown>;
}

export interface GriplyIo {
  store: ConnectionStore;
  mcp: McpPort;
  now(): Date;
}

export interface GriplyStatus {
  state: "off" | "pending" | "connected";
  serverUrl: string | null;
  access: "read" | "write" | null;
  connectedAt: string | null;
}

export const CALLBACK_PATH = "/api/connections/griply/callback";

/** OAuth client state of one user, kept in the connection row. */
class RowProvider implements OAuthClientProvider {
  authorizationUrl: URL | undefined;
  constructor(
    private readonly io: GriplyIo,
    private readonly userId: string,
    readonly row: ConnectionRow,
  ) {}
  private persist() {
    return this.io.store.save(this.userId, this.row);
  }
  get redirectUrl() {
    return this.row.secrets.redirect;
  }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: PRODUCT_NAME,
      redirect_uris: this.row.secrets.redirect ? [this.row.secrets.redirect] : [],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }
  state() {
    return this.row.secrets.state ?? "";
  }
  clientInformation() {
    return this.row.secrets.client;
  }
  async saveClientInformation(client: OAuthClientInformationMixed) {
    this.row.secrets.client = client;
    await this.persist();
  }
  tokens() {
    return this.row.secrets.tokens;
  }
  async saveTokens(tokens: OAuthTokens) {
    this.row.secrets.tokens = tokens;
    await this.persist();
  }
  redirectToAuthorization(url: URL) {
    this.authorizationUrl = url;
  }
  async saveCodeVerifier(verifier: string) {
    this.row.secrets.verifier = verifier;
    await this.persist();
  }
  codeVerifier() {
    return this.row.secrets.verifier ?? "";
  }
  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    if (scope === "all" || scope === "client") delete this.row.secrets.client;
    if (scope === "all" || scope === "tokens") delete this.row.secrets.tokens;
    if (scope === "all" || scope === "verifier") delete this.row.secrets.verifier;
    await this.persist();
  }
}

const statusOf = (row: ConnectionRow | null): GriplyStatus =>
  row
    ? { state: row.status, serverUrl: row.server_url, access: row.access, connectedAt: row.connected_at }
    : { state: "off", serverUrl: null, access: null, connectedAt: null };

export async function griplyStatus(io: GriplyIo, userId: string): Promise<GriplyStatus> {
  return statusOf(await io.store.read(userId));
}

/** What the user allowed, read off the tools the server offers this sign-in. */
async function detectAccess(io: GriplyIo, provider: RowProvider): Promise<"read" | "write"> {
  const names = await io.mcp.tools(provider.row.server_url, provider);
  return names.includes("create_tasks") ? "write" : "read";
}

async function markConnected(io: GriplyIo, userId: string, provider: RowProvider): Promise<GriplyStatus> {
  const row = provider.row;
  row.access = await detectAccess(io, provider).catch(() => "read" as const);
  row.status = "connected";
  row.connected_at = io.now().toISOString();
  delete row.secrets.verifier;
  delete row.secrets.state;
  await io.store.save(userId, row);
  overviewCache.delete(userId);
  return statusOf(row);
}

/**
 * Step 1: remember the server address and get the address of Griply's sign-in page. `origin` is the
 * address of this Kortex (the sign-in comes back to `origin + CALLBACK_PATH`).
 */
export async function startGriplyConnect(io: GriplyIo, userId: string, input: string, origin: string): Promise<{ url: string | null; status: GriplyStatus }> {
  const serverUrl = cleanServerUrl(input);
  if (!serverUrl) throw new Error(t("That is not a server address. Copy it in Griply under Settings > Integrations > MCP server (it starts with https://)."));
  const redirect = `${origin.replace(/\/+$/, "")}${CALLBACK_PATH}`;
  const old = await io.store.read(userId);
  // The same server and the same way back: keep the registration, so Griply lists Kortex only once.
  const client = old && old.server_url === serverUrl && old.secrets.redirect === redirect ? old.secrets.client : undefined;
  const row: ConnectionRow = {
    server_url: serverUrl,
    status: "pending",
    access: null,
    connected_at: null,
    secrets: { redirect, state: randomBytes(24).toString("base64url"), ...(client ? { client } : {}) },
  };
  await io.store.save(userId, row);
  overviewCache.delete(userId);
  const provider = new RowProvider(io, userId, row);
  const result = await io.mcp.auth(provider, { serverUrl });
  if (result === "AUTHORIZED") return { url: null, status: await markConnected(io, userId, provider) };
  if (!provider.authorizationUrl) throw new Error(t("Griply did not answer with a sign-in page."));
  return { url: provider.authorizationUrl.toString(), status: statusOf(row) };
}

/** Step 2: Griply sent the user back with a code. */
export async function finishGriplyConnect(io: GriplyIo, userId: string, code: string, state: string): Promise<GriplyStatus> {
  const row = await io.store.read(userId);
  if (!row || row.status !== "pending" || !row.secrets.state || row.secrets.state !== state || !code) {
    throw new Error(t("This sign-in is no longer valid. Start it again in the settings."));
  }
  const provider = new RowProvider(io, userId, row);
  const result = await io.mcp.auth(provider, { serverUrl: row.server_url, authorizationCode: code });
  if (result !== "AUTHORIZED") throw new Error(t("Griply did not complete the sign-in."));
  return markConnected(io, userId, provider);
}

export async function disconnectGriply(io: GriplyIo, userId: string): Promise<GriplyStatus> {
  await io.store.remove(userId);
  overviewCache.delete(userId);
  return statusOf(null);
}

const isUnauthorized = (err: unknown) => err instanceof Error && (err.name === "UnauthorizedError" || /unauthorized|invalid_grant|invalid_token/i.test(err.message));

/** One tool call as the connected user. A sign-in that no longer works sets the connection back to "sign in again". */
async function call(io: GriplyIo, userId: string, name: string, args: Record<string, unknown>, need?: "write"): Promise<unknown> {
  const row = await io.store.read(userId);
  if (!row || row.status !== "connected") throw new Error(t("Griply is not connected. Connect it under Settings > Connectors."));
  if (need === "write" && row.access !== "write") {
    throw new Error(t("Griply allows Kortex to read only. Connect again and choose “Read and change” there."));
  }
  const provider = new RowProvider(io, userId, row);
  try {
    const result = await io.mcp.call(row.server_url, provider, name, args);
    const failed = toolErrorText(result);
    if (failed) throw new Error(t("Griply answered with an error: {error}", { error: failed.slice(0, 300) }));
    return result;
  } catch (err) {
    if (!isUnauthorized(err)) throw err;
    row.status = "pending";
    delete row.secrets.tokens;
    await io.store.save(userId, row);
    overviewCache.delete(userId);
    throw new Error(t("The sign-in at Griply has expired. Connect again under Settings > Connectors."));
  }
}

const OVERVIEW_TTL_MS = 5 * 60_000;
const MAX_PAGES = 6;
const overviewCache = new Map<string, { at: number; data: GriplyOverview }>();

/** Life areas with their open goals, projects and habits; cached per user for five minutes. */
export async function griplyOverview(io: GriplyIo, userId: string, fresh = false): Promise<GriplyOverview> {
  const hit = overviewCache.get(userId);
  if (!fresh && hit && io.now().getTime() - hit.at < OVERVIEW_TTL_MS) return hit.data;
  const pages: unknown[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = toolJson(await call(io, userId, "get_hierarchy", cursor ? { cursor } : {}));
    pages.push(page);
    cursor = nextCursor(page);
    if (!cursor) break;
  }
  const data = parseHierarchy(pages);
  overviewCache.set(userId, { at: io.now().getTime(), data });
  return data;
}

/** Creates the task in Griply and returns its id there. Sending the same task twice returns the first one. */
export async function handOverToGriply(io: GriplyIo, userId: string, task: HandoverTask, link?: { lifeAreaId?: string }): Promise<string> {
  const input = { ...griplyTaskInput(task), ...(link?.lifeAreaId ? { lifeAreaId: link.lifeAreaId } : {}) };
  const made = createdTaskId(await call(io, userId, "create_tasks", { tasks: [input] }, "write"));
  if ("error" in made) throw new Error(t("Griply did not create the task: {error}", { error: made.error.slice(0, 300) }));
  return made.id;
}

/** Tests only. */
export function clearGriplyCache(): void {
  overviewCache.clear();
}
