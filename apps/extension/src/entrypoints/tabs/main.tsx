// Vollbild-Tab-Manager (Toby-Stil): links die Sessions als Index, in der Mitte die Sammlungen mit Tab-Karten,
// rechts die offenen Tabs aller Fenster. Geöffnet aus dem Side-Panel, per Rechtsklick aufs Symbol oder chrome-extension://…/tabs.html.
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource-variable/jetbrains-mono";
import "../../styles/ext.css";
import { startPage } from "../../i18n";
import { TabManager } from "../../ui/TabManager";
import { RuheTabManager } from "../../ui/ruhe/TabManager";
import { DEFAULT_SETTINGS, chromeStore, loadSettings, type ExtensionSettings } from "../../lib/settings";
import { useDocumentTheme, useResolvedTheme } from "../../ui/ThemeRoot";

function App() {
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  useEffect(() => void loadSettings(chromeStore).then(setSettings), []);
  useDocumentTheme(settings.theme, settings.look);
  const theme = useResolvedTheme(settings.theme);
  return settings.look === "ruhe" ? <RuheTabManager baseUrl={settings.baseUrl} theme={theme} /> : <TabManager baseUrl={settings.baseUrl} theme={theme} />;
}

const root = createRoot(document.getElementById("root")!);
void startPage(() =>
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
