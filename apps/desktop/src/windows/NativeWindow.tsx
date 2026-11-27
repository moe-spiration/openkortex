import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState, type CSSProperties } from "react";
import { bridge, type AccountStatus } from "@/bridge";
import { DIco } from "@/components/icons";
import { Keys } from "@/components/Key";
import { Wave } from "@/components/Wave";
import { HOTKEYS, SYS_OPTS, WIN_TITLES, type NativeWin } from "@/data";
import { LOCALE_NAMES, getLocale, msg, t, type Locale } from "@/i18n";
import { VaultSettings } from "./VaultSettings";
import {
  ACCENT_CHOICES,
  ACCENT_STORAGE_KEY,
  FONT_SCALES,
  FONT_SCALE_KEY,
  LOOK_KEY,
  THEME_KEY,
  accentHex,
  applyAccent,
  applyFontScale,
  applyLook,
  applyTheme,
  readFontScale,
  readLook,
  readTheme,
  resolveAccent,
  resolveTheme,
  type Look,
  type ThemePref,
} from "@/theme";
import type { SearchHit } from "@/launcher";
import { DEFAULT_DEVICE, deviceLabel, useDesktop } from "@/state/desktop";
import { meetingStatus } from "@/state/meeting";
import { Clock } from "@/state/clock";
import { dragWindow } from "@/components/drag";

export const NATIVE_PLACEMENT: CSSProperties = {
  position: "absolute",
  left: "50%",
  top: 120,
  width: 620,
  marginLeft: -310,
  zIndex: 45,
  maxHeight: 660,
};

const switchRow = (
  label: string,
  help: string,
  on: boolean,
  toggle: () => void,
  minHeight: number,
) => (
  <label key={label} className="kxd-set-line" style={{ minHeight, cursor: "pointer" }}>
    <div className="kxh-col kxh-grow" style={{ gap: 0 }}>
      <span className="kxd-set-name">{label}</span>
      <span className="kx-help">{help}</span>
    </div>
    <input
      type="checkbox"
      className="kx-switch"
      checked={on}
      onChange={toggle}
      aria-label={label}
    />
  </label>
);

/**
 * Meeting-Center: start or stop the recording, the state of the running meeting, and the latest
 * meetings from the vault (GET /api/search, type meeting; a click opens the protocol in the main
 * window). No calendar connection yet, so nothing here pretends to know upcoming calls.
 */
