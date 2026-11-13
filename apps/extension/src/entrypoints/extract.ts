import { initLanguage } from "../i18n";
import { EXTRACT_GLOBAL, extractCurrentPage } from "../lib/extract";

/** Injected by the popup (`chrome.scripting.executeScript({ files })`); the popup then calls the global by name. */

export default defineUnlistedScript(() => {
  // The reader writes a few texts (price line, caption notes): it runs in the page, so it sets its own language first.
  (globalThis as Record<string, unknown>)[EXTRACT_GLOBAL] = async () => {
    await initLanguage();
    return extractCurrentPage();
  };
});
