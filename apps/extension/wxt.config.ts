import tailwindcss from "@tailwindcss/vite";
import { existsSync, readFileSync } from "node:fs";
import { defineConfig } from "wxt";
import product from "../../packages/i18n/product.json";

// Display name: Kortex in the private build, OpenKortex in the open-source export (packages/i18n/product.json).
const NAME = product.name;

// A private deployment preconfigures its builds through kortex.instance.json in the repository root
// (or WXT_KORTEX_DEFAULT_URL); without either the extension asks for its Kortex on the options page.
const instanceFile = new URL("../../kortex.instance.json", import.meta.url);
const fromInstance = existsSync(instanceFile) ? (JSON.parse(readFileSync(instanceFile, "utf8")) as { webUrl?: string }).webUrl : undefined;
const defaultUrl = (process.env.WXT_KORTEX_DEFAULT_URL?.trim() || fromInstance || "").trim().replace(/\/+$/, "");
process.env.WXT_KORTEX_DEFAULT_URL = defaultUrl;

export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-react"],
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: ({ browser }) => ({
    name: NAME,
    short_name: NAME,
    // Manifest texts follow the browser language (public/_locales/en|de); the in-app language choice cannot reach them.
    default_locale: "en",
    description: "__MSG_extDescription__",
    // tabs: title/URL of all window tabs for "Save & close tabs"; sidePanel: sessions and prompts view (Chromium only).
    permissions: ["storage", "activeTab", "scripting", "contextMenus", "alarms", "tabs", ...(browser === "firefox" ? [] : ["sidePanel"])],
    // The build's own Kortex needs no prompt; any other address is asked for on the options page.
    host_permissions: defaultUrl ? [`${new URL(defaultUrl).origin}/*`] : [],
    optional_host_permissions: ["https://*/*", "http://localhost/*", "http://127.0.0.1/*"],
    commands: {
      _execute_action: {
        suggested_key: { default: "Alt+K" },
        description: "__MSG_commandOpenClipper__",
      },
    },
    action: { default_title: `${NAME} Clipper (Alt+K)` },
  }),
});
