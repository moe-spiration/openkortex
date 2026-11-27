// Opens the side panel the way the browser allows: Chrome's sidePanel, Firefox's sidebar (sidebar_action, which WXT
// builds from the same entrypoint), else the panel page in a small popup window. Must run inside a user gesture.

type FirefoxBrowser = { sidebarAction?: { open?: () => Promise<void> } };

export async function openSidePanel(windowId?: number, opts: { fallbackWindow?: boolean } = {}): Promise<"panel" | "sidebar" | "window" | "none"> {
  try {
    if (typeof chrome.sidePanel?.open === "function") {
      const id = windowId ?? (await chrome.windows.getCurrent()).id;
      await chrome.sidePanel.open({ windowId: id! });
      return "panel";
    }
  } catch {
    /* no gesture or no panel: try the next way */
  }
  const ff = (globalThis as { browser?: FirefoxBrowser }).browser;
  try {
    if (typeof ff?.sidebarAction?.open === "function") {
      await ff.sidebarAction.open();
      return "sidebar";
    }
  } catch {
    /* fall through */
  }
  if (opts.fallbackWindow === false) return "none";
  try {
    await chrome.windows.create({ url: chrome.runtime.getURL("/sidepanel.html"), type: "popup", width: 400, height: 760 });
    return "window";
  } catch {
    return "none";
  }
}

/** Whether a real side panel (or sidebar) exists; otherwise the panel opens as a small window. */
export const hasSidePanel = () =>
  typeof chrome.sidePanel?.open === "function" || typeof (globalThis as { browser?: FirefoxBrowser }).browser?.sidebarAction?.open === "function";
