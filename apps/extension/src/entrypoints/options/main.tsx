import { StrictMode, useCallback, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { History, Inbox, PlugZap, Scissors, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { AppMark, Button, Card, Eyebrow, SegmentedTabs } from "@kortex/ui";
import "@fontsource-variable/geist";
import "@fontsource-variable/jetbrains-mono";
import "../../styles/ext.css";
import { applyLanguage, msg, startPage, t } from "../../i18n";
import { applyStatus, clearActivity, isOpen, readActivity, requestTitle, type ActivityEntry } from "../../lib/activity";
import { createApiClient, type IngestKind, type MockInboxEntry } from "../../lib/api";
import { describeFailure } from "../../lib/errors";
import { fetchStatusViaBackground, queueCommand } from "../../lib/messages";
import { clearMockInbox, readMockInbox } from "../../lib/mock-inbox";
import { readOutbox, type OutboxEntry } from "../../lib/outbox";
import { describePipeline } from "../../lib/result";
import {
  DEFAULT_BASE_URL,
  DEFAULT_SETTINGS,
  chromeStore,
  isMockMode,
  loadSettings,
  normalizeBaseUrl,
  saveSettings,
  type ExtensionSettings,
  type LanguageSetting,
  type SummaryLevel,
  type ThemeSetting,
} from "../../lib/settings";
import { normalizeUserTag } from "../../lib/suggest";
import { summaryTabs } from "../../ui/ClipSettings";
import { StatusChip } from "../../ui/StatusChip";
import { ThemeRoot, useDocumentTheme } from "../../ui/ThemeRoot";

const Field = ({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) => (
  <label className="grid gap-1.5">
    <Eyebrow>{label}</Eyebrow>
    {children}
    {hint && <span className="kx-t-meta text-muted">{hint}</span>}
  </label>
);

/** For segmented choices: a labelled group, not a <label> (a label around the tabs would name and click the first tab). */
const Group = ({ label, children }: { label: string; children: ReactNode }) => {
  const id = `x-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <div className="grid gap-1.5" role="group" aria-labelledby={id}>
      <Eyebrow id={id}>{label}</Eyebrow>
      {children}
    </div>
  );
};

/** Card head: icon tile, title, optional status on the right (same language as the side panel). */
const Head = ({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) => (
  <div className="kxh-row gap-3">
    <span className="kx-sp-badge" aria-hidden>
      <Icon />
    </span>
    <h2 className="kx-t-h3 m-0 kxh-grow">{title}</h2>
    {children}
  </div>
);

const Toggle = ({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) => (
  <label className="kx-opt-toggle">
    <span className="grid gap-0.5 kxh-grow">
      <span className="kx-t-body">{label}</span>
      {hint && <span className="kx-t-meta text-muted">{hint}</span>}
    </span>
    <input type="checkbox" role="switch" className="kx-switch mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
  </label>
);

/** `https://kortex.example.com:8443/x` -> `https://kortex.example.com/*` (match patterns carry no port). */
const hostPattern = (baseUrl: string) => {
  const u = new URL(baseUrl);
  return `${u.protocol}//${u.hostname}/*`;
};

const KIND_LABEL: Record<IngestKind, string> = { web_clip: msg("Clip"), highlight: msg("Highlight"), ai_chat: msg("Chat"), note: msg("Note") };

const list = (v: string) => v.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);

const inMinutes = (at: number, now: number) => {
  const min = Math.max(0, Math.round((at - now) / 60_000));
  return min < 1 ? t("in a moment") : t("in {min} min", { min });
};

type Status = { tone: "ok" | "error"; text: string };

function Options() {
  const [s, setS] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [folders, setFolders] = useState("");
  const [tags, setTags] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [connection, setConnection] = useState<Status | null>(null);
  const [testing, setTesting] = useState(false);
  const [inbox, setInbox] = useState<MockInboxEntry[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [queue, setQueue] = useState<OutboxEntry[]>([]);
  useDocumentTheme(s.theme);

  const refreshLists = useCallback(async () => {
    setInbox(await readMockInbox(chromeStore));
    setQueue(await readOutbox(chromeStore));
    const entries = await readActivity(chromeStore);
    setActivity(entries);
    // The pipeline may have finished since the capture: ask the server about entries that were still open.
    for (const e of entries.filter(isOpen).slice(0, 8)) {
      const res = await fetchStatusViaBackground(e.item_id);
      if (res.ok) setActivity(await applyStatus(chromeStore, res.data));
    }
  }, []);

  useEffect(() => {
    void loadSettings(chromeStore).then((v) => {
      setS(v);
      setFolders(v.clipFolders.join("\n"));
      setTags(v.defaultTags.join(", "));
      setLoaded(true);
    });
    void refreshLists();
  }, [refreshLists]);

  const patch = (p: Partial<ExtensionSettings>) => setS((cur) => ({ ...cur, ...p }));
  const mock = isMockMode(s);

  /** Asks for access to the Kortex address (needs the click) and normalises it; null = invalid input. */
  async function resolveBaseUrl(): Promise<{ baseUrl: string; denied: boolean } | null> {
    const baseUrl = normalizeBaseUrl(s.baseUrl);
    if (baseUrl === null) {
      setStatus({ tone: "error", text: t("The Kortex URL must start with https:// (http:// only for localhost).") });
      return null;
    }
    if (!baseUrl && !DEFAULT_BASE_URL) {
      setStatus({ tone: "error", text: t("Please enter the address of your Kortex, for example https://kortex.example.com.") });
      return null;
    }
    let denied = false;
    if (baseUrl) {
      // A build's own Kortex is declared in the manifest; any other address is asked for here. A refusal does
      // not block saving because the Kortex server answers extension origins with CORS headers.
      const granted = await chrome.permissions.request({ origins: [hostPattern(baseUrl)] }).catch(() => false);
      denied = !granted;
    }
    return { baseUrl: baseUrl || DEFAULT_BASE_URL, denied };
  }

  /** A first token switches the automatic mock mode off; an explicit "Mock-Modus" choice is kept otherwise. */
  const nextMockMode = (token: string, before: ExtensionSettings) =>
    !before.token.trim() && token && before.mockMode === true ? null : s.mockMode;

  async function save() {
    const target = await resolveBaseUrl();
    if (!target) return;
    const token = s.token.trim();
    if (s.mockMode === false && !token) return setStatus({ tone: "error", text: t("Live operation needs an API token.") });
    const before = await loadSettings(chromeStore);
    const next = await saveSettings(chromeStore, {
      ...s,
      baseUrl: target.baseUrl,
      token,
      mockMode: nextMockMode(token, before),
      clipFolders: list(folders),
      defaultTags: list(tags).map(normalizeUserTag).filter((tag): tag is string => !!tag),
    });
    setS(next);
    // The answer below is already in the chosen language; the other open pages follow through storage.
    applyLanguage(next.language);
    document.title = t("Kortex options");
    setStatus({ tone: "ok", text: target.denied ? t("Saved. Access to the address was not granted: the server's CORS allowance applies.") : t("Saved.") });
  }

  async function testConnection() {
    setTesting(true);
    setConnection(null);
    try {
      const target = await resolveBaseUrl();
      if (!target) return;
      const token = s.token.trim();
      if (!token) return setConnection({ tone: "error", text: t("Paste the API token first.") });
      const api = createApiClient({ getSettings: async () => ({ ...s, baseUrl: target.baseUrl, token, mockMode: false }) });
      const res = await api.ping();
      if (!res.ok) return setConnection({ tone: "error", text: describeFailure(res).message });
      // A working connection is worth keeping: store it (and leave the automatic mock mode) right away.
      const before = await loadSettings(chromeStore);
      const next = await saveSettings(chromeStore, { baseUrl: target.baseUrl, token, mockMode: nextMockMode(token, before) });
      patch({ baseUrl: next.baseUrl, token: next.token, mockMode: next.mockMode });
      setConnection({
        tone: "ok",
        text: res.data.token_name
          ? t("Connected with token “{name}” and saved. Captures now go to Kortex.", { name: res.data.token_name })
          : t("Connected and saved. Captures now go to Kortex."),
      });
    } finally {
      setTesting(false);
    }
  }

  async function flushQueue() {
    await queueCommand({ type: "kortex/flush" });
    await refreshLists();
  }

  async function dropFromQueue(id: string) {
    await queueCommand({ type: "kortex/outbox-remove", id });
    await refreshLists();
  }

  if (!loaded) return null;
  // Where the token is created: the entered Kortex, else the build's; null while neither is known.
  const tokenUrl = (() => {
    try {
      return new URL("/settings", `${normalizeBaseUrl(s.baseUrl) || DEFAULT_BASE_URL}/`).href;
    } catch {
      return null;
    }
  })();
  const now = Date.now();
  const tokenPath = t("Settings › Connectors › Personal API tokens");
  // The sentence carries the link in its middle: translated as a whole, split where the link goes.
  const [tokenBefore = "", tokenAfter = ""] = t("Create a personal token under {path} in Kortex, paste it here and test the connection.").split("{path}");
  return (
    <ThemeRoot theme={s.theme} className="kx-page">
      <main className="kx-opt mx-auto grid max-w-[640px] grid-cols-[minmax(0,1fr)] gap-4 px-4 pt-10 pb-6 [&>*]:min-w-0">
        <header className="kxh-row gap-3">
          <AppMark size={28} />
          <h1 className="type-h1 kxh-grow">{t("Kortex extension")}</h1>
        </header>

        <Card padded className="grid grid-cols-[minmax(0,1fr)] gap-4">
          <Head icon={PlugZap} title={t("Connection")}>
            {mock ? <StatusChip tone="warn">{t("Mock mode")}</StatusChip> : <StatusChip tone="ok">Live</StatusChip>}
          </Head>
          {!s.token.trim() && (
            <span className="kx-t-body text-secondary">
              {!tokenUrl && `${t("First enter the address of your Kortex.")} `}
              {tokenBefore}
              {tokenUrl ? <a className="underline" href={tokenUrl} target="_blank" rel="noreferrer">{tokenPath}</a> : tokenPath}
              {tokenAfter}
            </span>
          )}
          <Field
            label={t("Kortex URL")}
            hint={
              DEFAULT_BASE_URL
                ? t("The address of your Kortex. The extension sends to <URL>/api/ingest. The default is {url}.", { url: DEFAULT_BASE_URL })
                : t("The address of your Kortex. The extension sends to <URL>/api/ingest.")
            }
          >
            <div className="kx-control">
              <input className="kx-url" value={s.baseUrl} placeholder={DEFAULT_BASE_URL || "https://kortex.example.com"} inputMode="url" onChange={(e) => patch({ baseUrl: e.target.value })} />
            </div>
          </Field>
          <Field label={t("API token")} hint={t("Starts with kx_. Stored only locally in this browser (not synced) and sent as a bearer token.")}>
            <div className="kx-control">
              <input type="password" autoComplete="off" spellCheck={false} value={s.token} placeholder="kx_…" onChange={(e) => patch({ token: e.target.value })} />
            </div>
          </Field>
          <div className="kxh-row">
            <Button onClick={() => void testConnection()} disabled={testing || !s.token.trim()}>
              {testing ? t("Checking …") : t("Test connection")}
            </Button>
            {connection && (
              <span role="status" className={connection.tone === "ok" ? "kx-t-body text-secondary" : "kx-t-body text-urgent-text"}>
                {connection.text}
              </span>
            )}
          </div>
          <Toggle
            label={t("Mock mode")}
            hint={t("Nothing is sent to a server; captures only land in the “Saved locally” list. On automatically while no token is entered.")}
            checked={mock}
            onChange={(mockMode) => patch({ mockMode })}
          />
        </Card>

        <Card padded className="grid grid-cols-[minmax(0,1fr)] gap-4">
          <Head icon={SlidersHorizontal} title={t("Features")} />
          <Toggle label={t("Inline highlighter")} hint={t("Selected text shows a mini menu, right click “Save highlight to Kortex”.")} checked={s.highlighterEnabled} onChange={(highlighterEnabled) => patch({ highlighterEnabled })} />
          <Toggle label={t("ChatGPT and Claude export")} hint={t("Shows “Save to Kortex” on chatgpt.com and claude.ai.")} checked={s.chatExportEnabled} onChange={(chatExportEnabled) => patch({ chatExportEnabled })} />
          <Toggle
            label={t("Close tabs moved into a session")}
            hint={t("An open tab you drag into a session (or add through its menu) is closed once it is saved there, like “Save & close”. Pinned tabs stay open.")}
            checked={s.closeOnDrop}
            onChange={(closeOnDrop) => patch({ closeOnDrop })}
          />
          <Group label={t("Appearance")}>
            <SegmentedTabs<ThemeSetting>
              size="sm"
              block
              aria-label={t("Appearance")}
              value={s.theme}
              onChange={(theme) => patch({ theme })}
              tabs={[
                { value: "dark", label: t("Dark") },
                { value: "light", label: t("Light") },
                { value: "auto", label: t("System") },
              ]}
            />
          </Group>
          <Group label={t("Language")}>
            <SegmentedTabs<LanguageSetting>
              size="sm"
              block
              aria-label={t("Language")}
              value={s.language}
              onChange={(language) => patch({ language })}
              tabs={[
                { value: "auto", label: t("Browser language") },
                { value: "en", label: "English" },
                { value: "de", label: "Deutsch" },
              ]}
            />
          </Group>
        </Card>

        <Card padded className="grid grid-cols-[minmax(0,1fr)] gap-4">
          <Head icon={Scissors} title="Clipper" />
          {/* A group, not a <label>: a label around the tabs would name (and click) the first tab. */}
          <div className="grid gap-1.5" role="group" aria-labelledby="x-summary-level">
            <Eyebrow id="x-summary-level">{t("Summary detail")}</Eyebrow>
            <SegmentedTabs<SummaryLevel>
              size="sm"
              block
              aria-label={t("Summary detail")}
              value={s.summaryLevel}
              onChange={(summaryLevel) => patch({ summaryLevel })}
              tabs={summaryTabs()}
            />
            <span className="kx-t-meta text-muted">
              {t("Concise: TL;DR and key points. Detailed: longer summary with sections. Applies to clips and saved chats.")}
            </span>
          </div>
          <Toggle
            label="Autosave"
            hint={t("A click on the Kortex icon (or Alt+K) saves the page at once with the default filing and pre-selected hashtags. Feedback through the icon and a short window; offline captures are delivered later.")}
            checked={s.autosave}
            onChange={(autosave) => patch({ autosave })}
          />
          <Group label={t("Default filing")}>
            <SegmentedTabs<ExtensionSettings["defaultRoute"]>
              size="sm"
              block
              aria-label={t("Default filing")}
              value={s.defaultRoute}
              onChange={(defaultRoute) => patch({ defaultRoute })}
              tabs={[
                { value: "auto", label: t("Auto-routing") },
                { value: "manual", label: t("Choose folder") },
              ]}
            />
          </Group>
          <Field label={t("Folders to choose from")} hint={t("One per line, e.g. 30_Clippings or 60_Documents/Artikel.")}>
            <div className="kx-control h-auto py-2">
              <textarea rows={3} value={folders} onChange={(e) => setFolders(e.target.value)} className="w-full resize-none" />
            </div>
          </Field>
          <Field label={t("Default hashtags")} hint={t("Comma-separated, without #. Pre-selected in the clipper.")}>
            <div className="kx-control">
              <input value={tags} placeholder="ai/agents, reading/books" onChange={(e) => setTags(e.target.value)} />
            </div>
          </Field>
        </Card>

        <div className="kx-opt-savebar">
          <span role="status" className={`kxh-grow kx-t-body ${status?.tone === "error" ? "text-urgent-text" : "text-secondary"}`}>
            {status?.text ?? t("Changes apply after saving.")}
          </span>
          <Button variant="primary" size="lg" onClick={() => void save()}>
            {t("Save")}
          </Button>
        </div>

        {queue.length > 0 && (
          <Card padded className="grid grid-cols-[minmax(0,1fr)] gap-3">
            <div className="kxh-row">
              <span className="kx-sp-badge" aria-hidden><Inbox /></span>
              <strong className="kx-t-h3">{t("Queue")}</strong>
              <StatusChip tone="warn">{t("{n} waiting", { n: queue.length })}</StatusChip>
              <span className="kxh-grow" />
              <Button size="sm" onClick={() => void flushQueue()}>
                {t("Send now")}
              </Button>
            </div>
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-3">
              {queue.map((e) => (
                <li key={e.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-0.5">
                  <div className="kxh-row kx-t-body">
                    <span className="kx-t-meta w-16 shrink-0 text-muted">{t(KIND_LABEL[e.request.kind])}</span>
                    <span className="kx-truncate flex-1">{requestTitle(e.request)}</span>
                    <Button size="sm" variant="ghost" onClick={() => void dropFromQueue(e.id)}>
                      {t("Discard")}
                    </Button>
                  </div>
                  <span className="kx-t-meta pl-[4.5rem] text-muted [overflow-wrap:anywhere]">
                    {t("{status}. Attempt {attempts}, next {when}.", { status: e.lastError ?? t("Waiting for delivery"), attempts: e.attempts, when: inMinutes(e.nextAttemptAt, now) })}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {!mock && (
          <Card padded className="grid grid-cols-[minmax(0,1fr)] gap-3">
            <div className="kxh-row">
              <span className="kx-sp-badge" aria-hidden><History /></span>
              <strong className="kx-t-h3">{t("History")}</strong>
              <span className="kxh-grow" />
              <Button size="sm" disabled={activity.length === 0} onClick={() => void clearActivity(chromeStore).then(refreshLists)}>
                {t("Clear")}
              </Button>
            </div>
            {activity.length === 0 ? (
              <span className="kx-t-meta text-muted">{t("Nothing captured yet. Here you see where Kortex sorted your captures.")}</span>
            ) : (
              <ul className="grid grid-cols-[minmax(0,1fr)] gap-3">
                {activity.slice(0, 10).map((e) => {
                  const p = describePipeline(e);
                  return (
                    <li key={e.item_id + e.kind} className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-0.5">
                      <div className="kxh-row kx-t-body">
                        <span className="kx-t-meta w-16 shrink-0 text-muted">{t(KIND_LABEL[e.kind])}</span>
                        <span className="kx-truncate flex-1">{e.title}</span>
                        <StatusChip tone={p.tone}>{p.label}</StatusChip>
                      </div>
                      <span className="kx-t-meta pl-[4.5rem] text-muted [overflow-wrap:anywhere]">
                        {e.replayed ? `${t("Already arrived.")} ` : e.duplicate ? `${t("Merged.")} ` : ""}
                        {p.final && p.tone !== "error"
                          ? t("Sorted into {folder}", { folder: e.folder_path })
                          : e.auto_routed && !p.final
                            ? t("Being sorted, for now {folder}", { folder: e.folder_path })
                            : (p.detail ?? e.folder_path)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        )}

        {mock && (
          <Card padded className="grid grid-cols-[minmax(0,1fr)] gap-3">
            <div className="kxh-row">
              <span className="kx-sp-badge" aria-hidden><History /></span>
              <strong className="kx-t-h3">{t("Saved locally (not connected)")}</strong>
              <span className="kxh-grow" />
              <Button size="sm" disabled={inbox.length === 0} onClick={() => void clearMockInbox(chromeStore).then(refreshLists)}>
                {t("Clear")}
              </Button>
            </div>
            {inbox.length === 0 ? (
              <span className="kx-t-meta text-muted">{t("Nothing captured yet. In mock mode captures appear here.")}</span>
            ) : (
              <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
                {inbox.slice(0, 8).map((e) => (
                  <li key={e.at + e.response.item_id} className="kxh-row min-w-0 kx-t-body">
                    <span className="kx-t-meta w-16 shrink-0 text-muted">{t(KIND_LABEL[e.request.kind])}</span>
                    <span className="kx-truncate flex-1">{e.request.kind === "highlight" ? e.request.quote_text : e.request.title}</span>
                    <span className="kx-t-meta kx-truncate max-w-[40%] shrink text-muted" title={e.response.folder_path}>{e.response.folder_path}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </main>
    </ThemeRoot>
  );
}

const root = createRoot(document.getElementById("root")!);
void startPage(() => {
  document.title = t("Kortex options");
  root.render(
    <StrictMode>
      <Options />
    </StrictMode>,
  );
});
