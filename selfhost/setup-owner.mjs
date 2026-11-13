// First start of a self-hosted Kortex: creates the owner account and puts it on the allowlist.
// Runs inside the compose stack (service "setup"), is safe to run again, and never changes an
// account that already exists.
const need = (name) => {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`setup: ${name} is not set (run selfhost/init.mjs, see selfhost/README.md)`);
    process.exit(1);
  }
  return v;
};

const authUrl = need("AUTH_URL");
const restUrl = need("REST_URL");
const key = need("SERVICE_ROLE_KEY");
const userId = need("KORTEX_USER_ID");
const email = need("KORTEX_OWNER_EMAIL").toLowerCase();
const password = process.env.KORTEX_OWNER_PASSWORD?.trim();

const auth = { authorization: `Bearer ${key}`, apikey: key, "content-type": "application/json" };

async function call(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  return { status: res.status, ok: res.ok, text };
}

const existing = await call(`${authUrl}/admin/users/${userId}`, { headers: auth });
if (existing.ok) {
  console.log("setup: owner account exists, left unchanged");
} else if (existing.status === 404) {
  if (!password) {
    console.error("setup: KORTEX_OWNER_PASSWORD is needed to create the owner account");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("setup: KORTEX_OWNER_PASSWORD needs at least 8 characters");
    process.exit(1);
  }
  const created = await call(`${authUrl}/admin/users`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ id: userId, email, password, email_confirm: true }),
  });
  if (!created.ok) {
    console.error(
      `setup: creating the owner account failed (${created.status}): ${created.text.slice(0, 300)}`,
    );
    process.exit(1);
  }
  console.log(`setup: owner account created for ${email}`);
} else {
  console.error(`setup: Supabase Auth answered ${existing.status}: ${existing.text.slice(0, 300)}`);
  process.exit(1);
}

const allowed = await call(`${restUrl}/allowed_users?on_conflict=user_id`, {
  method: "POST",
  headers: {
    ...auth,
    "content-profile": "kortex",
    prefer: "resolution=ignore-duplicates,return=minimal",
  },
  body: JSON.stringify({
    user_id: userId,
    email,
    role: "owner",
    note: "owner of this installation (selfhost setup)",
  }),
});
if (!allowed.ok) {
  console.error(`setup: allowlist entry failed (${allowed.status}): ${allowed.text.slice(0, 300)}`);
  process.exit(1);
}
console.log("setup: owner is on the allowlist");