function MeetingCenter() {
  const d = useDesktop();
  const b = bridge();
  const [recent, setRecent] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = d.phase === "live";
  const session = d.meeting.session;

  // Reload when a meeting was saved (phase "done"), so the new protocol shows up.
  useEffect(() => {
    if (!d.connected) return;
    let on = true;
    b.invoke("launcher_search", { q: "", kind: "meeting", limit: 8 }).then(
      (r) => {
        if (!on) return;
        setRecent(r.results);
        setError(null);
      },
      (e: unknown) => {
        if (!on) return;
        setRecent([]);
        setError(String(e));
      },
    );
    return () => {
      on = false;
    };
  }, [b, d.connected, d.phase]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 20 }}>
      <div className="kxh-row" style={{ gap: 12, flexWrap: "wrap" }}>
        <div className="kxh-col kxh-grow" style={{ gap: 2, minWidth: 0, flexBasis: 240 }}>
          <h2 className="kx-h-section" style={{ margin: 0, overflowWrap: "anywhere" }}>
            {live ? <>{t("Recording in progress")} · <Clock /></> : d.phase === "gen" ? t("Minutes are being created") : t("No meeting active")}
          </h2>
          <span className="kx-help">{meetingStatus(d.connected, live, session.state, d.meeting.transcript.message)}</span>
        </div>
        <button
          type="button"
          className={live ? "kxd-nw-stop" : "kx-btn kx-btn--primary"}
          style={{ minHeight: 36, flex: "none" }}
          onClick={d.toggleRecording}
          disabled={d.phase === "gen"}
        >
          <DIco name={live ? "stop" : "rec"} />
          {live ? t("Stop recording") : t("Start recording")}
        </button>
      </div>
      {live && (
        <button type="button" className="kx-btn kx-btn--ghost" style={{ justifySelf: "start" }} onClick={() => d.setMode("hud")}>
          <DIco name="hud" />
          {t("Show live HUD")}
        </button>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 4 }}>
        <h3 className="kxd-set-h">{t("Recent meetings")}</h3>
        {!d.connected && <span className="kx-help">{t("Connect a Kortex account in the settings, then your minutes from 20_Meetings/ appear here.")}</span>}
        {d.connected && recent === null && <span className="kx-help">{t("Loading …")}</span>}
        {error && <span className="kx-help" style={{ overflowWrap: "anywhere" }}>{error}</span>}
        {d.connected && recent?.length === 0 && !error && <span className="kx-help">{t("No meetings in the vault yet.")}</span>}
        {recent?.map((m) => (
          <button key={m.item_id} type="button" className="kxd-nw-row" onClick={() => d.openItem(m.item_id)} title={t("Open in the Kortex window")}>
            <DIco name="cal" sm />
            <span className="kxd-nw-rowtitle kx-truncate">{m.title}</span>
            {m.snippet && <span className="kxd-nw-rowmeta kx-truncate">{m.snippet}</span>}
            {m.page_or_timestamp && <span className="kxd-nw-rowdate kx-num">{m.page_or_timestamp}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
function AudioSetup() {
  const d = useDesktop();
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 10 }}>
        <div className="kxh-row">
          <DIco name="mic" className="kxd-nw-chico" />
          <div className="kxh-col" style={{ gap: 0 }}>
            <span className="kxd-set-name">{t("Channel 0 · Microphone")}</span>
            <span className="kx-help">{t("Your voice, recorded separately")}</span>
          </div>
        </div>
        <button
          type="button"
          className="kxb kx-control kx-select"
          style={{ width: "100%", height: 40 }}
          onClick={d.nextMic}
        >
          <span className="kx-truncate" style={{ color: "var(--text-primary)" }}>
            {deviceLabel(d.mic === 0 ? t(DEFAULT_DEVICE) : d.mics[d.mic], d.mic, d.defaultInput)}
          </span>
          <DIco name="chev-d" />
        </button>
        {d.mic === 0 && (
          <span className="kx-help">
            {t("Without a fixed choice Kortex checks at start whether the default device delivers a signal and otherwise takes the next real microphone.")}
          </span>
        )}
        <Wave tone="ai" n={56} h={22} channel={0} showDb />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 10 }}>
        <div className="kxh-row">
          <DIco name="speaker" className="kxd-nw-chico" />
          <div className="kxh-col" style={{ gap: 0 }}>
            <span className="kxd-set-name">{t("Channel 1 · Windows WASAPI loopback")}</span>
            <span className="kx-help">{t("Everything that comes out of the speakers or headset")}</span>
          </div>
        </div>
        <button
          type="button"
          className="kxb kx-control kx-select"
          style={{ width: "100%", height: 40 }}
          onClick={d.nextOut}
        >
          <span className="kx-truncate" style={{ color: "var(--text-primary)" }}>
            {deviceLabel(d.out === 0 ? t(DEFAULT_DEVICE) : d.outs[d.out], d.out, d.defaultOutput)}
          </span>
          <DIco name="chev-d" />
        </button>
        <Wave tone="ai" n={56} h={22} channel={1} showDb />
      </div>
      <div className="kxh-row" style={{ gap: 10 }}>
        <span className="kx-help kxh-grow">
          {t("Live transcript through your Kortex routing (Settings → AI routing → Audio transcription). The device choice applies from the next recording.")}
        </span>
        <button
          type="button"
          className="kx-btn kx-btn--secondary"
          style={{ minHeight: 40 }}
          onClick={d.testRec}
        >
          {d.testing ? t("Test recording running") : t("Test recording 5 s")}
        </button>
      </div>
      <div className="kxh-row" style={{ gap: 10 }}>
        <span className="kx-help kxh-grow">
          {t("Self-test: plays a test signal through the whole chain (levels, transcript, coach, pill on minimize) and shows everything in the HUD. No microphone, no AI costs. Report in the log folder.")}
        </span>
        <button
          type="button"
          className="kx-btn kx-btn--secondary"
          style={{ minHeight: 40 }}
          disabled={d.selftesting || d.phase === "live"}
          onClick={() => d.runSelftest(false)}
        >
          {d.selftesting ? t("Self-test running") : t("Self-test")}
        </button>
      </div>
    </div>
  );
}


