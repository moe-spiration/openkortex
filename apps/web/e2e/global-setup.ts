import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { adminClient, deleteCreatedSince, type E2EUser } from "./support/admin";
import { LIVE, USER_FILE } from "./support/user";

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`e2e: ${name} is not set (apps/web/.env.local or the repo root .env.local)`);
  return v;
}

/**
 * Live run: the dedicated staging account (KORTEX_E2E_EMAIL / KORTEX_E2E_PASSWORD, created once
 * with `node e2e/support/staging-account.mjs`). Resolves its id by signing in, checks the
 * allowlist and removes leftovers of an aborted earlier run (rows newer than the last start).
 */
async function stagingUser(): Promise<E2EUser> {
  const email = need("KORTEX_E2E_EMAIL");
  const password = need("KORTEX_E2E_PASSWORD");
  const anon = createClient(need("NEXT_PUBLIC_SUPABASE_URL"), need("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error(`e2e: staging sign-in failed: ${error?.message ?? "no user"}`);
  // Workspace (folders, settings) exists before the cleanup boundary, so teardown never removes it.
  const { error: bErr } = await anon.schema("kortex").rpc("bootstrap_user");
  if (bErr) throw new Error(`e2e: staging bootstrap failed: ${bErr.message}`);
  await anon.auth.signOut();
  const id = data.user.id;
  const { data: allowed, error: aErr } = await adminClient()
    .from("allowed_users")
    .select("role")
    .eq("user_id", id)
    .maybeSingle();
  if (aErr) throw new Error(`e2e: allowlist lookup failed: ${aErr.message}`);
  if (!allowed) throw new Error("e2e: the staging account is not on the Kortex allowlist");
  if (allowed.role !== "member") throw new Error("e2e: the staging account must be a plain member");
  return { id, email, password, staging: true, since: new Date().toISOString() };
}

/** Creates ONE temporary confirmed user for the whole run (removed again in global-teardown). */
async function tempUser(): Promise<E2EUser> {
  const stamp = Date.now().toString(36);
  const email = `e2e-${stamp}@kortex-e2e.test`;
  const password = randomBytes(18).toString("base64url");
  const { data, error } = await adminClient().auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`e2e: createUser failed: ${error?.message}`);
  const user: E2EUser = { id: data.user.id, email, password };
  // Kortex is invite-only on the shared Supabase: the temp user must be on the allowlist.
  const { error: allowErr } = await adminClient()
    .from("allowed_users")
    .insert({ user_id: user.id, email, role: "member", note: "e2e temp user" });
  if (allowErr) throw new Error(`e2e: allowlist insert failed: ${allowErr.message}`);
  return user;
}

export default async function globalSetup() {
  const user = LIVE ? await stagingUser() : await tempUser();
  // A crashed earlier live run may have left content: the staging account holds none of its own.
  if (user.staging)
    await deleteCreatedSince(user.id, "2000-01-01T00:00:00Z", ["knowledge_items", "action_items", "ingest_jobs", "api_tokens"]);
  mkdirSync(dirname(USER_FILE), { recursive: true });
  writeFileSync(USER_FILE, JSON.stringify(user));
}
