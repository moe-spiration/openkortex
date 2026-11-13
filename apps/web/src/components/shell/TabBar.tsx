"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, type KeyboardEvent } from "react";
import type { Tab } from "@/lib/shell/prefs";
import { HOME_TAB_KEY, routeInfo } from "@/lib/shell/routes";
import { useShell } from "@/lib/shell/store";
import { useCloseTab } from "@/lib/shell/useCloseTab";
import { Ico } from "./icons";
import { t } from "@/i18n";

/*
 * Obsidian-style tab strip, now in the titlebar of the frame (Tactile Craft v2, decision 2; dummy `.tabs`).
 * V2-03b: tabs are for documents only (notes, reader, vault files, the new-note editor); navigation targets live
 * in the sidebar. Home stays pinned first as an icon-only tab. Each document tab has a close button; middle
 * click and Delete close it too. "+" opens the new-note editor (openNewNote).
 */
export function TabStrip() {
  const router = useRouter();
  const pathname = usePathname();
  const { prefs, hydrated, setTabs, openNewNote } = useShell();
  const info = routeInfo(pathname);
  const listRef = useRef<HTMLDivElement>(null);

  // A document route always has a tab: reuse the one with its key (remembering the exact URL) or open a new one.
  useEffect(() => {
    if (!hydrated || !info.doc) return;
    // window.location (not useSearchParams) keeps the tab strip server-rendered without a Suspense bailout.
    const href = window.location.pathname + window.location.search;
    setTabs((tabs) => {
      const i = tabs.findIndex((tab) => tab.key === info.tabKey);
      if (i < 0) return [...tabs, { key: info.tabKey, label: info.tabLabel, icon: info.tabIcon, href }];
      if (tabs[i]!.href === href) return tabs;
      return tabs.map((tab, j) => (j === i ? { ...tab, href } : tab));
    });
  }, [hydrated, pathname, info.doc, info.tabKey, info.tabLabel, info.tabIcon, setTabs]);

  const tabs: Tab[] =
    !info.doc || prefs.tabs.some((tab) => tab.key === info.tabKey)
      ? prefs.tabs
      : [...prefs.tabs, { key: info.tabKey, label: info.tabLabel, icon: info.tabIcon, href: pathname }];

  const close = useCloseTab();
  // On navigation views no tab is selected; Home then takes the roving tab stop.
  const anySel = tabs.some((tab) => tab.key === info.tabKey);

  const onKey = (e: KeyboardEvent<HTMLDivElement>, tab: Tab, i: number) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      router.push(tab.href);
    } else if (e.key === "Delete" && tab.key !== HOME_TAB_KEY) {
      e.preventDefault();
      close(tab.key);
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const els = listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]');
      const n = els?.length ?? 0;
      if (n) els?.[(i + (e.key === "ArrowRight" ? 1 : n - 1)) % n]?.focus();
    }
  };

  return (
    <div className="tc-tabs">
      <div ref={listRef} role="tablist" aria-label={t("Open tabs")} style={{ display: "contents" }}>
        {tabs.map((tab, i) => {
          const sel = tab.key === info.tabKey;
          if (tab.key === HOME_TAB_KEY) {
            return (
              <div
                key={tab.key}
                className="tc-tab tc-tab--home"
                role="tab"
                aria-selected={sel}
                aria-label="Home"
                tabIndex={sel || !anySel ? 0 : -1}
                title="Home"
                onClick={() => router.push(tab.href)}
                onKeyDown={(e) => onKey(e, tab, i)}
              >
                <Ico name="home" size="sm" />
              </div>
            );
          }
          return (
            <div
              key={tab.key}
              className="tc-tab"
              role="tab"
              aria-selected={sel}
              tabIndex={sel ? 0 : -1}
              title={tab.label}
              aria-keyshortcuts="Delete"
              onClick={() => router.push(tab.href)}
              onAuxClick={(e) => e.button === 1 && close(tab.key)}
              onKeyDown={(e) => onKey(e, tab, i)}
            >
              <Ico name={tab.icon} size="sm" />
              <span className="tc-tab-label">{tab.label}</span>
              <span
                className="tc-tab-x"
                aria-hidden
                title={t("Close tab (Del)")}
                onClick={(e) => {
                  e.stopPropagation();
                  close(tab.key);
                }}
              >
                <Ico name="x" />
              </span>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="tc-ibtn tc-ibtn--sm"
        aria-label={t("New note in a new tab")}
        title={t("New note (Alt+N)")}
        onClick={() => openNewNote()}
      >
        <Ico name="plus" />
      </button>
    </div>
  );
}