/**
 * "Konto verbinden": either a personal API token from the web app (kx_…, the simple way: quick
 * capture, voice notes, live meetings; with the search scope also coaching and `?` search) or the
 * sign-in with email and password (everything, including "Fragen").
 */
function Account() {
  const b = bridge();
  const d = useDesktop();
  const [acc, setAcc] = useState<AccountStatus | null>(null);
  const [pending, setPending] = useState<{ web: string | null; current_web: string } | null>(null);
  const [manual, setManual] = useState(false);
  const [withToken, setWithToken] = useState(true);
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [server, setServer] = useState("");
  const [editServer, setEditServer] = useState(false);
  useEffect(() => {
    void b.invoke("account_status").then(setAcc, () => setAcc(null));
    const loadPending = () => void b.invoke("pending_connect").then(setPending, () => setPending(null));
    loadPending();
    // kortex://connect arrived (the core opened this window for it).
    const off = [
      b.listen("connect:pending", ({ error: e }) => {
        if (e) {
          setPending(null);
          setError(t("Connection link refused: {error}", { error: e }));
        } else {
          setError("");
          loadPending();
        }
      }),
      b.listen("account:changed", () => void b.invoke("account_status").then(setAcc, () => undefined)),
    ];
    return () => off.forEach((u) => u());
  }, [b]);
  const done = (a: AccountStatus) => {
    setAcc(a);
    setPassword("");
    setToken("");
    setBusy(false);
    // HUD, tray and launcher run in other windows: they follow without a restart.
    b.emit("account:changed", { connected: a.connected });
  };
  const fail = (e: unknown) => {
    setError(String(e));
    setBusy(false);
  };
  const connect = () => {
    if (withToken ? !token.trim() : !email.trim() || !password) return;
    setBusy(true);
    setError("");
    const call = withToken
      ? b.invoke("connect_token", { token: token.trim() })
      : b.invoke("connect_account", { email: email.trim(), password });
    call.then(done, fail);
  };
  const connectServer = () => {
    if (!server.trim()) return;
    setBusy(true);
    setError("");
    b.invoke("set_server", { url: server.trim() }).then((a) => {
      setEditServer(false);
      setServer("");
      done(a);
      d.say(t("Server connected"));
    }, fail);
  };
  const confirm = () => {
    setBusy(true);
    setError("");
    b.invoke("confirm_connect").then(
      (a) => {
        setPending(null);
        done(a);
        d.say(t("Account connected"));
      },
      (e: unknown) => {
        setPending(null);
        fail(e);
      },
    );
  };
  if (pending)
    return (
      <div className="kx-filerow" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 8, alignItems: "start" }} role="alertdialog" aria-label={t("Confirm connection")}>
        <span style={{ fontSize: "calc(13.5px * var(--kx-fs, 1))", fontWeight: 500 }}>{t("Connect to Kortex account?")}</span>
        <span className="kx-help">
          {t("The web app {web} created a token for this Windows app. It is stored in the Windows Credential Manager.", { web: pending.web ?? pending.current_web })}
          {pending.web && pending.web !== pending.current_web ? ` ${t("The app then uses {next} instead of {current}.", { next: pending.web, current: pending.current_web })}` : ""}
          {acc?.connected ? ` ${t("The existing connection is replaced.")}` : ""}
        </span>
        <div className="kxh-row" style={{ gap: 8 }}>
          <button type="button" className="kx-btn kx-btn--primary" disabled={busy} onClick={confirm}>
            {busy ? t("Connecting …") : t("Connect")}
          </button>
          <button
            type="button"
            className="kx-btn kx-btn--ghost"
            disabled={busy}
            onClick={() => void b.invoke("dismiss_connect").then(() => setPending(null))}
          >
            {t("Cancel")}
          </button>
        </div>
      </div>
    );
  // First start of a build without its own Kortex (or "Server ändern"): the server comes before the account.
  if (!pending && acc && (acc.needs_server || editServer))
    return (
      <form
        style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 8 }}
        aria-label={t("Connect server")}
        onSubmit={(e) => {
          e.preventDefault();
          connectServer();
        }}
      >
        <span style={{ fontSize: "calc(13.5px * var(--kx-fs, 1))", fontWeight: 500 }}>{t("Connect server")}</span>
        <span className="kx-help">
          {t("The address of your Kortex, for example kortex.example.com. The Windows app loads the web app from there and talks only to this server.")}
          {editServer && acc.connected ? ` ${t("The existing account connection is disconnected in the process.")}` : ""}
        </span>
        <input
          className="kx-control"
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          aria-label={t("Server address")}
          placeholder="kortex.example.com"
          value={server}
          onChange={(e) => setServer(e.target.value)}
          style={{ height: 40 }}
        />
        {error && (
          <span className="kx-help" style={{ color: "var(--status-urgent-text)" }}>
            {error}
          </span>
        )}
        <div className="kxh-row" style={{ gap: 8 }}>
          <button type="submit" className="kx-btn kx-btn--primary" disabled={busy}>
            {busy ? t("Connecting …") : t("Connect")}
          </button>
          {editServer && (
            <button
              type="button"
              className="kx-btn kx-btn--ghost"
              disabled={busy}
              onClick={() => {
                setEditServer(false);
                setError("");
              }}
            >
              {t("Cancel")}
            </button>
          )}
        </div>
      </form>
    );
  if (acc?.connected)
    return (
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 6 }}>
        <div className="kxh-row" style={{ minHeight: 40 }}>
          <span className="kxh-grow" style={{ fontSize: "calc(13.5px * var(--kx-fs, 1))" }}>
            {acc.api_token
              ? t("Connected with {name}", { name: acc.email ?? t("Kortex account") })
              : t("Connected as {name}", { name: acc.email ?? t("Kortex account") })}
          </span>
          <button type="button" className="kx-btn kx-btn--secondary" onClick={() => void b.invoke("disconnect_account").then(done)}>
            {t("Disconnect")}
          </button>
        </div>
        {acc.api_token && (
          <span className="kx-help">
            {t("A token from “Connect account” may do everything. An older token created by hand needs “May also search and ask in the vault” for vault search, “Ask”, live coaching and reminders.")}
          </span>
        )}
      </div>
    );
  if (!manual)
    return (
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 8 }}>
        <span className="kx-help">
          {t("Without an account, capture, ask, search and the meeting transcript stay off. One click opens the web app; choose “Connect with Windows app” there, then confirm here.")}
        </span>
        {error && (
          <span className="kx-help" style={{ color: "var(--status-urgent-text)" }}>
            {error}
          </span>
        )}
        <div className="kxh-row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="kx-btn kx-btn--primary" onClick={d.openConnect}>
            <DIco name="link" sm />
            {t("Connect account")}
          </button>
          <button type="button" className="kx-btn kx-btn--ghost" onClick={() => setManual(true)}>
            {t("Enter token or email")}
          </button>
        </div>
        {acc?.web_url && (
          <div className="kxh-row" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className="kx-help kxh-grow">Server: {acc.web_url.replace(/^https?:\/\//, "")}</span>
            <button
              type="button"
              className="kx-btn kx-btn--ghost"
              onClick={() => {
                setEditServer(true);
                setError("");
              }}
            >
              {t("Change server")}
            </button>
          </div>
        )}
      </div>
    );
  return (
    <form
      style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 8 }}
      onSubmit={(e) => {
        e.preventDefault();
        connect();
      }}
    >
      {withToken ? (
        <>
          <span className="kx-help">
            {t("For quick capture, voice notes and live meetings; with “May also search and ask in the vault” also search, “Ask” and live coaching. Create the token in the web app under Settings → Personal API tokens.")}
          </span>
          <input
            className="kx-control"
            type="password"
            autoComplete="off"
            spellCheck={false}
            aria-label={t("API token")}
            placeholder="kx_…"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            style={{ height: 40 }}
          />
        </>
      ) : (
        <>
          <span className="kx-help">{t("Alternative to the token, can do everything. Only a session token is stored.")}</span>
          <input className="kx-control" type="email" autoComplete="username" placeholder={t("Email")} value={email} onChange={(e) => setEmail(e.target.value)} style={{ height: 40 }} />
          <input className="kx-control" type="password" autoComplete="current-password" placeholder={t("Password")} value={password} onChange={(e) => setPassword(e.target.value)} style={{ height: 40 }} />
          {acc && !acc.has_anon_key && <span className="kx-help">{t("Supabase anon key is missing (desktop.json → supabaseAnonKey).")}</span>}
        </>
      )}
      {error && (
        <span className="kx-help" style={{ color: "var(--status-urgent-text)" }}>
          {error}
        </span>
      )}
      <div className="kxh-row" style={{ gap: 8 }}>
        <button type="submit" className="kx-btn kx-btn--primary" disabled={busy}>
          {busy ? t("Connecting …") : withToken ? t("Connect with API token") : t("Connect account")}
        </button>
        <button
          type="button"
          className="kx-btn kx-btn--ghost"
          onClick={() => {
            setWithToken(!withToken);
            setError("");
          }}
        >
          {withToken ? t("Sign in with email") : t("Use API token")}
        </button>
      </div>
    </form>
  );
}

