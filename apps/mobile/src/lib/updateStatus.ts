/*
 * Texts for the two update rows in Einstellungen ("Nach Updates suchen", "App neu starten").
 * Pure, so it is tested without the RN runtime; src/ui/useAppUpdate.ts drives the phases.
 */
import { t, tx } from "../i18n";

export type UpdatePhase =
  | { kind: "off" }
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "downloading" }
  | { kind: "current"; at: Date }
  | { kind: "ready"; id: string | null }
  | { kind: "error"; message: string };

const time = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const short = (id: string | null) => (id ? ` ${id.slice(0, 8)}` : "");

/** Value (right side) and help line of "Nach Updates suchen". */
export function checkRow(p: UpdatePhase, runningId: string | null): { value: string; help: string } {
  const running = runningId ? t("Running: update {id}", { id: runningId.slice(0, 8) }) : t("Running: version from the installation");
  switch (p.kind) {
    case "off":
      return { value: t("Not available"), help: t("Only in the installed app, not in development mode") };
    case "checking":
      return { value: t("Checking …"), help: running };
    case "downloading":
      return { value: t("Loading …"), help: t("Downloading the new update") };
    case "current":
      return { value: t("Up to date"), help: t("{running} · checked at {time}", { running, time: time(p.at) }) };
    case "ready":
      return { value: t("Ready"), help: t("Update{id} downloaded, “Restart app” activates it", { id: short(p.id) }) };
    case "error":
      return { value: t("Error"), help: p.message };
    default:
      return { value: tx("verb", "Check"), help: running };
  }
}

/** Value and help line of "App neu starten". */
export function restartRow(p: UpdatePhase): { value: string; help: string } {
  if (p.kind === "off") return { value: t("Not available"), help: t("Only in the installed app") };
  if (p.kind === "ready") return { value: t("Now"), help: t("Restarts with the downloaded update") };
  return { value: t("Restart"), help: t("Finds the latest update, downloads it and restarts the app with it") };
}
