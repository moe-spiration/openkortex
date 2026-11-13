import { AppMark, Card } from "@kortex/ui";
import { dataSource } from "@/lib/supabase/config";
import { getSession } from "@/lib/supabase/server";
import { t } from "@/i18n";
import { enterRequestLocale } from "@/i18n/server";
import { requestLocale } from "@/app/request-locale";

export async function generateMetadata() {
  enterRequestLocale(await requestLocale());
  return { title: t("No access") };
}
export const dynamic = "force-dynamic";

/*
 * S2a: shown to accounts that signed up on the (shared, open) Supabase instance but are not on the
 * Kortex allowlist (kortex.allowed_users). Only existing @kortex/ui primitives and kx-* classes.
 */
export default async function NoAccessPage() {
  enterRequestLocale(await requestLocale());
  const session = dataSource() === "supabase" ? await getSession() : null;
  const email = session?.user.email;
  // One sentence with the address in bold: split the translated text at the placeholder.
  const [before = "", after = ""] = t("The account {email} has not been approved for Kortex.").split("{email}");
  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 16, background: "var(--bg-app-shell)" }}>
      <Card padded style={{ width: "100%", maxWidth: 420, display: "grid", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <AppMark size={28} />
          <strong className="kx-body" style={{ fontWeight: 500 }}>
            Kortex
          </strong>
        </div>
        <h1 className="kx-h-page" style={{ margin: 0 }}>
          {t("No access")}
        </h1>
        <p className="kx-body" style={{ margin: 0 }}>
          {email ? (
            <>
              {before}
              <strong>{email}</strong>
              {after}
            </>
          ) : (
            t("This account has not been approved for Kortex.")
          )}{" "}
          {t("Kortex is invite-only. Ask the operator to approve you.")}
        </p>
        <p className="kx-help" style={{ margin: 0 }}>
          {t("For the operator:")} <span className="kx-mono">pnpm --filter @kortex/db db:allow -- {email ?? "<e-mail>"}</span>
        </p>
        <a className="kx-btn kx-btn--secondary" href="/auth/logout" style={{ justifySelf: "start" }}>
          {t("Sign out")}
        </a>
      </Card>
    </main>
  );
}
