"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type CSSProperties } from "react";
import { AccentSwatches } from "@/components/shell/AccentSwatches";
import { useThemePack } from "@/lib/theme/pack";
import { Ico } from "@/components/shell/icons";
import { accentPair } from "@/lib/shell/accent";
import { useShell } from "@/lib/shell/store";
import { PROFILE } from "@/lib/workspace-data";
import {
  ONBOARDING_AREAS,
  VAULT_CHOICES,
  readOnboarding,
  skipOnboarding,
  useBootstrapWorkspace,
  type VaultChoice,
} from "@/lib/onboarding/bootstrap";
import { msg, t } from "@/i18n";

/*
 * First-run setup, 1:1 from WebApp.dc.html (onb 1..5): photo panel with the claim and step dots on
 * the left, five steps on the right (Willkommen, Vault, Life Areas, Theme + Akzent, fertig).
 * Opens on the first visit and from Settings > Profil > Einrichtung or the command palette.
 */

const STEPS = 5;
const FEATURES = [
  { icon: "mic" as const, title: msg("Capture without thinking"), help: msg("Orb, browser, phone and meetings end up in one Inbox") },
  { icon: "sparkles" as const, title: msg("Sorts itself"), help: msg("Auto-routing into Spaces, tags and backlinks") },
  { icon: "search" as const, title: msg("Ask with sources"), help: msg("Hybrid RAG across all your knowledge") },
];
const h2Small: CSSProperties = { margin: 0 };

/** Opens the flow once per browser (no record yet). Rendered by the app shell. */
export function useFirstRunOnboarding() {
  const { hydrated, setOnboarding } = useShell();
  useEffect(() => {
    if (hydrated && !readOnboarding()) setOnboarding(1);
  }, [hydrated, setOnboarding]);
}

