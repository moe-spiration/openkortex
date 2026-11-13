import { useEffect, useState } from "react";
import { bridge } from "@/bridge";
import type { FolderCheck, VaultStatus } from "@/bridge/contract";
import { DIco } from "@/components/icons";
import { intlLocale, t, tn } from "@/i18n";
import { useDesktop } from "@/state/desktop";

/*
 * Einstellungen → Vault-Ordner (vault.rs): first-run setup, folder choice, real sync status from the
 * md-sync heartbeat and the Dropzone. Nothing here writes into the vault; the core never deletes or
 * moves files when the folder changes (the old folder stays as it is).
 */

/** "just now" / "5 min ago" / "today 14:05" / "yesterday 21:05" / "Nov 3, 09:12" (German: "gerade eben", "vor 5 Min.", …). */
export function since(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "–";
  const sec = Math.round((now.getTime() - d.getTime()) / 1000);
  if (sec < 45) return t("just now");
  if (sec < 3600) return t("{n} min ago", { n: Math.max(1, Math.round(sec / 60)) });
  const time = d.toLocaleTimeString(intlLocale(), { hour: "2-digit", minute: "2-digit" });
  const day = (x: Date) => x.toLocaleDateString("en-CA");
  if (day(d) === day(now)) return t("today {time}", { time });
  if (day(d) === day(new Date(now.getTime() - 86_400_000))) return t("yesterday {time}", { time });
  return `${d.toLocaleDateString(intlLocale(), { day: "numeric", month: "short" })}, ${time}`;
}

/** Chip text and look per state. */
export function chipOf(s: VaultStatus): { text: string; cls: string; busy?: boolean } {
  switch (s.state) {
    case "running":
      if (s.last_error) return { text: t("With errors"), cls: "kx-sync--error" };
      return s.realtime === "disconnected" ? { text: t("Offline, waiting"), cls: "kx-sync--busy" } : { text: t("In sync"), cls: "kx-sync--ok" };
    case "starting":
      return { text: t("Starting"), cls: "kx-sync--busy", busy: true };
    case "off":
      return { text: t("Off"), cls: "" };
    case "setup":
      return { text: t("Not set up"), cls: "" };
    case "no_account":
    case "no_sync_token":
      return { text: t("Not connected"), cls: "kx-sync--error" };
    default:
      return { text: t("Error"), cls: "kx-sync--error" };
  }
}

/** One line under the folder: what the sync did last, or why it does not run. */
export function detailOf(s: VaultStatus, now = new Date()): string {
  if (s.state === "running") {
    const parts = [t("Last sync {when}", { when: since(s.last_sync_at ?? s.last_success_at, now) })];
    if (s.items_tracked !== null) parts.push(tn(s.items_tracked, "{n} file", "{n} files"));
    if (s.pending_local) parts.push(tn(s.pending_local, "{n} deletion held back", "{n} deletions held back"));
    if (s.last_error) parts.push(t("Error: {error}", { error: s.last_error }));
    return parts.join(" · ");
  }
  if (s.state === "starting") return t("md-sync is starting …");
  if (s.state === "off") return t("Vault sync is switched off. The files stay as they are.");
  return s.message ?? "";
}

/** Plain-words reading of a crash's log line (known causes only; null = just show the line). */
export function hintOf(s: VaultStatus): string | null {
  const l = s.state === "error" ? (s.log_line ?? "") : "";
  if (!l) return null;
  if (/EISDIR|ERR_MODULE_NOT_FOUND|Cannot find module/i.test(l))
    return t("The sync module of this installation does not start. Please install the latest Kortex version.");
  if (/EBUSY|EPERM|EACCES/i.test(l))
    return t("A file in the vault is locked (OneDrive, antivirus or an open program). Kortex tries again in a moment.");
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|fetch failed/i.test(l))
    return t("Server not reachable. Kortex keeps trying as soon as the connection is back.");
  if (/ENOSPC/i.test(l)) return t("The disk is full.");
  return null;
}

/** What a picked folder means for the user, before anything is applied. */
export function folderNote(c: FolderCheck): string {
  if (c.refused) return c.refused;
  if (!c.exists) return t("New folder: Kortex creates it with the vault structure.");
  if (c.kortex_vault) return t("Existing Kortex vault: taken over as it is and synced.");
  if (c.empty) return t("Empty folder: Kortex creates the vault structure.");
  const md = c.md_at_root
    ? ` ${tn(c.md_at_root, "{n} Markdown file from the top level moves to 00_Inbox and becomes a Kortex note.", "{n} Markdown files from the top level move to 00_Inbox and become Kortex notes.")}`
    : "";
  const what = t("The folder contains {n} entries and is not a Kortex vault yet. Kortex creates subfolders there and syncs all Markdown files.", { n: c.entries });
  return `${what}${md} ${t("Nothing is deleted.")}`;
}

