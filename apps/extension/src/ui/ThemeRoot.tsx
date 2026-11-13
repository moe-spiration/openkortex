import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { ThemeSetting } from "../lib/settings";

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
  className,
  style,
  children,
}: {
  theme: ThemeSetting;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const resolved = useResolvedTheme(theme);
  return (
    <div data-theme={resolved} className={`kx-root ${className ?? ""}`} style={style}>
      {children}
    </div>
  );
}

/** For extension pages (popup, options): applies the theme to <html> so the page background follows it too. */
export function useDocumentTheme(setting: ThemeSetting) {
  const resolved = useResolvedTheme(setting);
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);
}
