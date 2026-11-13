"use client";

import { useEffect, useState } from "react";

/*
 * Resolved design tokens for the parts of the reader that CSS variables can't reach directly:
 * the pdf.js canvas (pageColors) and the epubjs iframes (injected theme CSS). Re-read whenever the
 * shell switches theme or accent (attributes on <html>).
 */

export interface ReaderTheme {
  /** Page card background (--bg-surface-flat). */
  surface: string;
  fg: string;
  muted: string;
  /** Highlight colour (--status-processing, as .kx-hl). */
  hl: string;
  accentSoft: string;
  /** Text font of the document panes (Geist; typography v2 has no display serif). */
  sans: string;
  mono: string;
}

function readTheme(): ReaderTheme {
  const cs = getComputedStyle(document.body);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    surface: v("--bg-surface-flat", "#ffffff"),
    fg: v("--text-primary", "#18181b"),
    muted: v("--text-muted", "#71717a"),
    hl: v("--status-processing", "#f59e0b"),
    accentSoft: v("--accent-ai-soft", "rgba(99, 102, 241, 0.14)"),
    sans: v("--font-sans", "Geist, ui-sans-serif, system-ui, sans-serif"),
    mono: v("--font-mono", "ui-monospace, monospace"),
  };
}

const same = (a: ReaderTheme, b: ReaderTheme) => (Object.keys(a) as (keyof ReaderTheme)[]).every((k) => a[k] === b[k]);

export function useReaderTheme(): ReaderTheme | null {
  const [theme, setTheme] = useState<ReaderTheme | null>(null);
  useEffect(() => {
    const update = () => {
      const next = readTheme();
      setTheme((cur) => (cur && same(cur, next) ? cur : next));
    };
    update();
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style", "class"] });
    return () => mo.disconnect();
  }, []);
  return theme;
}

/**
 * @font-face rules of the host page for the given font stacks, with absolute URLs, so an iframe
 * (epubjs renders into srcdoc frames) can use the app's self-hosted next/font families.
 */
export function fontFaceCss(...stacks: string[]): string {
  const families = new Set(
    stacks.flatMap((s) => s.split(",").map((f) => f.trim().replace(/^["']|["']$/g, ""))).filter(Boolean),
  );
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin sheet
    }
    const base = sheet.href ?? document.baseURI;
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const family = rule.style.getPropertyValue("font-family").trim().replace(/^["']|["']$/g, "");
      if (!families.has(family)) continue;
      out.push(
        rule.cssText.replace(/url\((["']?)([^"')]+)\1\)/g, (_m, _q: string, url: string) => {
          try {
            return `url("${new URL(url, base).href}")`;
          } catch {
            return `url("${url}")`;
          }
        }),
      );
    }
  }
  return out.join("\n");
}
