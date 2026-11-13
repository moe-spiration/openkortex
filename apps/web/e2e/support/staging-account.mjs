// One-time setup of the dedicated e2e staging account for `pnpm e2e:live`.
//
//   node e2e/support/staging-account.mjs [--email kortex-e2e@<domain>] [--env <file> ...]
//
// Creates a confirmed account through the Supabase admin API (service role from apps/web/.env.local),
// puts it on the Kortex allowlist as a plain member, bootstraps its workspace and appends
// KORTEX_E2E_EMAIL / KORTEX_E2E_PASSWORD to each --env file (default apps/web/.env.local).
// The password is random and never printed. Re-running with an existing account only checks the
// allowlist and leaves the stored credentials alone.
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const webEnv = resolve(web, ".env.local");
if (existsSync(webEnv)) process.loadEnvFile(webEnv);

const args = process.argv.slice(2);
const flag = (name) => {
  const out = [];
  args.forEach((a, i) => a === name && args[i + 1] && out.push(args[i + 1]));
  return out;
};
const need = (name) => {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is not set (apps/web/.env.local)`);
  return v;
};

const instanceFile = resolve(web, "../../kortex.instance.json");
const instanceEmail = existsSync(instanceFile) ? JSON.parse(readFileSync(instanceFile, "utf8")).e2eEmail : undefined;
const email = (flag("--email")[0] ?? process.env.KORTEX_E2E_EMAIL ?? instanceEmail ?? "").toLowerCase();
if (!email) throw new Error("no account: pass --email or set KORTEX_E2E_EMAIL (apps/web/.env.local)");
const envFiles = flag("--env").map((f) => resolve(f));
if (envFiles.length === 0) envFiles.push(webEnv);

const admin = createClient(need("NEXT_PUBLIC_SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
  db: { schema: "kortex" },
});

async function findUser() {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

let user = await findUser();
let password = null;
if (!user) {
  password = randomBytes(24).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { kortex_role: "e2e-staging" },
  });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  user = data.user;
  console.log(`Created staging account ${email}.`);
} else {
  console.log(`Staging account ${email} exists; credentials are not changed.`);
}

const { error: allowErr } = await admin
  .from("allowed_users")
  .upsert({ user_id: user.id, email, role: "member", note: "e2e staging account (pnpm e2e:live)" }, { onConflict: "user_id" });
if (allowErr) throw new Error(`allowlist: ${allowErr.message}`);
console.log("On the Kortex allowlist as member.");

if (password) {
  // Bootstrap as the user (folders, settings) so the first live run starts from a full workspace.
  const anon = createClient(need("NEXT_PUBLIC_SUPABASE_URL"), need("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: sErr } = await anon.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error(`sign-in: ${sErr.message}`);
  const { error: bErr } = await anon.schema("kortex").rpc("bootstrap_user");
  if (bErr) throw new Error(`bootstrap: ${bErr.message}`);
  await anon.auth.signOut();

  for (const file of envFiles) {
    const text = existsSync(file) ? readFileSync(file, "utf8") : "";
    if (/^KORTEX_E2E_PASSWORD=/m.test(text)) {
      console.warn(`${file} already has KORTEX_E2E_PASSWORD: not changed (replace it by hand).`);
      continue;
    }
    const lead = text && !text.endsWith("\n") ? "\n" : "";
    appendFileSync(
      file,
      `${lead}\n# e2e staging account for pnpm e2e:live (allowlisted member, created ${new Date().toISOString().slice(0, 10)})\nKORTEX_E2E_EMAIL=${email}\nKORTEX_E2E_PASSWORD=${password}\n`,
    );
    console.log(`Credentials written to ${file}.`);
  }
}
