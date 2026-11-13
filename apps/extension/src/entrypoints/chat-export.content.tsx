import "../styles/ext.css";
import { startChatExport } from "../content/chat";
import { applyLanguage, watchLanguage } from "../i18n";
import { detectPlatform } from "../lib/chat/selectors";
import { chromeStore, loadSettings } from "../lib/settings";

export default defineContentScript({
  matches: ["https://chatgpt.com/*", "https://chat.openai.com/*", "https://claude.ai/*"],
  runAt: "document_idle",
  cssInjectionMode: "ui",
  async main(ctx) {
    const settings = await loadSettings(chromeStore);
    applyLanguage(settings.language);
    watchLanguage();
    const spec = detectPlatform(location.hostname);
    if (!settings.chatExportEnabled || !spec) return;
    await startChatExport(ctx, settings, spec);
  },
});
