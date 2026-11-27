"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { t } from "@/i18n";
import { accentHex } from "@/lib/shell/accent";
import { useShell } from "@/lib/shell/store";
import { useSettings } from "@/lib/settings/store";
import { CONTRASTS, FONT_SCALES, type Contrast, type Density, type Look } from "@/lib/settings/appearance";
import type { MotionChoice } from "@/lib/settings/motion";
import { hexHue, oklchToHex, RUHE_ACCENT_C, RUHE_ACCENT_L } from "@/lib/settings/oklch";
import { useThemePack } from "@/lib/theme/pack";

/*
 * Settings > Erscheinungsbild in the Ruhe look (mockup "einstellungen", gap report web-a W8): the theme from three
 * values. Theme tiles set base hue, tint and accent at once; the sliders move them one by one at runtime (OKLCH):
 * Grundton -> --ruhe-h, Akzent -> the shell accent written as oklch(0.63 0.155 h) hex (so mobile and the clipper,
 * which read the hex, follow), Kontrast -> data-contrast. A dark and a light miniature preview the result. Then
 * Modus, Dichte, Bewegung (Voll / Reduziert / Aus) and Hero-Bilder, and the device extras (look, font size,
 * transparency). Flat rows: label column 220 px, control right, hairline between groups.
 */

interface Preset {
  id: string;
  name: string;
  hue: number;
  tint: number;
  accentHue: number;
  /** Three swatches of the tile: frame, surface, accent. */
  sw: [string, string, string];
}

const PRESETS: Preset[] = [
  { id: "kortex", name: "Kortex", hue: 75, tint: 1, accentHue: 276, sw: ["oklch(0.158 0.003 75)", "oklch(0.218 0.004 75)", "oklch(0.63 0.155 276)"] },
  { id: "graphit", name: "Graphit", hue: 260, tint: 1.6, accentHue: 230, sw: ["oklch(0.16 0.006 260)", "oklch(0.22 0.008 260)", "oklch(0.68 0.12 230)"] },
  { id: "sand", name: "Sand", hue: 80, tint: 3, accentHue: 45, sw: ["oklch(0.96 0.012 80)", "oklch(0.92 0.015 80)", "oklch(0.6 0.14 45)"] },
  { id: "wald", name: "Wald", hue: 160, tint: 3, accentHue: 155, sw: ["oklch(0.17 0.012 160)", "oklch(0.23 0.015 160)", "oklch(0.7 0.13 155)"] },
  { id: "nacht", name: "Nacht", hue: 280, tint: 5, accentHue: 320, sw: ["oklch(0.13 0.02 280)", "oklch(0.19 0.025 280)", "oklch(0.7 0.15 320)"] },
];

const hueDist = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

function Group({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <div className="rzs-grp">
      <div className="rzs-k">
        {label}
        {help && <small>{help}</small>}
      </div>
      <div className="rzs-v">{children}</div>
    </div>
  );
}

function Seg<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="rzs-seg" role="radiogroup" aria-label={label}>
      {options.map(([id, l]) => (
        <button key={String(id)} type="button" role="radio" aria-checked={value === id} className={value === id ? "is-on" : undefined} onClick={() => onChange(id)}>
          {l}
        </button>
      ))}
    </div>
  );
}

function Slider({ label, value, min, max, step = 1, track, out, onChange, valueText }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  track: string;
  out: string;
  valueText?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="rzs-slider">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={valueText ?? out}
        style={{ "--track": track } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="rzs-out">{out}</span>
    </label>
  );
}

function Mini({ theme }: { theme: "dark" | "light" }) {
  return (
    <div className="rzs-mini" data-theme={theme} aria-hidden>
      <div className="rzs-mini-s">
        <i className="is-on" />
        <i />
        <i />
        <i style={{ width: "70%" }} />
        <i style={{ marginTop: 8, width: "60%" }} />
        <i />
      </div>
      <div className="rzs-mini-m">
        <b />
        <i />
        <i style={{ width: "80%" }} />
        <i style={{ width: "65%" }} />
        <u />
      </div>
    </div>
  );
}

