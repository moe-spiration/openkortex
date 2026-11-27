/**
 * Pre-paint platform mark (r2-type, 2026-11-27): <html data-os="windows"> on Windows (browser and the Windows main
 * window, WebView2), so the Ruhe type scale can step its weights down there (packages/ui/src/styles/ruhe.css: Windows
 * draws Geist heavier than the mockup). Runs before hydration like PREPAINT_SCRIPT; no other platform is marked.
 */
export function isWindowsUA(ua: string): boolean {
  return /Windows/i.test(ua);
}

export const PLATFORM_SCRIPT = `(function(){try{if(/Windows/i.test(navigator.userAgent))document.documentElement.dataset.os="windows";}catch(e){}})();`;
