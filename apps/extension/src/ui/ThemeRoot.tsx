import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { LookSetting, ThemeSetting } from "../lib/settings";

/** Ruhe steps its font weights down on Windows, where Geist renders heavier (packages/ui ruhe.css, data-os). */
const WINDOWS = typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);

/** "auto" follows the browser's colour scheme; the design is dark by default. */
export function useResolvedTheme(setting: ThemeSetting): "dark" | "light" {
  const query = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: light)") : null;
  const [light, setLight] = useState(query?.matches ?? false);
  useEffect(() => {
    if (!query || setting !== "auto") return;
    const on = (e: MediaQueryListEvent) => setLight(e.matches);
    query.addEventListener("change", on);
    return () => query.removeEventListener("change", on);
  }, [query, setting]);
  return setting === "auto" ? (light ? "light" : "dark") : setting;
}

/** Scopes the Kortex tokens (`[data-theme]`) and the extension recipes to a subtree, also inside shadow roots. */
export function ThemeRoot({
  theme,
  look,
  className,
  style,
  children,
}: {
  theme: ThemeSetting;
  /** Only needed where <html> is not ours (content scripts in a shadow root); pages set it with useDocumentTheme. */
  look?: LookSetting;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const resolved = useResolvedTheme(theme);
  return (
    <div data-theme={resolved} data-look={look} data-os={WINDOWS ? "windows" : undefined} className={`kx-root ${className ?? ""}`} style={style}>
      {children}
    </div>
  );
}

/** For extension pages (popup, options): applies the theme to <html> so the page background follows it too. */
export function useDocumentTheme(setting: ThemeSetting, look: LookSetting = "ruhe") {
  const resolved = useResolvedTheme(setting);
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);
  useEffect(() => {
    document.documentElement.dataset.look = look;
    if (WINDOWS) document.documentElement.dataset.os = "windows";
  }, [look]);
}
