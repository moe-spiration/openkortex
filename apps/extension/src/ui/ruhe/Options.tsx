// Options in the Ruhe look (2026-11-27): a left navigation (connection, capture, tabs & sessions, on websites,
// appearance, shortcuts, history, queue), every change saved at once with errors per field, and a two-step
// onboarding while no token is set ("Save locally, without a server" as the way out). Mock mode is "Local mode".
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  CircleCheck,
  CircleDashed,
  Clock,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  Highlighter,
  History,
  Inbox,
  Keyboard,
  Layers,
  MessageSquareText,
  Palette,
  Plug,
  RotateCw,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { PRODUCT_NAME, applyLanguage, intlLocale, msg, t, tn } from "../../i18n";
import { applyStatus, clearActivity, isOpen, readActivity, requestTitle, type ActivityEntry } from "../../lib/activity";
import { createApiClient, type IngestFailure, type MockInboxEntry, type PingInfo } from "../../lib/api";
import { describeFailure } from "../../lib/errors";
import { fetchStatusViaBackground, queueCommand } from "../../lib/messages";
import { clearMockInbox, readMockInbox } from "../../lib/mock-inbox";
import { readOutbox, type OutboxEntry } from "../../lib/outbox";
import { describePipeline } from "../../lib/result";
import {
  DEFAULT_BASE_URL,
  chromeStore,
  isMockMode,
  normalizeBaseUrl,
  saveSettings,
  type ExtensionSettings,
  type LanguageSetting,
  type LookSetting,
  type SummaryLevel,
  type ThemeSetting,
} from "../../lib/settings";
import { EXTENSION_VERSION } from "../../lib/requests";
import { normalizeUserTag } from "../../lib/suggest";
import { ALT, Btn, FolderPath, LocBar, Seg, Switch, TagDot } from "./kit";

export type OptionsSection = "connection" | "capture" | "tabs" | "web" | "appearance" | "shortcuts" | "history" | "queue";

const NAV: { key: OptionsSection; label: string; icon: ReactNode }[] = [
  { key: "connection", label: msg("Connection"), icon: <Plug aria-hidden /> },
  { key: "capture", label: msg("Capture"), icon: <Inbox aria-hidden /> },
  { key: "tabs", label: msg("Tabs & sessions"), icon: <Layers aria-hidden /> },
  { key: "web", label: msg("On websites"), icon: <Highlighter aria-hidden /> },
  { key: "appearance", label: msg("Appearance"), icon: <Palette aria-hidden /> },
  { key: "shortcuts", label: msg("Shortcuts"), icon: <Keyboard aria-hidden /> },
  { key: "history", label: msg("History"), icon: <History aria-hidden /> },
  { key: "queue", label: msg("Queue"), icon: <Clock aria-hidden /> },
];

