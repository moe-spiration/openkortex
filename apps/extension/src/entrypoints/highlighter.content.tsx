import "../styles/ext.css";
import { startHighlighter } from "../content/highlighter";
import { startRuheHighlighter } from "../content/highlighter-ruhe";
import { startPageInfo } from "../content/page-info";
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
    const ruhe = settings.look === "ruhe" && settings.highlighterEnabled;
    startPageInfo(ctx, { focusFallback: !ruhe });
    if (!settings.highlighterEnabled) return;
    if (ruhe) await startRuheHighlighter(ctx, settings);
    else await startHighlighter(ctx, settings);
  },
});