function useVault(): [VaultStatus | null, (s: VaultStatus) => void] {
  const b = bridge();
  const [status, setStatus] = useState<VaultStatus | null>(null);
  useEffect(() => {
    void b.invoke("vault_status").then(setStatus, () => setStatus(null));
    return b.listen("vault:status", setStatus);
  }, [b]);
  // Re-render once a minute so "5 min ago" stays true.
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(timer);
  }, []);
  return [status, setStatus];
}

export function VaultSettings() {
  const d = useDesktop();
  const b = bridge();
  const [s, setS] = useVault();
  const [picked, setPicked] = useState<FolderCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [changing, setChanging] = useState(false);

  if (!s) return null;
  const run = <T,>(p: Promise<T>, then?: (v: T) => void) => {
    setBusy(true);
    setError("");
    p.then(
      (v) => {
        setBusy(false);
        then?.(v);
      },
      (e: unknown) => {
        setBusy(false);
        setError(String(e));
      },
    );
  };
  const apply = (path: string, confirm: boolean) =>
    run(b.invoke("vault_set_folder", { path, confirm }), (st) => {
      setS(st);
      setPicked(null);
      setChanging(false);
      d.say(t("Vault folder applied"));
    });
  const pick = () =>
    run(b.invoke("vault_pick_folder"), (c) => {
      if (!c) return;
      // A new, empty or existing Kortex folder needs no second click.
      if (!c.refused && !c.needs_confirm) apply(c.path, false);
      else setPicked(c);
    });
  const open = (target: "vault" | "dropzone" | "log") => run(b.invoke("vault_open", { target }));

  const pickedCard = picked && (
    <div className="kx-filerow" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 8, alignItems: "start" }} role="alertdialog" aria-label={t("Check folder")}>
      <span className="kx-mono kx-truncate" style={{ fontSize: "calc(12.5px * var(--kx-fs, 1))" }} title={picked.path}>
        {picked.path}
      </span>
      <span className={picked.refused ? "kx-help kx-help--error" : "kx-help"}>{folderNote(picked)}</span>
      <div className="kxh-row" style={{ gap: 8 }}>
        {!picked.refused && (
          <button type="button" className="kx-btn kx-btn--primary" disabled={busy} onClick={() => apply(picked.path, true)}>
            {t("Use anyway")}
          </button>
        )}
        <button type="button" className="kx-btn kx-btn--ghost" disabled={busy} onClick={pick}>
          {t("Choose another folder")}
        </button>
        <button type="button" className="kx-btn kx-btn--ghost" disabled={busy} onClick={() => setPicked(null)}>
          {t("Cancel")}
        </button>
      </div>
    </div>
  );

  const errorLine = error && (
    <span className="kx-help kx-help--error" role="alert">
      {error}
    </span>
  );

  // First run (or "Ändern"): propose %USERPROFILE%\KortexVault.
  if (s.state === "setup" || changing)
    return (
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 8 }}>
        {pickedCard ?? (
          <div className="kx-filerow" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 8, alignItems: "start" }} aria-label={t("Set up vault")}>
            <span style={{ fontSize: "calc(13.5px * var(--kx-fs, 1))", fontWeight: 500 }}>{changing ? t("Choose another vault folder") : t("Set up vault folder")}</span>
            <span className="kx-help">
              {t("Kortex puts your notes as Markdown files into a folder on this PC (Obsidian compatible) and keeps it in sync with all devices. Files in the Dropzone inside it land in your Inbox.")}
              {changing ? ` ${t("The previous folder stays as it is.")}` : ""}
            </span>
            <span className="kx-mono kx-truncate" style={{ fontSize: "calc(12.5px * var(--kx-fs, 1))" }} title={s.default_path}>
              {s.default_path}
            </span>
            <div className="kxh-row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="kx-btn kx-btn--primary" disabled={busy} onClick={() => apply(s.default_path, false)}>
                {busy ? t("Setting up …") : t("Use this folder")}
              </button>
              <button type="button" className="kx-btn kx-btn--secondary" disabled={busy} onClick={pick}>
                <DIco name="folder" sm />
                {t("Choose folder …")}
              </button>
              {changing ? (
                <button type="button" className="kx-btn kx-btn--ghost" disabled={busy} onClick={() => setChanging(false)}>
                  {t("Cancel")}
                </button>
              ) : (
                !s.setup_done && (
                  <button type="button" className="kx-btn kx-btn--ghost" disabled={busy} onClick={() => run(b.invoke("vault_skip_setup"), setS)}>
                    {t("Later")}
                  </button>
                )
              )}
            </div>
          </div>
        )}
        {errorLine}
      </div>
    );

  const chip = chipOf(s);
  const needsAccount = s.state === "no_account" || s.state === "no_sync_token";
  const hint = hintOf(s);
  const dz = s.dropzone;
  const dzLine = [dz.processed && t("{n} taken over", { n: dz.processed }), dz.duplicates && t("{n} already there", { n: dz.duplicates }), dz.pending && t("{n} in progress", { n: dz.pending }), dz.failed && t("{n} failed (.failed)", { n: dz.failed })]
    .filter(Boolean)
    .join(" · ");
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 8 }}>
      <div className="kx-filerow">
        <DIco name="folder" />
        <span className="kx-mono kx-truncate" style={{ fontSize: "calc(12.5px * var(--kx-fs, 1))" }} title={s.vault_path ?? undefined}>
          {s.vault_path}
        </span>
        <span className={`kx-sync ${chip.cls}`} style={{ marginLeft: "auto", flex: "none" }} aria-label={t("Sync status: {status}", { status: chip.text })}>
          {chip.busy ? <span className="kx-spinner" aria-hidden /> : <DIco name="sync" className="kx-ico" />}
          {chip.text}
        </span>
      </div>
      <span className={s.state === "error" || needsAccount ? "kx-help kx-help--error" : "kx-help"}>{detailOf(s)}</span>
      {s.state === "error" && hint && <span className="kx-help">{hint}</span>}
      {s.state === "error" && s.log_line && (
        <span className="kx-mono kx-truncate" style={{ fontSize: "calc(12px * var(--kx-fs, 1))" }} title={s.log_line} aria-label={t("Last log line")}>
          {s.log_line}
        </span>
      )}
      {pickedCard}
      <div className="kxh-row" style={{ gap: 8, flexWrap: "wrap" }}>
        {needsAccount && (
          <button type="button" className="kx-btn kx-btn--primary" onClick={d.openConnect}>
            <DIco name="link" sm />
            {t("Connect account")}
          </button>
        )}
        <button type="button" className="kx-btn kx-btn--secondary" disabled={busy} onClick={() => open("vault")}>
          <DIco name="folder" sm />
          {t("Open folder")}
        </button>
        {s.state === "running" && (
          <button type="button" className="kx-btn kx-btn--ghost" disabled={busy} onClick={() => run(b.invoke("vault_sync_now"), () => d.say(t("Sync running")))}>
            {t("Sync now")}
          </button>
        )}
        {s.state === "error" && (
          <button type="button" className="kx-btn kx-btn--ghost" disabled={busy} onClick={() => run(b.invoke("vault_set_enabled", { enabled: true }), setS)}>
            {t("Try again")}
          </button>
        )}
        {(s.state === "error" || s.last_error) && (
          <button type="button" className="kx-btn kx-btn--ghost" disabled={busy} onClick={() => open("log")}>
            {t("Open log")}
          </button>
        )}
        <button type="button" className="kx-btn kx-btn--ghost" disabled={busy} onClick={() => setChanging(true)}>
          {t("Change")}
        </button>
      </div>
      <label className="kxh-row" style={{ gap: 12, minHeight: 44, cursor: "pointer" }}>
        <div className="kxh-col kxh-grow" style={{ gap: 0 }}>
          <span style={{ fontSize: "calc(13.5px * var(--kx-fs, 1))" }}>{t("Vault sync")}</span>
          <span className="kx-help">{t("Sync folder and Kortex in both directions while the app runs")}</span>
        </div>
        <input
          type="checkbox"
          className="kx-switch"
          checked={s.enabled}
          disabled={busy}
          onChange={() => run(b.invoke("vault_set_enabled", { enabled: !s.enabled }), setS)}
          aria-label={t("Vault sync")}
        />
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 6, marginTop: 6 }}>
        <span className="kx-label">Dropzone</span>
        <div className="kx-filerow">
          <DIco name="inbox" />
          <span className="kx-mono kx-truncate" style={{ fontSize: "calc(12.5px * var(--kx-fs, 1))" }} title={s.dropzone_path ?? undefined}>
            {s.dropzone_path}
          </span>
          <button type="button" className="kx-btn kx-btn--secondary kx-btn--sm" style={{ marginLeft: "auto", flex: "none" }} disabled={busy} onClick={() => open("dropzone")}>
            {t("Open folder")}
          </button>
        </div>
        <span className="kx-help">
          {t("Drop PDFs, EPUBs, images, audio and mails (.eml) here: Kortex takes them into the Inbox, the file then moves to .processed (up to 50 MB, nothing is deleted).")}
          {s.state === "running" ? (dzLine ? ` ${dzLine}.` : ` ${t("Active.")}`) : ` ${t("Active as soon as the vault sync runs.")}`}
        </span>
      </div>
      {errorLine}
    </div>
  );
}