const list = (v: string) => v.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
const hostPattern = (baseUrl: string) => {
  const u = new URL(baseUrl);
  return `${u.protocol}//${u.hostname}/*`;
};
const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};
const clock = (iso: string) => {
  try {
    const d = new Date(iso);
    return new Date().toDateString() === d.toDateString()
      ? d.toLocaleTimeString(intlLocale(), { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString(intlLocale(), { day: "numeric", month: "short" });
  } catch {
    return "";
  }
};

function Row({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <div className="rx-srow">
      <div className="rx-srow-tx">
        <div className="rx-srow-t">{title}</div>
        {sub && <div className="rx-srow-s">{sub}</div>}
      </div>
      <div className="rx-srow-c">{children}</div>
    </div>
  );
}

const FieldError = ({ text }: { text?: string | null }) =>
  text ? (
    <div className="rx-srow-s" role="alert" style={{ color: "var(--crit-ink)", marginTop: 6 }}>
      {text}
    </div>
  ) : null;

type Conn =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "ok"; info: PingInfo }
  | { state: "error"; code: string; title: string; message: string };

export interface RuheOptionsProps {
  initial: ExtensionSettings;
  /** Previews: no server checks. */
  offline?: boolean;
  initialSection?: OptionsSection;
}

export function RuheOptions({ initial, offline, initialSection }: RuheOptionsProps) {
  const [s, setS] = useState(initial);
  const [section, setSection] = useState<OptionsSection>(() => initialSection ?? ((location.hash.slice(1) as OptionsSection) || "connection"));
  const [saved, setSaved] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [conn, setConn] = useState<Conn>({ state: "idle" });
  const [url, setUrl] = useState(initial.baseUrl);
  const [token, setToken] = useState(initial.token);
  const [showToken, setShowToken] = useState(false);
  const [folders, setFolders] = useState(initial.clipFolders.join("\n"));
  const [tags, setTags] = useState(initial.defaultTags.join(", "));
  const [queue, setQueue] = useState<OutboxEntry[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [inbox, setInbox] = useState<MockInboxEntry[]>([]);
  const [commands, setCommands] = useState<chrome.commands.Command[]>([]);
  const [onboarding, setOnboarding] = useState(!initial.token.trim() && initial.mockMode !== true);
  const mock = isMockMode(s);

  useEffect(() => {
    const on = () => setSection(((location.hash.slice(1) as OptionsSection) || "connection"));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = (key: OptionsSection) => {
    setSection(key);
    try {
      history.replaceState(null, "", `#${key}`);
    } catch {
      /* preview */
    }
  };

  const refreshLists = useCallback(async () => {
    setInbox(await readMockInbox(chromeStore));
    setQueue(await readOutbox(chromeStore));
    const entries = await readActivity(chromeStore);
    setActivity(entries);
    if (offline) return;
    for (const e of entries.filter(isOpen).slice(0, 8)) {
      const res = await fetchStatusViaBackground(e.item_id);
      if (res.ok) setActivity(await applyStatus(chromeStore, res.data));
    }
  }, [offline]);
  useEffect(() => void refreshLists(), [refreshLists]);
  useEffect(() => {
    try {
      void chrome.commands?.getAll?.().then(setCommands);
    } catch {
      /* no commands API (preview) */
    }
  }, []);

  /** Saves at once and says so in the location bar. */
  const commit = useCallback(async (patch: Partial<ExtensionSettings>) => {
    const next = await saveSettings(chromeStore, patch);
    setS(next);
    if (patch.language) applyLanguage(next.language);
    setSaved(t("Saved"));
    setTimeout(() => setSaved(null), 1600);
    return next;
  }, []);

  const ping = useCallback(
    async (settings: ExtensionSettings) => {
      if (offline || !settings.token.trim()) return setConn({ state: "idle" });
      setConn({ state: "checking" });
      const res = await createApiClient({ getSettings: async () => ({ ...settings, mockMode: false }) }).ping();
      if (res.ok) setConn({ state: "ok", info: res.data });
      else {
        const view = describeFailure(res as IngestFailure);
        setConn({ state: "error", code: res.error.code, title: view.title, message: view.message });
      }
    },
    [offline],
  );
  useEffect(() => void ping(initial), [ping, initial]);

  /** Address: normalised, access requested (needs the click of Connect/Test), stored. */
  async function saveUrl(ask: boolean): Promise<string | null> {
    const baseUrl = normalizeBaseUrl(url);
    if (baseUrl === null) {
      setErrors((e) => ({ ...e, url: t("The Kortex URL must start with https:// (http:// only for localhost).") }));
      return null;
    }
    if (!baseUrl && !DEFAULT_BASE_URL) {
      setErrors((e) => ({ ...e, url: t("Please enter the address of your Kortex, for example https://kortex.example.com.") }));
      return null;
    }
    setErrors((e) => ({ ...e, url: null }));
    const target = baseUrl || DEFAULT_BASE_URL;
    if (ask && baseUrl) await chrome.permissions?.request({ origins: [hostPattern(baseUrl)] }).catch(() => false);
    if (target !== s.baseUrl) await commit({ baseUrl: target });
    setUrl(target);
    return target;
  }

  async function saveToken() {
    const value = token.trim();
    if (value && !/^kx_/.test(value)) {
      setErrors((e) => ({ ...e, token: t("A Kortex token starts with kx_.") }));
      return null;
    }
    setErrors((e) => ({ ...e, token: null }));
    if (value === s.token) return s;
    // A first token leaves the automatic local mode.
    return commit({ token: value, mockMode: !s.token.trim() && value && s.mockMode === true ? null : s.mockMode });
  }

  async function connect() {
    const target = await saveUrl(true);
    if (!target) return;
    const value = token.trim();
    if (!value) return setErrors((e) => ({ ...e, token: t("Paste the API token first.") }));
    const next = await saveToken();
    if (!next) return;
    await ping({ ...next, baseUrl: target, token: value });
    setOnboarding(false);
  }

  const tokenUrl = (() => {
    try {
      return new URL("/settings", `${normalizeBaseUrl(url) || DEFAULT_BASE_URL}/`).href;
    } catch {
      return null;
    }
  })();

  /* ---------- onboarding ---------- */
  if (onboarding) {
    return (
      <div className="rx rx-opt">
        <LocBar title={`${PRODUCT_NAME} Clipper`}>
          <span className="rx-faint" style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center", marginRight: 8 }}>
            <span className="rx-dot rx-dot--off" aria-hidden />
            {t("Not connected")}
          </span>
        </LocBar>
        <div className="rx-onb">
          <form
            className="rx-onb-in"
            onSubmit={(e) => {
              e.preventDefault();
              void connect();
            }}
          >
            <div>
              <div className="rx-h1" style={{ fontSize: 24 }}>
                {t("Connect to your Kortex")}
              </div>
              <div className="rx-muted" style={{ marginTop: 6 }}>
                {t("Two entries, then everything lands in your inbox.")}
              </div>
            </div>
            <div>
              <div className="rx-onb-step">
                <span className="rx-num rx-faint">1</span>
                {t("Address")}
              </div>
              <label className="rx-field">
                <input autoFocus value={url} placeholder={DEFAULT_BASE_URL || "https://kortex.example.com"} inputMode="url" aria-label={t("Kortex URL")} onChange={(e) => setUrl(e.target.value)} onBlur={() => void saveUrl(false)} />
              </label>
              <FieldError text={errors.url} />
            </div>
            <div>
              <div className="rx-onb-step">
                <span className="rx-num rx-faint">2</span>
                {t("Token")}
                <span className="rx-grow" />
                {tokenUrl && (
                  <a className="rx-ink" style={{ fontSize: 12.5, fontWeight: 500, display: "flex", gap: 5, alignItems: "center", textDecoration: "none" }} href={tokenUrl} target="_blank" rel="noreferrer">
                    {t("Create a token in Kortex")} <ExternalLink size={12} aria-hidden />
                  </a>
                )}
              </div>
              <label className="rx-field">
                <input type="password" autoComplete="off" spellCheck={false} value={token} placeholder="kx_…" aria-label={t("API token")} onChange={(e) => setToken(e.target.value)} />
              </label>
              <FieldError text={errors.token} />
              <div className="rx-faint" style={{ fontSize: 12, marginTop: 6 }}>
                {t("Settings › Connectors › Personal API tokens. Shown once. Tick “Search” and “Ask” for the side panel.")}
              </div>
            </div>
            {conn.state === "error" && (
              <div className="rx-banner rx-banner--crit" role="alert">
                <TriangleAlert aria-hidden />
                <div>
                  <b>{conn.title}</b>
                  {conn.message}
                </div>
              </div>
            )}
            <Btn variant="pri" big block kbd="↵" type="submit" disabled={conn.state === "checking"}>
              {conn.state === "checking" ? t("Checking …") : t("Connect")}
            </Btn>
            <div style={{ textAlign: "center", fontSize: 12.5, color: "var(--t3)" }}>
              {t("Try it first?")}{" "}
              <button
                type="button"
                style={{ color: "var(--t1)", fontWeight: 500 }}
                onClick={() => {
                  void commit({ mockMode: true });
                  setOnboarding(false);
                  go("capture");
                }}
              >
                {t("Save locally, without a server")}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  const now = Date.now();
  const sectionLabel = t(NAV.find((n) => n.key === section)!.label);

  const body: Record<OptionsSection, ReactNode> = {
    connection: (
      <>
        <div className="rx-h1">{t("Connection")}</div>
        <div className="rx-desc">{t("Where the clipper sends to. The token stays in this browser only.")}</div>
        {mock ? (
          <div className="rx-status rx-status--off">
            <CircleDashed aria-hidden />
            <div className="rx-grow">
              <div style={{ fontWeight: 550 }}>{t("Local mode")}</div>
              <div className="rx-muted" style={{ fontSize: 12.5 }}>
                {t("Nothing leaves the browser. Captures are listed under History.")}
              </div>
            </div>
            {s.mockMode === true && s.token.trim() && (
              <Btn variant="line" onClick={() => void commit({ mockMode: null })}>
                {t("Go live")}
              </Btn>
            )}
            {!s.token.trim() && (
              <Btn variant="pri" onClick={() => setOnboarding(true)}>
                {t("Connect")}
              </Btn>
            )}
          </div>
        ) : conn.state === "error" ? (
          <div className="rx-status rx-status--crit" role="alert">
            <TriangleAlert aria-hidden />
            <div className="rx-grow">
              <div style={{ fontWeight: 550 }}>{conn.code === "unauthorized" ? t("Token rejected (401)") : conn.title}</div>
              <div className="rx-muted" style={{ fontSize: 12.5 }}>
                {conn.code === "unauthorized" ? t("Revoked or expired.") : conn.message !== conn.title ? conn.message : ""} {queue.length ? tn(queue.length, "{n} capture waits and is sent afterwards.", "{n} captures wait and are sent afterwards.") : ""}
              </div>
            </div>
            {conn.code === "unauthorized" ? (
              <Btn variant="pri" onClick={() => (setToken(""), document.getElementById("rx-token")?.focus())}>
                {t("Paste a new token")}
              </Btn>
            ) : (
              <Btn variant="line" onClick={() => void ping(s)}>
                <RotateCw /> {t("Test")}
              </Btn>
            )}
          </div>
        ) : (
          <div className="rx-status rx-status--ok" role="status">
            {conn.state === "checking" ? <CircleDashed aria-hidden /> : <CircleCheck aria-hidden />}
            <div className="rx-grow">
              <div style={{ fontWeight: 550 }}>{conn.state === "checking" ? t("Checking …") : t("Connected with {host}", { host: hostOf(s.baseUrl) })}</div>
              <div className="rx-muted" style={{ fontSize: 12.5 }}>
                {[conn.state === "ok" && conn.info.token_name ? t("Token “{name}”", { name: conn.info.token_name }) : null, activity[0] ? t("last sent {when}", { when: clock(activity[0].at) }) : null].filter(Boolean).join(" · ")}
              </div>
            </div>
            <Btn variant="line" onClick={() => void ping(s)} disabled={conn.state === "checking"}>
              <RotateCw /> {t("Test")}
            </Btn>
            <Btn
              onClick={() => {
                setToken("");
                void commit({ token: "" });
                setConn({ state: "idle" });
              }}
            >
              {t("Disconnect")}
            </Btn>
          </div>
        )}
        <div className="rx-sgl">{t("Server")}</div>
        <Row title={t("Kortex address")} sub={t("The clipper sends to <URL>/api/ingest.")}>
          <div style={{ width: "100%" }}>
            <label className="rx-field">
              <input value={url} placeholder={DEFAULT_BASE_URL || "https://kortex.example.com"} inputMode="url" aria-label={t("Kortex URL")} onChange={(e) => setUrl(e.target.value)} onBlur={() => void saveUrl(false)} onKeyDown={(e) => e.key === "Enter" && void saveUrl(true)} />
            </label>
            <FieldError text={errors.url} />
          </div>
        </Row>
        <Row title={t("API token")} sub={t("Starts with kx_. Created under Settings › Connectors.")}>
          <div style={{ width: "100%" }}>
            <label className="rx-field">
              <input
                id="rx-token"
                type={showToken ? "text" : "password"}
                autoComplete="off"
                spellCheck={false}
                value={token}
                placeholder="kx_…"
                aria-label={t("API token")}
                onChange={(e) => setToken(e.target.value)}
                onBlur={() => void saveToken().then((n) => n && void ping(n))}
              />
              <button type="button" aria-label={showToken ? t("Hide token") : t("Show token")} onClick={() => setShowToken(!showToken)} className="rx-faint">
                {showToken ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
              </button>
            </label>
            <FieldError text={errors.token} />
          </div>
        </Row>
        <div className="rx-sgl">{t("Trial")}</div>
        <Row title={t("Local mode")} sub={t("Nothing leaves the browser; captures land under History › Local. On automatically without a token.")}>
          <Switch label={t("Local mode")} checked={mock} onChange={(on) => void commit({ mockMode: on ? true : s.token.trim() ? null : false }).then((n) => !on && !n.token.trim() && setOnboarding(true))} />
        </Row>
      </>
    ),
    capture: (
      <>
        <div className="rx-h1">{t("Capture")}</div>
        <div className="rx-desc">{t("What a click on the Kortex icon or {key} does.", { key: `${ALT}K` })}</div>
        <Row title="Autosave" sub={t("A click saves at once with auto filing and the default tags. The form is one click away: right-click the icon, “Clip with form”.")}>
          <Switch label="Autosave" checked={s.autosave} onChange={(autosave) => void commit({ autosave })} />
        </Row>
        <Row title={t("Default filing")} sub={t("Auto lets the agent file it; a folder counts as manual placement.")}>
          <Seg<ExtensionSettings["defaultRoute"]>
            label={t("Default filing")}
            value={s.defaultRoute}
            onChange={(defaultRoute) => void commit({ defaultRoute })}
            options={[
              { value: "auto", label: t("Auto"), icon: <Sparkles /> },
              { value: "manual", label: t("Folder"), disabled: s.clipFolders.length === 0 },
            ]}
          />
        </Row>
        <Row title={t("Summary")} sub={t("Applies to pages and saved chats.")}>
          <Seg<SummaryLevel>
            label={t("Summary detail")}
            value={s.summaryLevel}
            onChange={(summaryLevel) => void commit({ summaryLevel })}
            options={[
              { value: "concise", label: t("Concise") },
              { value: "detailed", label: t("Detailed") },
            ]}
          />
        </Row>
        <Row title={t("Default tags")} sub={t("Pre-selected in the clipper. Comma-separated, without #.")}>
          <div style={{ width: "100%" }}>
            <label className="rx-field">
              <input
                value={tags}
                placeholder="ai/agents, reading/books"
                aria-label={t("Default tags")}
                onChange={(e) => setTags(e.target.value)}
                onBlur={() => {
                  const raw = list(tags);
                  const ok = raw.map(normalizeUserTag).filter((x): x is string => !!x);
                  setErrors((er) => ({ ...er, tags: ok.length < raw.length ? t("Some tags were not valid and were left out.") : null }));
                  setTags(ok.join(", "));
                  void commit({ defaultTags: ok });
                }}
              />
            </label>
            {s.defaultTags.length > 0 && (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
                {s.defaultTags.map((tag) => (
                  <TagDot key={tag} tag={tag} />
                ))}
              </div>
            )}
            <FieldError text={errors.tags} />
          </div>
        </Row>
        <Row title={t("Folders in the picker")} sub={t("At the top of the folder list, one per line (e.g. 30_Clippings/Product).")}>
          <label className="rx-field rx-field--area" style={{ width: "100%" }}>
            <textarea rows={4} value={folders} aria-label={t("Folders in the picker")} onChange={(e) => setFolders(e.target.value)} onBlur={() => void commit({ clipFolders: list(folders) })} />
          </label>
        </Row>
      </>
    ),
    tabs: (
      <>
        <div className="rx-h1">{t("Tabs & sessions")}</div>
        <div className="rx-desc">{t("How the tab manager and the side panel save your tabs.")}</div>
        <Row title={t("Close tabs moved into a session")} sub={t("An open tab you drag into a session (or add through its menu) is closed once it is saved there, like “Save & close”. Pinned tabs stay open.")}>
          <Switch label={t("Close tabs moved into a session")} checked={s.closeOnDrop} onChange={(closeOnDrop) => void commit({ closeOnDrop })} />
        </Row>
        <Row title={t("Tab manager")} sub={t("Full screen: sessions, open tabs of all windows, suggestions.")}>
          <Btn variant="line" onClick={() => void chrome.runtime.sendMessage({ type: "kortex/open-manager" }).catch(() => undefined)}>
            <Layers /> {t("Open")}
          </Btn>
        </Row>
      </>
    ),
    web: (
      <>
        <div className="rx-h1">{t("On websites")}</div>
        <div className="rx-desc">{t("What the clipper adds to the pages you read.")}</div>
        <Row title={t("Highlighting on websites")} sub={t("A selection shows the bar; H highlights, N adds a note, A asks Kortex.")}>
          <Switch label={t("Highlighting on websites")} checked={s.highlighterEnabled} onChange={(highlighterEnabled) => void commit({ highlighterEnabled })} />
        </Row>
        <Row title={t("ChatGPT and Claude")} sub={t("Buttons “Save chat”, “Save answer”, “As prompt”.")}>
          <Switch label={t("ChatGPT and Claude")} checked={s.chatExportEnabled} onChange={(chatExportEnabled) => void commit({ chatExportEnabled })} />
        </Row>
        <div className="rx-srow-s" style={{ maxWidth: 640 }}>
          {t("Pages that are already open pick up a change after a reload.")}
        </div>
      </>
    ),
    appearance: (
      <>
        <div className="rx-h1">{t("Appearance")}</div>
        <div className="rx-desc">{t("Applies to the popup, side panel, tab manager and these options.")}</div>
        <Row title={t("Theme")}>
          <Seg<ThemeSetting>
            label={t("Appearance")}
            value={s.theme}
            onChange={(theme) => void commit({ theme })}
            options={[
              { value: "dark", label: t("Dark") },
              { value: "light", label: t("Light") },
              { value: "auto", label: t("System") },
            ]}
          />
        </Row>
        <Row title={t("Look")} sub={t("Calm is the new default; Vivid keeps the earlier look.")}>
          <Seg<LookSetting>
            label={t("Look")}
            value={s.look}
            onChange={(look) => void commit({ look })}
            options={[
              { value: "ruhe", label: t("Calm") },
              { value: "vivid", label: t("Vivid") },
            ]}
          />
        </Row>
        <Row title={t("Language")}>
          <Seg<LanguageSetting>
            label={t("Language")}
            value={s.language}
            onChange={(language) => void commit({ language })}
            options={[
              { value: "auto", label: t("Browser") },
              { value: "en", label: "English" },
              { value: "de", label: "Deutsch" },
            ]}
          />
        </Row>
      </>
    ),
    shortcuts: (
      <>
        <div className="rx-h1">{t("Shortcuts")}</div>
        <div className="rx-desc">{t("Set in the browser; the clipper suggests these.")}</div>
        {(commands.length
          ? commands
          : [
              { name: "_execute_action", shortcut: "Alt+K" },
              { name: "open-sidepanel", shortcut: "Alt+S" },
              { name: "open-manager", shortcut: "Alt+T" },
            ]
        ).map((c) => (
          <Row
            key={c.name}
            title={c.name === "_execute_action" ? t("Open the clipper") : c.name === "open-sidepanel" ? t("Open the side panel") : c.name === "open-manager" ? t("Open the tab manager") : (c.description ?? c.name ?? "")}
          >
            {c.shortcut ? <kbd className="rx-kbd" style={{ fontSize: 12, padding: "1px 7px" }}>{c.shortcut}</kbd> : <span className="rx-faint">{t("not set")}</span>}
          </Row>
        ))}
        <div className="rx-sgl">{t("In the clipper")}</div>
        {[
          ["↵", t("Save (popup)")],
          ["O", t("Open in Kortex after saving")],
          ["R", t("Remind, then 1 to 4")],
          ["H / N / A", t("Highlight, note, ask (selection on a page)")],
          ["1 2 3", t("Side panel views")],
          ["/", t("Search (side panel, tab manager)")],
        ].map(([k, label]) => (
          <Row key={k} title={label!}>
            <kbd className="rx-kbd" style={{ fontSize: 12, padding: "1px 7px" }}>
              {k}
            </kbd>
          </Row>
        ))}
        <div style={{ marginTop: 14 }}>
          <Btn variant="line" onClick={() => void chrome.tabs.create({ url: "chrome://extensions/shortcuts" }).catch(() => undefined)}>
            <Keyboard /> {t("Change in the browser")}
          </Btn>
        </div>
      </>
    ),
    history: (
      <>
        <div className="rx-h1">{t("History")}</div>
        <div className="rx-desc">{mock ? t("Local mode: what was captured in this browser.") : t("Where Kortex sorted your last captures.")}</div>
        {!mock &&
          (activity.length === 0 ? (
            <div className="rx-muted">{t("Nothing captured yet. Here you see where Kortex sorted your captures.")}</div>
          ) : (
            <div style={{ maxWidth: 760 }}>
              {activity.slice(0, 20).map((e) => {
                const p = describePipeline(e);
                return (
                  <div key={e.item_id + e.kind} className="rx-row" style={{ height: 34, margin: "0 -8px" }}>
                    {e.kind === "highlight" ? <Highlighter aria-hidden /> : e.kind === "ai_chat" ? <MessageSquareText aria-hidden /> : <Globe aria-hidden />}
                    <span className="rx-row-t" style={{ width: 240, flex: "none" }}>
                      {e.title}
                    </span>
                    <span className="rx-row-s">
                      <FolderPath path={e.folder_path} />
                    </span>
                    <span className="rx-row-r">
                      <span className={`rx-dot rx-dot--${p.tone === "error" ? "crit" : p.final ? "ok" : "warn"}`} aria-hidden />
                      {e.replayed ? t("Already arrived") : e.duplicate ? t("Merged") : p.label}
                      <span className="rx-num" style={{ width: 56, textAlign: "right" }}>
                        {clock(e.at)}
                      </span>
                    </span>
                  </div>
                );
              })}
              <div style={{ marginTop: 12 }}>
                <Btn onClick={() => void clearActivity(chromeStore).then(refreshLists)}>{t("Clear")}</Btn>
              </div>
            </div>
          ))}
        {mock &&
          (inbox.length === 0 ? (
            <div className="rx-muted">{t("Nothing captured yet. In mock mode captures appear here.")}</div>
          ) : (
            <div style={{ maxWidth: 760 }}>
              {inbox.slice(0, 20).map((e) => (
                <div key={e.at + e.response.item_id} className="rx-row" style={{ height: 34, margin: "0 -8px" }}>
                  {e.request.kind === "highlight" ? <Highlighter aria-hidden /> : <Globe aria-hidden />}
                  <span className="rx-row-t" style={{ width: 280, flex: "none" }}>
                    {e.request.kind === "highlight" ? e.request.quote_text : e.request.title}
                  </span>
                  <span className="rx-row-s">
                    <FolderPath path={e.response.folder_path} />
                  </span>
                  <span className="rx-row-r rx-num">{clock(e.at)}</span>
                </div>
              ))}
              <div style={{ marginTop: 12 }}>
                <Btn onClick={() => void clearMockInbox(chromeStore).then(refreshLists)}>{t("Clear")}</Btn>
              </div>
            </div>
          ))}
      </>
    ),
    queue: (
      <>
        <div className="rx-h1">{t("Queue")}</div>
        <div className="rx-desc">{t("Not delivered yet. Kortex keeps trying, first after a minute, then less often.")}</div>
        {queue.length === 0 ? (
          <div className="rx-muted" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="rx-dot rx-dot--ok" aria-hidden /> {t("Nothing waiting.")}
          </div>
        ) : (
          <>
            {queue.map((e) => (
              <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 4px", maxWidth: 760 }}>
                <span className="rx-dot rx-dot--warn" aria-hidden />
                <div className="rx-grow">
                  <div className="rx-trunc" style={{ fontWeight: 500 }}>
                    {e.request.kind === "highlight" ? `“${e.request.quote_text.slice(0, 80)}”` : requestTitle(e.request)}
                  </div>
                  <div className="rx-muted rx-trunc" style={{ fontSize: 12.5 }}>
                    {t("{status}. Attempt {attempts}, next {when}.", {
                      status: e.lastError ?? t("Waiting for delivery"),
                      attempts: e.attempts,
                      when: (() => {
                        const min = Math.max(0, Math.round((e.nextAttemptAt - now) / 60_000));
                        return min < 1 ? t("in a moment") : t("in {min} min", { min });
                      })(),
                    })}
                  </div>
                </div>
                <Btn variant="line" onClick={() => void queueCommand({ type: "kortex/flush" }).then(refreshLists)}>
                  {t("Send now")}
                </Btn>
                <Btn onClick={() => void queueCommand({ type: "kortex/outbox-remove", id: e.id }).then(refreshLists)}>{t("Discard")}</Btn>
              </div>
            ))}
          </>
        )}
      </>
    ),
  };

  return (
    <div className="rx rx-opt">
      <LocBar title={t("Settings")} place={sectionLabel}>
        <span className="rx-faint" style={{ fontSize: 12, marginRight: 6 }} role="status">
          {saved ?? t("Changes are saved at once")}
        </span>
      </LocBar>
      <div className="rx-opt-grid">
        <nav className="rx-opt-nav" aria-label={t("Settings")}>
          {NAV.map((n, i) => (
            <div key={n.key} style={{ display: "contents" }}>
              {i === 6 && <div style={{ height: 12 }} />}
              <button type="button" className="rx-row" data-active={section === n.key ? "" : undefined} aria-current={section === n.key ? "page" : undefined} onClick={() => go(n.key)}>
                {n.icon}
                <span className="rx-row-t">{t(n.label)}</span>
                {n.key === "queue" && queue.length > 0 && <span className="rx-row-r rx-num">{queue.length}</span>}
              </button>
            </div>
          ))}
          <div className="rx-tm-foot">
            <span className={`rx-dot ${mock ? "rx-dot--off" : conn.state === "error" ? "rx-dot--crit" : "rx-dot--ok"}`} aria-hidden />
            {mock ? t("Local") : "Live"}
            <span className="rx-grow" />
            <span className="rx-faint">v{EXTENSION_VERSION}</span>
          </div>
        </nav>
        <main className="rx-opt-main">{body[section]}</main>
      </div>
    </div>
  );
}

