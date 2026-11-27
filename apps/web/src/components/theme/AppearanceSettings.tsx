"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { DensitySwitch } from "@kortex/ui";
import { fullSources } from "@kortex/theme-packs";
import { ACCENT_SWATCHES, accentHex, parseHex } from "@/lib/shell/accent";
import { useShell } from "@/lib/shell/store";
import { useSettings } from "@/lib/settings/store";
import { FONT_SCALES, type Backdrop, type Look } from "@/lib/settings/appearance";
import { useThemePack } from "@/lib/theme/pack";
import { t } from "@/i18n";

/*
 * Settings > Erscheinungsbild, the Tactile Craft card (dummy `Settings`): theme (System / Hell / Dunkel), accent
 * (swatches, free colour, hex), frame backdrop (accent glow or theme pack, with preview tiles), default density and
 * reduced transparency and the font size. Theme and accent are shell prefs (accent also saved to user_settings by lib/theme/pack);
 * backdrop, density, transparency and font size are device prefs (lib/settings/appearance.ts).
 */

function Row({ title, help, children }: { title: string; help: string; children: ReactNode }) {
  return (
    <div className="tc-set-row">
      <div>
        <div className="tc-set-title">{title}</div>
        <div className="tc-set-help">{help}</div>
      </div>
      <div className="tc-set-ctl">{children}</div>
    </div>
  );
}

function HexField({ value, onCommit }: { value: string; onCommit: (hex: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const parsed = parseHex(draft);
  return (
    <input
      className="tc-hex"
      aria-label={t("Accent color as hex value")}
      aria-invalid={!parsed}
      spellCheck={false}
      value={draft}
      maxLength={7}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => (parsed ? onCommit(parsed) : setDraft(value))}
      onKeyDown={(e) => {
        if (e.key === "Enter" && parsed) onCommit(parsed);
        if (e.key === "Escape") setDraft(value);
      }}
    />
  );
}

export function AppearanceSettings() {
  const { prefs, setTheme, setFollowSystem } = useShell();
  const { setAccent, pack, mode, base } = useThemePack();
  const { appearance, setAppearance } = useSettings();
  const hex = accentHex(prefs.accent).toUpperCase();
  const swatchOn = (v: string) => prefs.accent.toLowerCase() === v.toLowerCase();
  const custom = !ACCENT_SWATCHES.some((s) => swatchOn(s.value));
  const themeValue = prefs.followSystem ? "system" : prefs.theme;
  const packPrev = fullSources(pack, mode, "home", base);

  const backdrops: { id: Backdrop; label: string; sub: string }[] = [
    { id: "glow", label: t("Accent glow"), sub: t("Default") },
    { id: "pack", label: t("Theme pack"), sub: appearance.reduceTransparency ? t("Off with reduced transparency") : t("Photo") },
  ];

  return (
    <div className="tc-set">
      <Row
        title={t("Look")}
        help={t(
          "Calm is the standard: softer lines, dimmer navigation, no edge light. Vivid is the earlier look with edge light and coloured tiles.",
        )}
      >
        <div className="kx-tabs" role="radiogroup" aria-label={t("Look")}>
          {(
            [
              ["ruhe", t("Calm")],
              ["vivid", t("Vivid")],
            ] as [Look, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={appearance.look === id}
              className={"kx-tab" + (appearance.look === id ? " is-on" : "")}
              onClick={() => setAppearance({ look: id })}
            >
              {label}
            </button>
          ))}
        </div>
      </Row>
      <Row title={t("Theme")} help={t("System follows the setting of your device. Applies to web, desktop and mobile.")}>
        <div className="kx-tabs" role="radiogroup" aria-label={t("Theme")}>
          {(
            [
              ["system", t("System")],
              ["light", t("Light")],
              ["dark", t("Dark")],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={themeValue === id}
              className={"kx-tab" + (themeValue === id ? " is-on" : "")}
              onClick={() => (id === "system" ? setFollowSystem(true) : setTheme(id))}
            >
              {label}
            </button>
          ))}
        </div>
      </Row>
      <Row title={t("Accent color")} help={t("One signal for focus, selection and AI. Everything else stays monochrome; the text on accent surfaces adapts.")}>
        <div role="radiogroup" aria-label={t("Accent color")} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {ACCENT_SWATCHES.map((s) => (
            <button
              key={s.value}
              type="button"
              role="radio"
              aria-checked={swatchOn(s.value)}
              aria-label={t(s.label)}
              title={t(s.label)}
              className="tc-swatch"
              style={{ "--c": s.hex } as CSSProperties}
              onClick={() => setAccent(s.value)}
            />
          ))}
          <label className="tc-picker" data-on={custom} title={t("Custom color")}>
            <input type="color" value={accentHex(prefs.accent)} aria-label={t("Custom accent color")} onChange={(e) => setAccent(e.target.value)} />
          </label>
        </div>
        <HexField value={hex} onCommit={(h) => setAccent(h)} />
      </Row>
      <Row title={t("Frame background")} help={t("Behind sidebar and title bar. The default is the calm accent glow; the work surface always stays calm.")}>
        <div className="tc-bd-pick" role="radiogroup" aria-label={t("Frame background")}>
          {backdrops.map((b) => (
            <button
              key={b.id}
              type="button"
              role="radio"
              aria-checked={appearance.backdrop === b.id}
              className="tc-bd-opt"
              onClick={() => setAppearance({ backdrop: b.id })}
            >
              <span className={"tc-bd-prev tc-bd-prev--" + b.id} aria-hidden>
                {b.id === "pack" && (
                  <picture>
                    <source type="image/avif" srcSet={packPrev.avif} />
                    <img src={packPrev.webp} alt="" loading="lazy" decoding="async" />
                  </picture>
                )}
                <span className="tc-bd-canvas" />
              </span>
              <span style={{ display: "grid" }}>
                <span className="tc-bd-name">{b.label}</span>
                <span className="tc-bd-sub">{b.sub}</span>
              </span>
            </button>
          ))}
        </div>
      </Row>
      <Row title={t("Font size")} help={t("For the whole app on this device. If the text looks too large on Windows, make it smaller here.")}>
        <div className="kx-tabs" role="radiogroup" aria-label={t("Font size")}>
          {FONT_SCALES.map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={appearance.fontScale === f}
              className={"kx-tab kx-num" + (appearance.fontScale === f ? " is-on" : "")}
              onClick={() => setAppearance({ fontScale: f })}
            >
              {Math.round(f * 100)} %
            </button>
          ))}
        </div>
      </Row>
      <Row title={t("Default density")} help={t("Compact for collections. Life stays in comfort; every view remembers its own choice.")}>
        <DensitySwitch labels value={appearance.density} onChange={(density) => setAppearance({ density })} />
      </Row>
      <Row title={t("Reduce transparency")} help={t("Glass becomes opaque surfaces. Helps with weak graphics cards and for calmer contrast.")}>
        <input
          type="checkbox"
          role="switch"
          className="kx-switch"
          aria-label={t("Reduce transparency")}
          checked={appearance.reduceTransparency}
          onChange={(e) => setAppearance({ reduceTransparency: e.target.checked })}
        />
      </Row>
    </div>
  );
}
