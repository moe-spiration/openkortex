"use client";

import { useActionState, useState } from "react";
import { AppMark, Button, Card } from "@kortex/ui";
import { PRODUCT_NAME, msg, t } from "@/i18n";
import { sendMagicLink, signInWithPassword, signUp, type LoginState } from "./actions";

type Mode = "password" | "magic" | "signup";

const TITLES: Record<Mode, string> = {
  password: msg("Sign in"),
  magic: msg("Magic link"),
  signup: msg("Create account"),
};

/*
 * Minimal sign-in built only from existing @kortex/ui primitives and kx-* classes. Ruhe (gap web-b, Login): no card,
 * one calm column on the page background, flat fields, the submit key as a hint and the other ways in as quiet links
 * (rz-auth in app/ui-primitives.css); Vivid keeps the card.
 */
export function LoginForm({ next, error: initialError }: { next: string; error?: string }) {
  const [mode, setMode] = useState<Mode>("password");
  const [pwState, pwAction, pwPending] = useActionState<LoginState, FormData>(signInWithPassword, {});
  const [mlState, mlAction, mlPending] = useActionState<LoginState, FormData>(sendMagicLink, {});
  const [suState, suAction, suPending] = useActionState<LoginState, FormData>(signUp, {});

  const [state, action, pending] =
    mode === "password" ? [pwState, pwAction, pwPending] : mode === "magic" ? [mlState, mlAction, mlPending] : [suState, suAction, suPending];
  const error = state.error ?? (mode === "password" ? initialError : undefined);

  return (
    <main className="rz-auth" style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 16, background: "var(--bg-app-shell)" }}>
      <Card padded className="rz-auth-col" style={{ width: "100%", maxWidth: 380, display: "grid", gap: 16 }}>
        <div className="kxh-row rz-auth-brand" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <AppMark size={28} />
          <strong className="kx-h-card">{PRODUCT_NAME}</strong>
        </div>
        <h1 className="kx-h-page rz-auth-title" style={{ margin: 0 }}>
          {t(TITLES[mode])}
        </h1>

        <form action={action} style={{ display: "grid", gap: 12 }}>
          <input type="hidden" name="next" value={next} />
          <label className="kx-field">
            <span className="kx-label">{t("Email")}</span>
            <span className="kx-control">
              <input name="email" type="email" autoComplete="email" required autoFocus />
            </span>
          </label>
          {mode !== "magic" && (
            <label className="kx-field">
              <span className="kx-label">{t("Password")}</span>
              <span className="kx-control">
                <input
                  name="password"
                  type="password"
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  minLength={mode === "signup" ? 8 : undefined}
                  required
                />
              </span>
            </label>
          )}
          {error && <p className="kx-help kx-help--error" role="alert">{error}</p>}
          {state.info && <p className="kx-help" role="status">{state.info}</p>}
          <Button type="submit" variant="primary" size="lg" disabled={pending} className="rz-auth-submit">
            {mode === "password" ? t("Sign in") : mode === "magic" ? t("Send magic link") : t("Create account")}
            <kbd className="rz-auth-kbd" aria-hidden>
              ↵
            </kbd>
          </Button>
        </form>

        <div className="rz-auth-alt" style={{ display: "grid", gap: 4 }}>
          {mode !== "password" && (
            <Button variant="ghost" size="sm" onClick={() => setMode("password")}>
              {t("Sign in with password")}
            </Button>
          )}
          {mode !== "magic" && (
            <Button variant="ghost" size="sm" onClick={() => setMode("magic")}>
              {t("Sign in with magic link")}
            </Button>
          )}
          {mode !== "signup" && (
            <Button variant="ghost" size="sm" onClick={() => setMode("signup")}>
              {t("Create new account")}
            </Button>
          )}
        </div>
      </Card>
    </main>
  );
}
