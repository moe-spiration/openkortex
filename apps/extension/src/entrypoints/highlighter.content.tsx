import "../styles/ext.css";
import { startHighlighter } from "../content/highlighter";
import { applyLanguage, watchLanguage } from "../i18n";
import { chromeStore, loadSettings } from "../lib/settings";

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  runAt: "document_idle",
  cssInjectionMode: "ui",
  async main(ctx) {
    const settings = await loadSettings(chromeStore);
    applyLanguage(settings.language);
    watchLanguage();
    if (!settings.highlighterEnabled) return;
    await startHighlighter(ctx, settings);
  },
});
