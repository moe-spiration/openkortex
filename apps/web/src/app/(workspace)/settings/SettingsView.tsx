"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Ico } from "@/components/shell/icons";
import { PackPicker } from "@/components/theme/PackPicker";
import { AppearanceSettings } from "@/components/theme/AppearanceSettings";
import { AppearanceRuhe } from "@/components/theme/AppearanceRuhe";
import { useLook } from "@/components/theme/look";
import { LocationBar } from "@/components/shell/Bars";
import { useShell } from "@/lib/shell/store";
import { useSettings } from "@/lib/settings/store";
import { AiRoutingSection } from "@/components/settings/AiRoutingSection";
import { AccessCard } from "@/components/settings/AccessCard";
import { ApiTokensCard } from "@/components/settings/ApiTokensCard";
import { DesktopConnectCard } from "@/components/settings/DesktopConnectCard";
import { GriplyCard } from "@/components/settings/GriplyCard";
import { InboundMailCard } from "@/components/settings/InboundMailCard";
import { AutoPlaceRow } from "@/components/settings/AutoPlaceRow";
import { BudgetRow } from "@/components/settings/BudgetRow";
import { CONNECTORS, MCP_SERVER } from "@/lib/mock/settings";
import { DEFAULT_TIMEZONE, PLAN_TIERS, TIMEZONES, formatBytes, monthYear, planOf, type AccountPatch } from "@/lib/settings/account";
import { useAccount } from "@/lib/settings/useAccount";
import { useMcpStatus } from "@/lib/settings/useMcpStatus";
import { useSyncStatus } from "@/lib/settings/useSyncStatus";
import { EmptyPic } from "@/components/motion/EmptyPic";
import { dropzonePath } from "@/lib/settings/sync-status";
import { SETTINGS_GROUPS, SETTINGS_SECTIONS, resolveSection } from "@/lib/settings/sections";

/** App version (apps/web/package.json, inlined by next.config.ts). */
const APP_VERSION = process.env.NEXT_PUBLIC_KORTEX_VERSION ?? "0.0.0";
import { PROFILE } from "@/lib/workspace-data";
import { PRODUCT_NAME, feature, getLocale, intlLocale, msg, switchLocale, t, tn, type Locale } from "@/i18n";
import { updateUserSettings as saveUserSettings } from "@/lib/api/settings-actions";
import { KeysRow, RowsCard, TextEditRow, ToggleRow, ValueRow, card } from "./rows";

/*
 * Settings (WebApp.dc.html viewSettings): the prototype's seven sections and rows, wired to the
 * user_settings mock (lib/settings/store.tsx). Connectors and MCP-Server are additions in the
 * same row styles (spec: enabled_connectors, headless MCP server).
 */

/* Chapters, their order and groups, and the old deep links: lib/settings/sections.ts (Ruhe round 2). */

const LANGUAGES = [
  { value: "de", label: "Deutsch" },
  { value: "en", label: "English" },
];

/** Saves an account field and refreshes the server-rendered sidebar (name, avatar); null or the error. */
function useAccountSave() {
  const { user } = useSettings();
  const { showToast } = useShell();
  const router = useRouter();
  const acc = useAccount(user.subscription_tier);
  const save = async (patch: AccountPatch, done: string) => {
    const err = await acc.update(patch);
    if (err) return err;
    showToast(done);
    if (acc.live) router.refresh();
    return null;
  };
  return { ...acc, save };
}