export function AppearanceRuhe() {
  const { prefs, setTheme, setFollowSystem } = useShell();
  const { setAccent } = useThemePack();
  const { appearance, setAppearance, local, setLocal, motion, setMotion } = useSettings();
  const storedAccentHue = hexHue(accentHex(prefs.accent)) ?? 276;
  // The slider follows the drag at once; the accent (saved and synced) is written when the hue settles.
  const [accentHue, setAccentHue] = useState(storedAccentHue);
  useEffect(() => setAccentHue(storedAccentHue), [storedAccentHue]);
  useEffect(() => {
    if (accentHue === storedAccentHue) return;
    const id = window.setTimeout(() => setAccent(oklchToHex(RUHE_ACCENT_L, RUHE_ACCENT_C, accentHue)), 140);
    return () => window.clearTimeout(id);
  }, [accentHue, storedAccentHue, setAccent]);

  const themeValue = prefs.followSystem ? "system" : prefs.theme;
  const activePreset = PRESETS.find((p) => p.hue === appearance.baseHue && p.tint === appearance.tint && hueDist(p.accentHue, accentHue) <= 3)?.id ?? null;
  const contrastLabel: Record<Contrast, string> = { soft: t("Soft"), normal: t("Normal"), high: t("High") };

  const pickPreset = (p: Preset) => {
    setAppearance({ baseHue: p.hue, tint: p.tint });
    setAccentHue(p.accentHue);
    setAccent(oklchToHex(RUHE_ACCENT_L, RUHE_ACCENT_C, p.accentHue));
    // Sand is a light theme: its tile shows the light ladder, so picking it switches to light.
    if (p.id === "sand") setTheme("light");
  };

  return (
    <div className="rzs-look">
      <Group label={t("Theme")} help={t("The whole colour ladder is computed from three values.")}>
        <div className="rzs-presets" role="radiogroup" aria-label={t("Theme")}>
          {PRESETS.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={activePreset === p.id} className={"rzs-preset" + (activePreset === p.id ? " is-on" : "")} onClick={() => pickPreset(p)}>
              <span className="rzs-sw" aria-hidden>
                {p.sw.map((c, i) => (
                  <i key={i} style={{ background: c }} />
                ))}
              </span>
              <span className="rzs-nm">{p.name}</span>
            </button>
          ))}
        </div>
        <Slider
          label={t("Base tone")}
          value={appearance.baseHue}
          min={0}
          max={359}
          track="linear-gradient(90deg,oklch(0.5 0.03 0),oklch(0.5 0.03 60),oklch(0.5 0.03 120),oklch(0.5 0.03 180),oklch(0.5 0.03 240),oklch(0.5 0.03 300),oklch(0.5 0.03 360))"
          out={`${appearance.baseHue}°`}
          onChange={(v) => setAppearance({ baseHue: v })}
        />
        <Slider
          label={t("Accent")}
          value={accentHue}
          min={0}
          max={359}
          track="linear-gradient(90deg,oklch(0.63 0.155 0),oklch(0.63 0.155 60),oklch(0.63 0.155 120),oklch(0.63 0.155 180),oklch(0.63 0.155 240),oklch(0.63 0.155 300),oklch(0.63 0.155 360))"
          out={`${accentHue}°`}
          onChange={setAccentHue}
        />
        <Slider
          label={t("Contrast")}
          value={CONTRASTS.indexOf(appearance.contrast)}
          min={0}
          max={2}
          track="linear-gradient(90deg,var(--lum-3),var(--t1))"
          out={contrastLabel[appearance.contrast]}
          onChange={(v) => setAppearance({ contrast: CONTRASTS[v] ?? "normal" })}
        />
      </Group>
      <Group label={t("Preview")}>
        <div className="rzs-minis">
          <Mini theme="dark" />
          <Mini theme="light" />
        </div>
      </Group>
      <Group label={t("Mode")}>
        <Seg
          label={t("Mode")}
          value={themeValue}
          options={[
            ["light", t("Light")],
            ["dark", t("Dark")],
            ["system", t("System")],
          ]}
          onChange={(id) => (id === "system" ? setFollowSystem(true) : setTheme(id))}
        />
      </Group>
      <Group label={t("Density")}>
        <Seg<Density>
          label={t("Density")}
          value={appearance.density}
          options={[
            ["komfort", t("Airy")],
            ["kompakt", t("Normal")],
            ["dicht", t("Compact")],
          ]}
          onChange={(density) => setAppearance({ density })}
        />
      </Group>
      <Group label={t("Motion")} help={t("Animations of windows, lists and icons.")}>
        <Seg<MotionChoice>
          label={t("Motion")}
          value={motion.choice}
          options={[
            ["system", t("System")],
            ["full", t("Full")],
            ["calm", t("Reduced")],
            ["off", t("Off")],
          ]}
          onChange={setMotion}
        />
        {/* Windows "Animationseffekte" off makes the system ask for reduced motion; say so, a choice here wins. */}
        {motion.osReduce && (
          <small className="rzs-note" data-motion-note>
            {motion.choice === "system"
              ? t("Your system asks for reduced motion, so motion is off. Pick “Full” to see it anyway.")
              : t("Your system asks for reduced motion; your choice here wins.")}
          </small>
        )}
      </Group>
      <Group label={t("Hero images")}>
        <label className="rzs-switch">
          <input type="checkbox" role="switch" className="kx-switch" checked={local.heroes} onChange={(e) => setLocal("heroes", e.target.checked)} />
          {t("On Today, in Life areas and in lists")}
        </label>
      </Group>
      <Group label={t("Look")} help={t("Vivid is the earlier look with edge light and coloured tiles.")}>
        <Seg<Look>
          label={t("Look")}
          value={appearance.look}
          options={[
            ["ruhe", t("Calm")],
            ["vivid", t("Vivid")],
          ]}
          onChange={(look) => setAppearance({ look })}
        />
      </Group>
      <Group label={t("Font size")} help={t("For the whole app on this device. If the text looks too large on Windows, make it smaller here.")}>
        <Seg
          label={t("Font size")}
          value={appearance.fontScale}
          options={FONT_SCALES.map((f) => [f, `${Math.round(f * 100)} %`])}
          onChange={(fontScale) => setAppearance({ fontScale })}
        />
      </Group>
      <Group label={t("Reduce transparency")} help={t("Glass becomes opaque surfaces. Helps with weak graphics cards and for calmer contrast.")}>
        <label className="rzs-switch">
          <input
            type="checkbox"
            role="switch"
            className="kx-switch"
            aria-label={t("Reduce transparency")}
            checked={appearance.reduceTransparency}
            onChange={(e) => setAppearance({ reduceTransparency: e.target.checked })}
          />
        </label>
      </Group>
    </div>
  );
}
