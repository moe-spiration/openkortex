import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState, type CSSProperties } from "react";
import { bridge, type AccountStatus } from "@/bridge";
import { DIco } from "@/components/icons";
import { Wave } from "@/components/Wave";
import { HOTKEYS, SYS_OPTS, WIN_TITLES, type NativeWin } from "@/data";
import { LOCALE_NAMES, getLocale, t, type Locale } from "@/i18n";
import { VaultSettings } from "./VaultSettings";
import { FONT_SCALES, FONT_SCALE_KEY, applyFontScale, readFontScale } from "@/theme";
import type { SearchHit } from "@/launcher";
import { DEFAULT_DEVICE, deviceLabel, useDesktop } from "@/state/desktop";
import { meetingStatus } from "@/state/meeting";
import { Clock } from "@/state/clock";

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
  <label key={label} className="kxh-row" style={{ gap: 12, minHeight, cursor: "pointer" }}>
    <div className="kxh-col kxh-grow" style={{ gap: 0 }}>
      <span style={{ fontSize: "calc(13.5px * var(--kx-fs, 1))" }}>{label}</span>
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
          className={"kx-btn " + (live ? "kx-btn--secondary" : "kx-btn--primary")}
          style={{ minHeight: 40, flex: "none" }}
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
        <span className="kx-label">{t("Recent meetings")}</span>
        {!d.connected && <span className="kx-help">{t("Connect a Kortex account in the settings, then your minutes from 20_Meetings/ appear here.")}</span>}
        {d.connected && recent === null && <span className="kx-help">{t("Loading …")}</span>}
        {error && <span className="kx-help" style={{ overflowWrap: "anywhere" }}>{error}</span>}
        {d.connected && recent?.length === 0 && !error && <span className="kx-help">{t("No meetings in the vault yet.")}</span>}
        {recent?.map((m) => (
          <button
            key={m.item_id}
            type="button"
            className="kxb kxh-row"
            style={{ gap: 14, padding: "12px 0", textAlign: "left", boxShadow: "inset 0 -1px 0 0 var(--border-subtle)" }}
            onClick={() => d.openItem(m.item_id)}
          >
            <DIco name="cal" />
            <span className="kxh-col kxh-grow" style={{ gap: 3, minWidth: 0 }}>
              <strong className="kx-truncate" style={{ fontSize: "calc(14px * var(--kx-fs, 1))", fontWeight: 500 }}>
                {m.title}
              </strong>
              {m.snippet && <span className="kx-help kx-truncate">{m.snippet}</span>}
            </span>
            <DIco name="up-right" />
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
          <span className="kx-icontile kx-icontile--checkin">
            <DIco name="mic" />
          </span>
          <div className="kxh-col" style={{ gap: 0 }}>
            <span className="kx-label">{t("Channel 0 · Microphone")}</span>
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
        <Wave tone="mic" n={56} h={22} channel={0} showDb />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 10 }}>
        <div className="kxh-row">
          <span className="kx-icontile">
            <DIco name="speaker" style={{ color: "var(--tag-auto-dot)" }} />
          </span>
          <div className="kxh-col" style={{ gap: 0 }}>
            <span className="kx-label">{t("Channel 1 · Windows WASAPI loopback")}</span>
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
        <Wave tone="out" n={56} h={22} channel={1} showDb />
      </div>
      <hr className="kx-hairline" />
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
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 22 }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 6 }}>
        <span className="kx-label">{t("Kortex account")}</span>
        <Account />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 6 }}>
        <span className="kx-label">{t("Global hotkeys")}</span>
        {HOTKEYS.map((h) => (
          <div
            key={h.label}
            className="kxh-row"
            style={{ minHeight: 40, boxShadow: "inset 0 -1px 0 0 var(--border-subtle)" }}
          >
            <span className="kxh-grow" style={{ fontSize: "calc(13.5px * var(--kx-fs, 1))" }}>
              {t(h.label)}
            </span>
            <span className="kx-keys">
              {h.keys.map((k) => (
                <span key={k} className="kx-kbd">
                  {k}
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 2 }}>
        <span className="kx-label" style={{ marginBottom: 4 }}>
          {t("Privacy and system")}
        </span>
        {switchRow(t(SYS_OPTS.stealth[0]), t(SYS_OPTS.stealth[1]), d.stealth, () => d.setStealth(!d.stealth), 52)}
        {d.autostart !== null &&
          switchRow(t(SYS_OPTS.autostart[0]), t(SYS_OPTS.autostart[1]), d.autostart, () => d.setAutostart(!d.autostart), 52)}
        {reminders !== null && switchRow(t(SYS_OPTS.reminders[0]), t(SYS_OPTS.reminders[1]), reminders, toggleReminders, 52)}
      </div>
      <FontScaleRow />
      <LanguageRow />
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 6 }}>
        <span className="kx-label">{t("Vault folder")}</span>
        <VaultSettings />
      </div>
      <span className="kx-help kx-mono" aria-label="Version">
        {t("Kortex for Windows {version}", { version: version ?? t("(preview)") })}
      </span>
    </div>
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
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 6 }}>
      <span className="kx-label">{t("Font size")}</span>
      <span className="kx-help">{t("For the windows of the Windows app. You set the main window in the web app under Settings → Appearance.")}</span>
      <div className="kx-tabs" role="radiogroup" aria-label={t("Font size")} style={{ justifySelf: "start", flexWrap: "wrap" }}>
        {FONT_SCALES.map((f) => (
          <button key={f} type="button" role="radio" aria-checked={scale === f} className={"kx-tab kx-num" + (scale === f ? " is-on" : "")} onClick={() => pick(f)}>
            {Math.round(f * 100)} %
          </button>
        ))}
      </div>
    </div>
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
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 6 }}>
      <span className="kx-label">{t("Language")}</span>
      <span className="kx-help">{t("For the windows of the Windows app and its notifications. The main window follows the language of your Kortex account.")}</span>
      <div className="kx-tabs" role="radiogroup" aria-label={t("Language")} style={{ justifySelf: "start", flexWrap: "wrap" }}>
        {(Object.keys(LOCALE_NAMES) as Locale[]).map((l) => (
          <button key={l} type="button" role="radio" aria-checked={current === l} className={"kx-tab" + (current === l ? " is-on" : "")} onClick={() => pick(l)}>
            {LOCALE_NAMES[l]}
          </button>
        ))}
      </div>
    </div>
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
    <div className="kx-window kx-slide-up" role="dialog" aria-label={title} style={placement}>
      <div
        className="kx-titlebar"
        style={{ flex: "none", boxShadow: "inset 0 -1px 0 0 var(--border-subtle)" }}
        data-tauri-drag-region
      >
        <span className="kx-appmark" style={{ width: 14, height: 14 }} />
        <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>{title}</span>
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
          padding: "20px 24px 24px",
          display: "grid",
          // One column that may shrink below its content (fx3: long lines spilled out of the 620 px window).
          gridTemplateColumns: "minmax(0, 1fr)",
          gap: 20,
          alignContent: "start",
          background: "var(--bg-main-window)",
        }}
      >
        {win === "meetings" && <MeetingCenter />}
        {win === "audio" && <AudioSetup />}
        {win === "settings" && <Settings />}
      </div>
    </div>
  );
}