function Profile() {
  const { user } = useSettings();
  const { account, error, save } = useAccountSave();
  const [showMail, setShowMail] = useState(false);
  const avatarEdit = useRef<(() => void) | null>(null);
  const plan = planOf(user.subscription_tier);
  const meta = account
    ? [
        plan.label + (plan.founder ? " · Founder" : ""),
        account.memberSince ? t("since {date}", { date: monthYear(account.memberSince) }) : null,
        tn(account.entries, "{count} entry", "{count} entries", { count: account.entries.toLocaleString(intlLocale()) }),
        account.storageBytes ? t("{size} uploads", { size: formatBytes(account.storageBytes) }) : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : error
      ? t("Account not loaded: {error}", { error })
      : t("Loading account");
  return (
    <>
      <div className="kxh-row" style={{ ...card, gap: 16 }}>
        {account?.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- user-provided avatar URL (any https host)
          <img src={account.avatarUrl} alt="" width={64} height={64} style={{ width: 64, height: 64, borderRadius: "50%", objectFit: "cover", flex: "none" }} />
        ) : (
          <span
            className="kx-h-section"
            style={{
              display: "grid",
              placeItems: "center",
              width: 64,
              height: 64,
              flex: "none",
              borderRadius: "50%",
              background: "var(--accent-ai-solid)",
              color: "#FFFFFF",
            }}
          >
            {account?.initial ?? PROFILE.initial}
          </span>
        )}
        <span className="kxh-col kxh-grow" style={{ gap: 2, minWidth: 0 }}>
          <strong className="kx-h-card">{account?.displayName ?? PROFILE.name}</strong>
          <span className="kx-help">{meta}</span>
        </span>
        <button type="button" className="kx-btn kx-btn--secondary kx-btn--sm" disabled={!account} onClick={() => avatarEdit.current?.()}>
          {t("Change picture")}
        </button>
      </div>
      <RowsCard>
        <TextEditRow
          label={t("Display name")}
          help={t("How Kortex greets you")}
          value={account?.displayName ?? ""}
          placeholder={t("Your name")}
          onSave={(v) => save({ displayName: v }, t("Name saved"))}
        />
        <ValueRow
          label={t("Email")}
          help={account?.provider && account.provider !== "email" ? t("Sign-in via {provider}", { provider: account.provider }) : t("Sign-in and security emails")}
          value={<span className="kx-mono">{showMail ? (account?.email ?? "–") : (account?.emailMasked ?? "–")}</span>}
          onClick={() => setShowMail((v) => !v)}
        />
        <TextEditRow
          label={t("Profile picture")}
          help={t("Image URL (https), empty = initial")}
          value={account?.avatarUrl ?? ""}
          display={account?.avatarUrl ? t("Own picture") : t("Initial")}
          placeholder="https://…"
          openRef={avatarEdit}
          onSave={(v) => save({ avatarUrl: v }, v ? t("Profile picture saved") : t("Profile picture removed"))}
        />
      </RowsCard>
      <Plan tier={user.subscription_tier} />
    </>
  );
}

/** "Allgemein" (Ruhe round 2): language, time zone, the setup, and the notifications (former chapter "notif"). */
function General() {
  const { setOnboarding, showToast } = useShell();
  const { account, save } = useAccountSave();
  const browserTz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : DEFAULT_TIMEZONE;
  const tz = account?.timezone ?? DEFAULT_TIMEZONE;
  const tzOptions = [...new Set([...TIMEZONES, browserTz, tz])].map((z) => ({ value: z, label: z.replace(/_/g, " ") }));
  return (
    <>
      <RowsCard>
        <ValueRow
          label={t("Language")}
          help={t("Interface and AI answers")}
          value={LANGUAGES.find((l) => l.value === getLocale())?.label ?? "English"}
          options={LANGUAGES}
          selected={getLocale()}
          onSelect={(v) => {
            if (v === getLocale()) return;
            // Saved first, then the whole interface is rebuilt in the new language.
            void Promise.resolve(saveUserSettings({ locale: v as Locale }))
              .catch(() => undefined)
              .finally(() => switchLocale(v as Locale));
          }}
        />
        <ValueRow
          label={t("Time zone")}
          help={t("For briefings and reviews")}
          value={tz.replace(/_/g, " ")}
          options={tzOptions}
          selected={tz}
          onSelect={(v) => void save({ timezone: v }, t("Time zone: {zone}", { zone: v.replace(/_/g, " ") })).then((err) => err && showToast(t("Not saved: {error}", { error: err })))}
        />
        <ValueRow label={t("Setup")} help={t("Choose vault, life areas and color again")} value={t("Start")} onClick={() => setOnboarding(1)} />
      </RowsCard>
      <h2 className="kx-h-section" style={{ margin: "4px 0 0" }}>
        {t("Notifications")}
      </h2>
      <Notifications />
    </>
  );
}