/** App version from the core (tauri.conf.json); the browser preview has none. */
function useAppVersion(): string | null {
  const [v, setV] = useState<string | null>(null);
  useEffect(() => {
    if (!bridge().native) return;
    getVersion().then(setV, () => setV(null));
  }, []);
  return v;
}

function Settings() {
  const d = useDesktop();
  const b = bridge();
  const version = useAppVersion();
  const [reminders, setReminders] = useState<boolean | null>(null);
  useEffect(() => {
    void b.invoke("get_reminders").then(setReminders, () => setReminders(null));
  }, [b]);
  const toggleReminders = () => {
    const next = !reminders;
    setReminders(next);
    b.invoke("set_reminders", { enabled: next }).then(setReminders, (e: unknown) => {
      setReminders(!next);
      d.say(t("Reminders: {error}", { error: String(e) }));
    });
  };
  return (
    <div className="kxd-set">
      <section className="kxd-set-group">
        <h3 className="kxd-set-h">{t("Kortex account")}</h3>
        <Account />
      </section>
      <section className="kxd-set-group">
        <h3 className="kxd-set-h">{t("Appearance")}</h3>
        <p className="kx-help">{t("For the windows of the Windows app. You set the main window in the web app under Settings → Appearance.")}</p>
        <ThemeRow />
        <AccentRow />
        <LookRow />
        <FontScaleRow />
        <LanguageRow />
      </section>
      <section className="kxd-set-group">
        <h3 className="kxd-set-h">{t("Global hotkeys")}</h3>
        {HOTKEYS.map((h) => (
          <div key={h.label} className="kxd-set-line">
            <span className="kxd-set-name kxh-grow">{t(h.label)}</span>
            <Keys keys={h.keys} />
          </div>
        ))}
      </section>
      <section className="kxd-set-group">
        <h3 className="kxd-set-h">{t("Privacy and system")}</h3>
        {switchRow(t(SYS_OPTS.stealth[0]), t(SYS_OPTS.stealth[1]), d.stealth, () => d.setStealth(!d.stealth), 48)}
        {d.autostart !== null &&
          switchRow(t(SYS_OPTS.autostart[0]), t(SYS_OPTS.autostart[1]), d.autostart, () => d.setAutostart(!d.autostart), 48)}
        {reminders !== null && switchRow(t(SYS_OPTS.reminders[0]), t(SYS_OPTS.reminders[1]), reminders, toggleReminders, 48)}
      </section>
      <section className="kxd-set-group">
        <h3 className="kxd-set-h">{t("Vault folder")}</h3>
        <VaultSettings />
      </section>
      <span className="kx-help kx-num" aria-label="Version">
        {t("Kortex for Windows {version}", { version: version ?? t("(preview)") })}
      </span>
    </div>
  );
}