export function Onboarding() {
  const router = useRouter();
  const pathname = usePathname();
  const { onboarding: step, setOnboarding, prefs, setTheme, setCmode, showToast } = useShell();
  const { setAccent } = useThemePack();
  const bootstrap = useBootstrapWorkspace();
  const [vault, setVault] = useState<VaultChoice>("new");
  const [areas, setAreas] = useState<boolean[]>([true, true, true, true, true, true, false, false]);
  const [busy, setBusy] = useState(false);
  const areasOn = areas.filter(Boolean).length;

  // Esc skips (prototype: closeOnb), in the capture phase so it wins over the shell's Esc chain.
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      skipOnboarding();
      setOnboarding(0);
    };
    window.addEventListener("keydown", esc, true);
    return () => window.removeEventListener("keydown", esc, true);
  }, [setOnboarding]);

  const skip = () => {
    skipOnboarding();
    setOnboarding(0);
  };
  const next = async () => {
    if (step === 3 && areasOn < 3) {
      showToast(t("Choose at least three life areas"));
      return;
    }
    if (step < STEPS) return setOnboarding(step + 1);
    setBusy(true);
    await bootstrap({ vault, areas: ONBOARDING_AREAS.filter((_, i) => areas[i]), theme: prefs.theme, accent: prefs.accent });
    setBusy(false);
    setOnboarding(0);
    setCmode("capture");
    if (pathname !== "/home") router.push("/home");
    showToast(t("Tap the orb below or write your first thought"));
  };

  const vaultTitle = t(VAULT_CHOICES.find((v) => v.id === vault)!.title);
  const [, accentSolid] = accentPair(prefs.accent);

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 39, display: "flex", justifyContent: "center", alignItems: "center" }}>
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background: "color-mix(in srgb, var(--bg-app-shell) 70%, transparent)",
          WebkitBackdropFilter: "blur(14px)",
          backdropFilter: "blur(14px)",
        }}
      />
      <div
        className="kx-slide-up"
        role="dialog"
        aria-modal="true"
        aria-label={t("Set up Kortex")}
        style={{
          position: "relative",
          width: 880,
          maxWidth: "calc(100% - 40px)",
          height: 560,
          display: "grid",
          gridTemplateColumns: "300px minmax(0,1fr)",
          borderRadius: 16,
          overflow: "hidden",
          background: "var(--bg-main-window)",
          boxShadow: "var(--shadow-floating), 0 0 0 1px var(--border-subtle)",
        }}
      >
        <div style={{ position: "relative", overflow: "hidden" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="kx-photo" src="/mock/onboarding.webp" alt="" style={{ position: "absolute", inset: 0 }} />
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.65) 100%)" }} />
          <div style={{ position: "absolute", left: 24, right: 24, bottom: 26, display: "grid", gap: 14, color: "#FFFFFF" }}>
            <span className="kx-appmark" style={{ width: 44, height: 44, borderRadius: 12 }} />
            <strong className="kx-h-page">
              {t("Your second brain that sorts itself.")}
            </strong>
            <div className="kxh-row" style={{ gap: 6 }} aria-hidden>
              {Array.from({ length: STEPS }, (_, i) => i + 1).map((i) => (
                <span
                  key={i}
                  style={{
                    display: "block",
                    height: 4,
                    borderRadius: 2,
                    transition: "width 180ms",
                    width: i === step ? 26 : 8,
                    background: i <= step ? "#FFFFFF" : "rgba(255,255,255,0.35)",
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", padding: "30px 32px 24px", minWidth: 0 }}>
          <div className="kxh-row" style={{ marginBottom: 18 }}>
            <span className="kx-eyebrow kxh-grow">
              {t("Step {step} of {total}", { step, total: STEPS })}
            </span>
            <button type="button" className="kx-btn kx-btn--ghost kx-btn--sm" onClick={skip}>
              {t("Skip")}
            </button>
          </div>
          {/* paddingTop 6: the prototype's template wrappers add 6px above each step; kept for a 1:1 match. */}
          <div className="kx-scroll" style={{ flex: 1, minHeight: 0, overflow: "auto", paddingTop: 6 }}>
            {step === 1 && (
              <div key={1} className="kx-in" style={{ display: "grid", gap: 16 }}>
                <h2 className="kx-h-display" style={{ margin: 0 }}>
                  {t("Welcome to Kortex")}
                </h2>
                <p className="kx-body" style={{ margin: 0, color: "var(--text-secondary)" }}>
                  {t("You drop things in, Kortex sorts, links and reminds you at the right time. Everything is set up in four short steps.")}
                </p>
                {FEATURES.map((x) => (
                  <div key={x.title} className="kxh-row" style={{ gap: 12, alignItems: "flex-start" }}>
                    <span className="kx-icontile kx-icontile--ai">
                      <Ico name={x.icon} />
                    </span>
                    <span className="kxh-col" style={{ gap: 1 }}>
                      <strong style={{ fontSize: "calc(13px * var(--kx-fs, 1))" }}>{t(x.title)}</strong>
                      <span className="kx-help" style={{ fontSize: "calc(13px * var(--kx-fs, 1))" }}>
                        {t(x.help)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}

            {step === 2 && (
              <div key={2} className="kx-in" style={{ display: "grid", gap: 12 }} role="radiogroup" aria-label="Vault">
                <h2 className="kx-h-page" style={h2Small}>
                  {t("Where should your knowledge live?")}
                </h2>
                <p className="kx-help" style={{ margin: "0 0 4px", fontSize: "calc(13px * var(--kx-fs, 1))" }}>
                  {t("Everything stays Markdown on your device. You can switch later.")}
                </p>
                {VAULT_CHOICES.map((v) => {
                  const on = vault === v.id;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      className="kxb"
                      role="radio"
                      aria-checked={on}
                      onClick={() => setVault(v.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        width: "100%",
                        padding: "12px 14px",
                        borderRadius: 12,
                        background: "var(--bg-surface-flat)",
                        boxShadow: `inset 0 0 0 ${on ? "1.5px var(--accent-ai)" : "1px var(--border-subtle)"}`,
                      }}
                    >
                      <span className="kx-icontile">
                        <Ico name={v.icon} />
                      </span>
                      <span className="kxh-col kxh-grow" style={{ gap: 1, textAlign: "left" }}>
                        <strong style={{ fontSize: "calc(13px * var(--kx-fs, 1))" }}>{t(v.title)}</strong>
                        <span className="kx-help" style={{ fontSize: "calc(12px * var(--kx-fs, 1))" }}>
                          {t(v.help)}
                        </span>
                      </span>
                      {on && <Ico name="check" style={{ color: "var(--accent-ai)" }} />}
                    </button>
                  );
                })}
              </div>
            )}

            {step === 3 && (
              <div key={3} className="kx-in" style={{ display: "grid", gap: 12 }}>
                <h2 className="kx-h-page" style={h2Small}>
                  {t("Which areas of life count?")}
                </h2>
                <p className="kx-help" style={{ margin: "0 0 4px", fontSize: "calc(13px * var(--kx-fs, 1))" }}>
                  {t("Kortex assigns entries to these life areas and shows you the balance. Choose at least three.")}
                </p>
                <div className="kxh-wrap" style={{ gap: 8 }}>
                  {ONBOARDING_AREAS.map((label, i) => {
                    const on = areas[i];
                    return (
                      <button
                        key={label}
                        type="button"
                        className="kxb"
                        aria-pressed={on}
                        onClick={() => setAreas((a) => a.map((x, j) => (j === i ? !x : x)))}
                        style={{
                          height: 38,
                          padding: "0 14px",
                          borderRadius: 999,
                          fontSize: "calc(13px * var(--kx-fs, 1))",
                          fontWeight: 500,
                          ...(on
                            ? { background: "var(--accent-ai-solid)", color: "#FFFFFF" }
                            : { background: "var(--bg-surface-muted)", color: "var(--text-secondary)", boxShadow: "inset 0 0 0 1px var(--border-subtle)" }),
                        }}
                      >
                        {t(label)}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {step === 4 && (
              <div key={4} className="kx-in" style={{ display: "grid", gap: 16 }}>
                <h2 className="kx-h-page" style={h2Small}>
                  {t("Make it yours")}
                </h2>
                <div className="kxh-row">
                  <span className="kx-label kxh-grow">{t("Theme")}</span>
                  <div className="kx-tabs kx-tabs--sm" role="tablist" aria-label={t("Theme")}>
                    {(
                      [
                        ["light", t("Light")],
                        ["dark", t("Dark")],
                      ] as const
                    ).map(([id, label]) => (
                      <button key={id} type="button" className="kx-tab" role="tab" aria-selected={prefs.theme === id} onClick={() => setTheme(id)}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <span className="kx-label">{t("Accent color")}</span>
                <AccentSwatches value={prefs.accent} onChange={setAccent} custom={false} hex={accentSolid} showCustom={false} />
                <div className="kxh-row" style={{ gap: 10, padding: 12, borderRadius: 12, background: "var(--bg-surface-muted)" }}>
                  <span className="kx-orb" style={{ width: 34, height: 34, cursor: "default" }} aria-hidden>
                    <Ico name="mic" style={{ width: 14, height: 14 }} />
                  </span>
                  <span className="kx-pill">#ai/mcp</span>
                  <button type="button" className="kx-btn kx-btn--primary kx-btn--sm" onClick={() => showToast(t("Not built out in the prototype"))}>
                    {t("This is how it looks")}
                  </button>
                </div>
              </div>
            )}

            {step === 5 && (
              <div key={5} className="kx-in" style={{ display: "grid", gap: 14 }}>
                <span
                  style={{
                    display: "grid",
                    placeItems: "center",
                    width: 52,
                    height: 52,
                    borderRadius: "50%",
                    background: "color-mix(in srgb, var(--status-synced) 14%, transparent)",
                    color: "var(--status-synced)",
                  }}
                >
                  <Ico name="check" style={{ width: 20, height: 20 }} />
                </span>
                <h2 className="kx-h-display" style={{ margin: 0 }}>
                  {t("All set, {name}.", { name: PROFILE.name })}
                </h2>
                <p className="kx-body" style={{ margin: 0, color: "var(--text-secondary)" }}>
                  {t("{vault}, {count} life areas and your accent color are set. The AI Gardener starts sorting as soon as something comes in.", { vault: vaultTitle, count: areasOn })}
                </p>
                <div style={{ padding: "12px 14px", borderRadius: 12, background: "var(--accent-ai-soft)", fontSize: "calc(13px * var(--kx-fs, 1))", lineHeight: 1.4, fontWeight: 400 }}>
                  {t("Tip: tap the orb below and speak your first thought. Kortex files it automatically.")}
                </div>
              </div>
            )}
          </div>
          <div className="kxh-row" style={{ gap: 10, marginTop: 16 }}>
            {step > 1 && (
              <button type="button" className="kx-btn kx-btn--secondary" onClick={() => setOnboarding(step - 1)}>
                {t("Back")}
              </button>
            )}
            <span className="kxh-grow" />
            <button type="button" className="kx-btn kx-btn--primary" onClick={next} aria-busy={busy} disabled={busy}>
              {step === 1 ? t("Let’s go") : step === STEPS ? t("Capture first thought") : t("Next")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
