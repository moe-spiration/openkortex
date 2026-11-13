"use server";

import { t } from "@/i18n";
import { runAction, type ActionResult } from "./run";

/*
 * Settings → Zugang: the Kortex allowlist for owners/admins. Everything runs as the signed-in user
 * through security-definer RPCs (migration 20261030010000) that check the caller's role; the web
 * app never needs the service role for this. `pnpm --filter @kortex/db db:allow` stays the CLI path.
 */

export type AccessRole = "owner" | "admin" | "member";

export interface AccessEntry {
  email: string;
  role: AccessRole;
  /** member = account exists and is allowlisted; invited = waits for signup with that email. */
  status: "member" | "invited";
  invitedAt: string;
  isSelf: boolean;
}

export interface AccessListing {
  /** Role of the caller; only owner/admin get `entries`. */
  role: AccessRole | null;
  entries: AccessEntry[];
}

const ROLES: readonly AccessRole[] = ["owner", "admin", "member"];

export async function listAccess(): Promise<ActionResult<AccessListing>> {
  return runAction("access list", async ({ client, userId }) => {
    const { data: own, error: ownErr } = await client
      .from("allowed_users")
      .select("role")
      .eq("user_id", userId)
      .maybeSingle();
    if (ownErr) throw new Error(ownErr.message);
    const role = (own?.role ?? null) as AccessRole | null;
    if (role !== "owner" && role !== "admin") return { role, entries: [] };
    const { data, error } = await client.rpc("access_list");
    if (error) throw new Error(error.message);
    const entries = (data ?? []).map((r) => ({
      email: r.email,
      role: r.role as AccessRole,
      status: r.status as AccessEntry["status"],
      invitedAt: r.invited_at,
      isSelf: r.is_self,
    }));
    return { role, entries };
  });
}

/** Adds (or changes the role of) an email. Returns whether it is a member now or a pending invite. */
export async function inviteAccess(
  email: string,
  role: AccessRole,
): Promise<ActionResult<{ status: "member" | "invited" }>> {
  return runAction("access invite", async ({ client }) => {
    const clean = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new Error(t("Invalid email address"));
    if (!ROLES.includes(role)) throw new Error(t("Invalid role"));
    const { data, error } = await client.rpc("access_invite", { p_email: clean, p_role: role });
    if (error) throw new Error(error.message.replace(/^kortex: /, ""));
    return { status: data === "member" ? "member" : "invited" };
  });
}

export async function removeAccess(email: string): Promise<ActionResult<{ removed: boolean }>> {
  return runAction("access remove", async ({ client }) => {
    const { data, error } = await client.rpc("access_remove", { p_email: email.trim().toLowerCase() });
    if (error) throw new Error(error.message.replace(/^kortex: /, ""));
    return { removed: data === true };
  });
}