/** Plan card: reflects user_settings.subscription_tier (no billing in the MVP). */
function Plan({ tier }: { tier: string }) {
  const plan = planOf(tier);
  return (
    <div style={{ ...card, display: "grid", gap: 14 }}>
      <div className="kxh-col" style={{ gap: 2 }}>
        <strong className="kx-h-card">{t("Plan")}</strong>
        <span className="kx-help">{t("Billing follows later. Until then the Kortex team sets the plan.")}</span>
      </div>
      <div style={{ display: "grid" }}>
        {PLAN_TIERS.map((tier, i) => {
          const on = tier.id === plan.id;
          return (
            <div
              key={tier.id}
              aria-current={on ? "true" : undefined}
              className="kxh-row"
              style={{ gap: 14, minHeight: 56, boxShadow: i ? "inset 0 1px 0 0 var(--border-subtle)" : undefined }}
            >
              <span className="kxh-col kxh-grow" style={{ gap: 1, minWidth: 0 }}>
                <span style={{ fontSize: "calc(13px * var(--kx-fs, 1))", fontWeight: on ? 500 : 400, color: on ? "var(--text-primary)" : "var(--text-secondary)" }}>{tier.label}</span>
                <span className="kx-help">{t(tier.help)}</span>
              </span>
              {on && <span className="kx-badge kx-badge--soft">{plan.founder ? "Founder" : t("Current")}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Look() {
  const { prefs, toggleRail } = useShell();
  const { local, setLocal } = useSettings();
  const ruhe = useLook() === "ruhe";
  if (ruhe)
    return (
      <>
        <AppearanceRuhe />
        <div className="rzs-grp">
          <div className="rzs-k">
            {t("Theme pack")}
            <small>{t("Covers and backgrounds for Home, Life, Spaces, weekly review and Insights, and the frame background “Theme pack”. Your own covers and article images stay.")}</small>
          </div>
          <div className="rzs-v">
            <PackPicker />
          </div>
        </div>
        <div className="rzs-grp">
          <div className="rzs-k">
            {t("Compact sidebar")}
            <small>{t("Icons only, more room for content. Hide completely: Ctrl+\\")}</small>
          </div>
          <div className="rzs-v">
            <label className="rzs-switch">
              <input type="checkbox" role="switch" className="kx-switch" aria-label={t("Compact sidebar")} checked={prefs.rail} onChange={() => toggleRail()} />
            </label>
          </div>
        </div>
      </>
    );
  return (
    <>
      {/* Tactile Craft v2: theme, accent, frame backdrop, default density, reduced transparency. */}
      <AppearanceSettings />
      <div style={{ ...card, display: "grid", gap: 12 }}>
        <div className="kxh-col" style={{ gap: 2 }}>
          <strong className="kx-h-card">{t("Theme pack")}</strong>
          <span className="kx-help">{t("Covers and backgrounds for Home, Life, Spaces, weekly review and Insights, and the frame background “Theme pack”. Your own covers and article images stay.")}</span>
        </div>
        <PackPicker />
      </div>
      <RowsCard>
        <ToggleRow label={t("Compact sidebar")} help={t("Icons only, more room for content. Hide completely: Ctrl+\\")} on={prefs.rail} onChange={() => toggleRail()} />
        <ToggleRow label={t("Hero images in lists")} help={t("Preview images in grid and timeline")} on={local.heroes} onChange={(v) => setLocal("heroes", v)} />
        <ToggleRow label={t("Reduce motion")} help={t("Animations at a minimum")} on={local.motion} onChange={(v) => setLocal("motion", v)} />
      </RowsCard>
    </>
  );
}

/** ADR-06 routing (components/settings) plus the AI behaviour switches. */
function Ai() {
  const { user, updateUserSettings } = useSettings();
  return (
    <>
      <AiRoutingSection />
      <h2 className="kx-h-section" style={{ margin: "4px 0 0" }}>
        {t("Behavior")}
      </h2>
      <RowsCard>
        <ToggleRow
          label={t("Tag automatically")}
          help={t("Hierarchical tags when processing new entries")}
          on={user.auto_tag_enabled}
          onChange={(v) => updateUserSettings({ auto_tag_enabled: v })}
        />
        <ToggleRow
          label={t("Auto-clustering")}
          help={t("Bundle similar entries into clusters automatically")}
          on={user.auto_cluster_enabled}
          onChange={(v) => updateUserSettings({ auto_cluster_enabled: v })}
        />
        <AutoPlaceRow />
        <BudgetRow />
      </RowsCard>
    </>
  );
}

function Connectors() {
  const { user, toggleConnector } = useSettings();
  const on = user.enabled_connectors ?? [];
  return (
    <>
      <div className="kxh-col" style={{ ...card, gap: 2 }}>
        <strong className="kx-h-card">{t("Sources for the Inbox")}</strong>
        <span className="kx-help">
          {t("{on} of {total} active. Sources that are switched off are rejected on capture (web app, extension, desktop, mobile). Typed thoughts and voice notes always work.", { on: on.length, total: CONNECTORS.length })}
        </span>
      </div>
      <RowsCard>
        {CONNECTORS.map((c) => (
          <ToggleRow key={c.id} icon={c.icon} label={t(c.label)} help={t(c.help)} on={on.includes(c.id)} onChange={() => toggleConnector(c.id)} />
        ))}
      </RowsCard>
      {/* Ruhe round 2: the apps, devices and tokens below are their own block, apart from the source switches. */}
      <h2 className="kx-h-section" style={{ margin: "4px 0 0" }}>
        {t("Apps, devices and tokens")}
      </h2>
      {feature("griply") && <GriplyCard />}
      <InboundMailCard />
      <DesktopConnectCard />
      <ApiTokensCard />
    </>
  );
}

function Capture() {
  const { setKeys } = useShell();
  const { local, setLocal } = useSettings();
  return (
    <RowsCard>
      <ValueRow label={t("All keyboard shortcuts")} help={t("Overview as an overlay, also with ?")} value={t("Show")} onClick={() => setKeys(true)} />
      <KeysRow label={t("Command palette")} keys={["Ctrl", "K"]} />
      <KeysRow label={t("Start or stop voice note")} keys={["Ctrl", "Shift", "Space"]} />
      <KeysRow label={t("Toggle sidebar")} keys={["Ctrl", "\\"]} />
      <KeysRow label={t("Quick capture (desktop)")} keys={["Alt", "Space"]} />
      <KeysRow label={t("Live HUD (desktop)")} keys={["Ctrl", "Shift", "H"]} />
      <ValueRow label={t("Tap the orb")} help={t("Capture: dictation · Ask: voice question · Holding is push-to-talk")} value={t("By mode")} onClick={() => {}} />
      <ToggleRow
        label={t("Send voice questions right away")}
        help={t("Off: tapping the orb puts the question into the field. On: tapping the orb sends it.")}
        on={local.voiceSend}
        onChange={(v) => setLocal("voiceSend", v)}
      />
    </RowsCard>
  );
}

function Vault() {
  const { showToast } = useShell();
  const { live, view, loading, error, phase, sync } = useSyncStatus(showToast);
  const busy = phase !== "idle";
  const status = !live
    ? null
    : loading
      ? { cls: "kx-status--progress", text: t("Loading") }
      : !view.known
        ? { cls: "kx-status--blocked", text: t("No daemon") }
        : view.online
          ? { cls: "kx-status--done", text: t("Daemon online") }
          : { cls: "kx-status--blocked", text: t("Daemon offline") };
  // Ruhe: the "Vault synchron" pictogram while the daemon is up (or a sync runs); an error or offline shows none.
  const inSync = !live || busy || (view.known && view.online && !view.error && !error);
  return (
    <>
    {inSync && (
      <EmptyPic kind="sync" title={busy ? t("Syncing") : t("Vault in sync")}>
        {t("Markdown files and the database exchange every change in both directions.")}
      </EmptyPic>
    )}
    <RowsCard>
      <ValueRow
        label={t("Vault folder")}
        help={
          live && !view.known
            ? t("Set up in the Windows app: connect the account (Connectors → Windows app), then Settings → Vault folder")
            : t("Markdown, Obsidian-compatible") + (view.deviceName ? ` · ${view.deviceName}` : "")
        }
        value={<span className="kx-mono kx-truncate" style={{ maxWidth: 320, display: "inline-block", verticalAlign: "bottom" }} title={view.vaultPath ?? undefined}>{view.vaultPath ?? "–"}</span>}
        trailing={status ? <span className={`kx-status ${status.cls}`}>{status.text}</span> : undefined}
      />
      {live && view.vaultPath && (
        <ValueRow
          label="Dropzone"
          help={t("Drop PDFs, images, audio and mails here: Kortex takes them into the Inbox")}
          value={<span className="kx-mono kx-truncate" style={{ maxWidth: 320, display: "inline-block", verticalAlign: "bottom" }}>{dropzonePath(view.vaultPath)}</span>}
        />
      )}
      <ValueRow label={t("Conflicts")} help={t("On parallel changes")} value={t("Create .conflict.md")} onClick={() => {}} />
      <ValueRow
        label={t("Last sync")}
        help={
          error
            ? t("Status not loaded: {error}", { error })
            : view.error
              ? t("Last error: {error}", { error: view.error })
              : live && view.known
                ? [view.online ? t("Heartbeat {when}", { when: view.lastHeartbeat }) : t("Daemon offline since {when}", { when: view.lastHeartbeat }), view.pendingText, view.version ? `md-sync ${view.version}` : null]
                    .filter(Boolean)
                    .join(" · ")
                : t("All devices")
        }
        value={
          busy ? (
            <span className="kx-sync kx-sync--busy">
              <span className="kx-spinner" aria-hidden />
              {t("Syncing")}
            </span>
          ) : (
            view.lastSync
          )
        }
        onClick={() => void sync()}
      />
    </RowsCard>
    </>
  );
}

function Mcp() {
  const { mcp, live, rotateMcpToken, revokeMcpToken, hideMcpToken } = useSettings();
  const { showToast } = useShell();
  const server = useMcpStatus();
  const st = server.status;
  const httpUrl = st?.httpUrl ?? MCP_SERVER.httpUrl;
  const stdioCommand = st?.stdioCommand ?? MCP_SERVER.stdioCommand;
  const health = st?.health.state ?? "unknown";
  const chip =
    !live || !st
      ? { cls: "kx-status--done", text: live ? t("Checking") : t("Ready") }
      : health === "up"
        ? { cls: "kx-status--done", text: t("Running") + (st.health.ms !== null ? ` · ${st.health.ms} ms` : "") }
        : health === "down"
          ? { cls: "kx-status--blocked", text: t("Not started") }
          : { cls: "kx-status--progress", text: t("Not checked") };
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  // Full token: mock always; live only right after creating it (shown once, then just the hint).
  const mcpToken = mcp.token;
  const hasToken = mcp.hint !== null;
  const masked = mcpToken && reveal ? mcpToken : hasToken ? "•".repeat(live ? 4 : 24) + mcp.hint : t("No token");
  // Live: leaving the MCP section forgets the once-shown token.
  useEffect(() => () => hideMcpToken(), [hideMcpToken]);
  const rotate = async () => {
    if (busy) return;
    setBusy(true);
    const had = hasToken;
    const token = await rotateMcpToken();
    setBusy(false);
    if (!token) return;
    setReveal(true);
    showToast(had ? t("New token created, the old one is invalid") : t("Token created"));
  };
  const revoke = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await revokeMcpToken();
    setBusy(false);
    if (!ok) return;
    setReveal(false);
    showToast(t("Token revoked"));
  };
  const copy = async (text: string, done: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(done);
    } catch {
      showToast(t("Copying is not possible"));
    }
  };
  const config = JSON.stringify({ mcpServers: { kortex: { command: "node", args: stdioCommand.split(" ").slice(1) } } }, null, 2);
  return (
    <>
      <div style={{ ...card, display: "grid", gap: 14 }}>
        <div className="kxh-row" style={{ gap: 12 }}>
          <span className="kx-icontile kx-icontile--lg" aria-hidden>
            <Ico name="monitor" />
          </span>
          <span className="kxh-col kxh-grow" style={{ gap: 2 }}>
            <strong className="kx-h-card">{t("Headless MCP server")}</strong>
            <span className="kx-help">{t("Claude Code, Claude Desktop and Cursor read and write your vault through six tools.")}</span>
          </span>
          <span className={`kx-status ${chip.cls}`} title={st?.health.error ?? undefined}>
            {chip.text}
          </span>
          {live && (
            <button type="button" className="kx-btn kx-btn--secondary kx-btn--sm" disabled={server.testing} onClick={() => void server.test()}>
              {server.testing ? t("Checking …") : t("Test connection")}
            </button>
          )}
        </div>
        <hr className="kx-hairline" />
        <div style={{ display: "grid", gap: 8 }}>
          <span className="kx-label">{t("Bearer token for HTTP")}</span>
          <div className="kxh-row" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className="kx-control kx-control--muted kxh-grow" style={{ minWidth: 220 }}>
              <span className="kx-mono kx-truncate" style={{ fontSize: "calc(12px * var(--kx-fs, 1))", color: hasToken ? "var(--text-primary)" : "var(--text-muted)" }}>
                {masked}
              </span>
            </span>
            {mcpToken && (
              <>
                <button type="button" className="kx-btn kx-btn--ghost kx-btn--sm" onClick={() => setReveal((v) => !v)}>
                  {reveal ? t("Hide") : t("Show")}
                </button>
                <button type="button" className="kx-btn kx-btn--secondary kx-btn--sm" onClick={() => copy(mcpToken, t("Token copied"))}>
                  {t("Copy")}
                </button>
              </>
            )}
            <button type="button" className="kx-btn kx-btn--primary kx-btn--sm" disabled={busy} onClick={() => void rotate()}>
              {hasToken ? t("Create again") : t("Create token")}
            </button>
            {hasToken && (
              <button type="button" className="kx-btn kx-btn--danger kx-btn--sm" disabled={busy} onClick={() => void revoke()}>
                {t("Revoke")}
              </button>
            )}
          </div>
          <span className="kx-help">
            {!live
              ? t("Mock: the token is only created in this browser. The server reads it from MCP_BEARER_TOKEN.")
              : mcpToken
                ? t("Copy it now: the token is shown only this once. Kortex stores only a hash.")
                : hasToken
                  ? t("Created on {date}. Lost it? Create it again, the old one becomes invalid.", { date: mcp.createdAt ? new Date(mcp.createdAt).toLocaleDateString(intlLocale()) : "–" })
                  : t("The token is created on the server and shown only once.")}
          </span>
        </div>
      </div>
      <RowsCard>
        <ValueRow label="stdio" help={t("The agent starts the server itself, without network and token")} value={<span className="kx-mono">cli.mjs</span>} onClick={() => copy(stdioCommand, t("Command copied"))} />
        <ValueRow
          label="Streamable HTTP"
          help={st ? t("{host}, port {port} (MCP_HTTP_PORT), with bearer token", { host: st.host === "127.0.0.1" ? t("127.0.0.1 only") : st.host, port: st.port }) : t("127.0.0.1 only, with bearer token")}
          value={<span className="kx-mono">{httpUrl}</span>}
          onClick={() => copy(httpUrl, t("URL copied"))}
        />
        {live && st && (
          <ValueRow
            label={t("Start HTTP server")}
            help={st.built ? t("Command for a terminal (loads .env.local)") : t("Build first: pnpm --filter @kortex/mcp-server build")}
            value={<span className="kx-mono">--http</span>}
            onClick={() => copy(st.httpCommand, t("Command copied"))}
          />
        )}
        {live && st && (
          <ValueRow
            label={t("Server token (MCP_BEARER_TOKEN)")}
            help={t("The HTTP server reads its token from the .env, not from this account")}
            value={st.serverTokenSet ? t("set") : t("missing")}
            trailing={<span className={`kx-status ${st.serverTokenSet ? "kx-status--done" : "kx-status--blocked"}`}>{st.serverTokenSet ? "OK" : t("missing")}</span>}
          />
        )}
        <ValueRow label="Claude Desktop" help={t("mcpServers block for claude_desktop_config.json")} value={t("Copy configuration")} onClick={() => copy(config, t("Configuration copied"))} />
        <ValueRow
          label="Tools"
          help={<span className="kx-mono">{MCP_SERVER.tools.join(" · ")}</span>}
          trailing={<span className="kx-badge">{MCP_SERVER.tools.length}</span>}
        />
        {!live &&
          MCP_SERVER.clients.map((c) => <ValueRow key={c.name} label={c.name} help={t("Connected via {transport}", { transport: c.transport })} value={c.lastSeen} />)}
        {live && (
          <ValueRow
            label={t("Last check")}
            help={st?.health.error ?? (health === "up" ? t("The server answers on /healthz") : t("Test connection checks /healthz on this computer"))}
            value={st?.health.checkedAt ? new Date(st.health.checkedAt).toLocaleTimeString(intlLocale(), { hour: "2-digit", minute: "2-digit" }) : "–"}
          />
        )}
      </RowsCard>
    </>
  );
}

/** Switching "Erinnerungen" on asks the browser for permission; without it the toast still shows. */
function useRemindToggle() {
  const { setLocal } = useSettings();
  const { showToast } = useShell();
  return (on: boolean) => {
    setLocal("remind", on);
    if (!on || typeof Notification === "undefined" || Notification.permission !== "default") {
      if (on && typeof Notification !== "undefined" && Notification.permission === "denied")
        showToast(t("The browser blocks notifications: hints only show in the app"));
      return;
    }
    void Notification.requestPermission().then((p) => {
      if (p !== "granted") showToast(t("Without permission hints only show in the app"));
    });
  };
}

function Notifications() {
  const { local, user, updateUserSettings } = useSettings();
  const setRemind = useRemindToggle();
  // Weekday names in the current language, index 0 = Sunday like user_settings.weekly_digest_day.
  const weekday = new Intl.DateTimeFormat(intlLocale(), { weekday: "long", timeZone: "UTC" });
  const weekdays = [0, 1, 2, 3, 4, 5, 6].map((i) => weekday.format(new Date(Date.UTC(2023, 0, 1 + i))));
  const day = weekdays[user.weekly_digest_day] ?? weekdays[0]!;
  return (
    <RowsCard>
      <ToggleRow label={t("Reminders and page changes")} help={t("Hint in the browser while Kortex is open (checked every 5 minutes)")} on={local.remind} onChange={setRemind} />
      <ValueRow
        label={t("Day for review and weekly digest")}
        help={t("When Kortex sums up the week")}
        value={day}
        options={weekdays.map((d, i) => ({ value: String(i), label: d }))}
        selected={String(user.weekly_digest_day)}
        onSelect={(v) => updateUserSettings({ weekly_digest_day: Number(v) })}
      />
    </RowsCard>
  );
}

// Audit 0.6.1 W-11/W-12: no switches for features Kortex does not have (end-to-end encryption, telemetry)
// and no export button that only showed a toast; the vault sync is the full Markdown copy of the data.
function Privacy() {
  return <AccessCard />;
}

const SECTION_VIEWS: Record<string, () => React.JSX.Element> = {
  profile: Profile,
  general: General,
  look: Look,
  ai: Ai,
  connectors: Connectors,
  cap: Capture,
  vault: Vault,
  mcp: Mcp,
  priv: Privacy,
};

/** One line under the section title (Ruhe frame). */
const SECTION_HELP: Record<string, string> = {
  look: msg("Calm look: the colour ladder comes from base tone, accent and contrast."),
};

export function SettingsView({ section }: { section: string }) {
  const sec = resolveSection(section);
  const View = SECTION_VIEWS[sec.id]!;
  const router = useRouter();
  const ruhe = useLook() === "ruhe";
  if (ruhe) {
    // Ruhe (mockup "einstellungen"): location bar "Einstellungen › <Bereich>" with a close button, a 220 px section
    // list on the left with a hairline, the section on the right as flat rows. Sign-out sits at the end of the list
    // (the sidebar footer keeps only the gear).
    const help = SECTION_HELP[sec.id];
    return (
      <>
        <LocationBar
          icon="gear"
          crumbs={[{ label: t("Settings"), href: "/settings?section=profile" }, { label: t(sec.label) }]}
          onClose={() => (window.history.length > 1 ? router.back() : router.push("/home"))}
        />
        <div className="rzs-frame">
          <nav aria-label={t("Settings sections")} className="rzs-nav">
            {SETTINGS_GROUPS.map((g) => (
              <div key={g.label} role="group" aria-label={t(g.label)} className="rzs-nav-group">
                <span className="rzs-nav-glabel" aria-hidden>
                  {t(g.label)}
                </span>
                {g.sections.map((n) => {
                  const on = n.id === sec.id;
                  return (
                    <Link key={n.id} href={`/settings?section=${n.id}`} className={"rzs-nav-row" + (on ? " is-on" : "")} aria-current={on ? "page" : undefined}>
                      <Ico name={n.icon} />
                      <span>{t(n.label)}</span>
                    </Link>
                  );
                })}
              </div>
            ))}
            <span className="rzs-nav-sp" />
            {/* Plain anchor, not <Link>: a prefetch must never hit the sign-out route. */}
            <a href="/auth/logout" className="rzs-nav-row">
              <Ico name="logout" />
              <span>{t("Sign out")}</span>
            </a>
            <span className="rzs-ver">
              {PRODUCT_NAME} · Version {APP_VERSION}
            </span>
          </nav>
          <div className="rzs-sc kx-settings-body">
            <h1 className="rzs-h1">{t(sec.label)}</h1>
            {help && <p className="rzs-help">{t(help)}</p>}
            <View />
          </div>
        </div>
      </>
    );
  }
  return (
    // Prototype: max-width 1000, padding 30px 32px 170px, gap 22 (a little more top air than other views).
    <>
      <div className="kx-pagetitle kx-settings-head">
        <span className="kx-pagetitle-ico" aria-hidden>
          <Ico name="gear" />
        </span>
        <div className="kx-pagetitle-text">
          <span className="kx-eyebrow">
            {PRODUCT_NAME} · Version {APP_VERSION}
          </span>
          <h1 className="kx-h-page" style={{ margin: "4px 0 0" }}>
            {t("Settings")}
          </h1>
          <span className="kx-pagetitle-meta">Version {APP_VERSION}</span>
        </div>
      </div>
      <div className="kx-settings-page">
        <div className="kx-settings-grid">
          <nav aria-label={t("Settings sections")} className="kx-settings-nav">
            {SETTINGS_SECTIONS.map((n) => {
              const on = n.id === sec.id;
              return (
                <Link
                  key={n.id}
                  href={`/settings?section=${n.id}`}
                  className={"kx-row kxb" + (on ? " is-active" : "")}
                  aria-current={on ? "page" : undefined}
                >
                  <Ico name={n.icon} />
                  <span>{t(n.label)}</span>
                </Link>
              );
            })}
          </nav>
          <div className="kx-settings-body">
            <View />
          </div>
        </div>
      </div>
    </>
  );
}