/** One setting: name and help on the left, the control on the right (web Erscheinungsbild). */
function SettingRow({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="kxd-set-row">
      <div className="kxd-set-text">
        <span className="kxd-set-name">{label}</span>
        {help && <span className="kx-help">{help}</span>}
      </div>
      <div className="kxd-set-ctl">{children}</div>
    </div>
  );
}

/** Text tabs without a track: the chosen one sits on a quiet surface (Ruhe; replaces .kx-tabs here). */
function Choice<V extends string | number>({ label, value, options, onPick, num }: { label: string; value: V; options: ReadonlyArray<readonly [V, string]>; onPick: (v: V) => void; num?: boolean }) {
  return (
    <div className="kxd-seg" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={String(v)} type="button" role="radio" aria-checked={value === v} className={(value === v ? "is-on" : "") + (num ? " kx-num" : "")} onClick={() => onPick(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/**
 * Light or dark for these windows, the HUD and Quick Capture (Ruhe D5): follows Windows unless a fixed choice is
 * made. Stored per device (every window follows through `storage`) and in the core (`set_theme`: WebView2 and the
 * native parts, event `settings:theme`).
 */
function ThemeRow() {
  const d = useDesktop();
  const [pref, setPref] = useState<ThemePref>(() => readTheme(null, storage()));
  const pick = (next: ThemePref) => {
    setPref(next);
    try {
      storage()?.setItem(THEME_KEY, next);
    } catch {
      /* storage blocked: the core still keeps it */
    }
    const dark = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)").matches : true;
    applyTheme(document.documentElement, resolveTheme(next, dark));
    bridge()
      .invoke("set_theme", { theme: next })
      .catch((e: unknown) => d.say(t("Mode: {error}", { error: String(e) })));
  };
  const options: Array<[ThemePref, string]> = [
    ["system", t("System")],
    ["light", t("Light")],
    ["dark", t("Dark")],
  ];
  return (
    <SettingRow label={t("Mode")} help={t("System follows Windows.")}>
      <Choice label={t("Mode")} value={pref} options={options} onPick={pick} />
    </SettingRow>
  );
}

/** English names of the accent presets (shown with `t`). */
const ACCENT_NAMES: Record<(typeof ACCENT_CHOICES)[number], string> = {
  indigo: msg("Indigo"),
  violet: msg("Violet"),
  blue: msg("Blue"),
  teal: msg("Teal"),
  rose: msg("Rose"),
  amber: msg("Amber"),
};

/** The one accent of these windows (per device, like the web's accent setting). */
function AccentRow() {
  const [current, setCurrent] = useState(() => resolveAccent(null, storage()));
  const pick = (id: (typeof ACCENT_CHOICES)[number]) => {
    setCurrent(applyAccent(document.documentElement, id));
    try {
      storage()?.setItem(ACCENT_STORAGE_KEY, id);
    } catch {
      /* storage blocked: the accent lasts for this window only */
    }
  };
  return (
    <SettingRow label={t("Accent")}>
      <div className="kxd-swatches" role="radiogroup" aria-label={t("Accent")}>
        {ACCENT_CHOICES.map((id) => {
          const hex = accentHex(id)!;
          const on = (current ?? accentHex("indigo")) === hex;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={t(ACCENT_NAMES[id])}
              title={t(ACCENT_NAMES[id])}
              className={"kxd-swatch" + (on ? " is-on" : "")}
              style={{ background: hex }}
              onClick={() => pick(id)}
            />
          );
        })}
      </div>
    </SettingRow>
  );
}

/** Font size of these small windows, HUD and Quick Capture (per device; the web app in the main window has its own). */
function FontScaleRow() {
  const [scale, setScale] = useState(() => readFontScale(storage()));
  const pick = (f: number) => {
    setScale(f);
    applyFontScale(document.documentElement, f);
    try {
      storage()?.setItem(FONT_SCALE_KEY, String(f));
    } catch {
      /* storage blocked: the size lasts for this window only */
    }
  };
  return (
    <SettingRow label={t("Font size")}>
      <Choice label={t("Font size")} value={scale} options={FONT_SCALES.map((f) => [f, `${Math.round(f * 100)} %`] as const)} onPick={pick} num />
    </SettingRow>
  );
}

/** Look of these windows, HUD and pill (per device, every open window follows through the `storage` event). */
function LookRow() {
  const [look, setLook] = useState<Look>(() => readLook(null, storage()));
  const pick = (l: Look) => {
    setLook(l);
    applyLook(document.documentElement, l);
    try {
      storage()?.setItem(LOOK_KEY, l);
    } catch {
      /* storage blocked: the look lasts for this window only */
    }
  };
  const looks: Array<[Look, string]> = [
    ["ruhe", t("Calm")],
    ["vivid", t("Vivid")],
  ];
  return (
    <SettingRow label={t("Look")} help={t("Calm: quieter surfaces, glass HUD and pill. The main window follows the web app's own switch.")}>
      <Choice label={t("Look")} value={look} options={looks} onPick={pick} />
    </SettingRow>
  );
}

/**
 * Language of the desktop's own windows and of the core's texts (tray tooltip, notifications, errors). The core
 * stores the choice (desktop.json) and tells every window (`settings:locale`), which then reloads (main.tsx).
 * The main window shows the web app, which follows the account's language.
 */
function LanguageRow() {
  const d = useDesktop();
  const current = getLocale();
  const pick = (locale: Locale) => {
    if (locale === current) return;
    bridge()
      .invoke("set_locale", { locale })
      .catch((e: unknown) => d.say(t("Language: {error}", { error: String(e) })));
  };
  return (
    <SettingRow label={t("Language")} help={t("For the windows of the Windows app and its notifications. The main window follows the language of your Kortex account.")}>
      <Choice label={t("Language")} value={current} options={(Object.keys(LOCALE_NAMES) as Locale[]).map((l) => [l, LOCALE_NAMES[l]] as const)} onPick={pick} />
    </SettingRow>
  );
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Small native window (Meeting-Center / Audio-Setup / Einstellungen) with its own title bar. */
export function NativeWindow({
  win,
  placement = NATIVE_PLACEMENT,
}: {
  win: NativeWin;
  placement?: CSSProperties;
}) {
  const d = useDesktop();
  const title = t(WIN_TITLES[win]);
  return (
    <div className="kx-window kxd-nw kx-slide-up" role="dialog" aria-label={title} style={placement}>
      {/* Ruhe round 2: the whole bar moves the window (the bare drag-region attribute only fired on its own pixels;
          the title and the spacer covered them). */}
      <div className="kx-titlebar kxd-nw-title" style={{ flex: "none" }} onMouseDown={dragWindow}>
        <span className="kxd-nw-name">{title}</span>
        <span className="kxh-grow" />
        <button
          type="button"
          className="kx-wincap kx-wincap--close"
          aria-label={t("Close window")}
          onClick={d.closeWin}
        >
          <DIco name="x" />
        </button>
      </div>
      <div
        className="kx-scroll"
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          padding: "12px 24px 24px",
          display: "grid",
          // One column that may shrink below its content (fx3: long lines spilled out of the 620 px window).
          gridTemplateColumns: "minmax(0, 1fr)",
          gap: 20,
          alignContent: "start",
          background: "var(--lum-1)",
        }}
      >
        {win === "meetings" && <MeetingCenter />}
        {win === "audio" && <AudioSetup />}
        {win === "settings" && <Settings />}
      </div>
    </div>
  );
}
