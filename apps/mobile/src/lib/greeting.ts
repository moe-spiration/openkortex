import { t } from "../i18n";

/** V2-11G: "Hi Max": the first name of the user's display name; without a name just "Hallo". */
export function greetingFor(name: string | null | undefined): string {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return first ? t("Hi {name}", { name: first }) : t("Hello");
}

/** Avatar letter of the display name ("?" without a name). */
export function initialOf(name: string | null | undefined): string {
  return (name ?? "").trim().charAt(0).toUpperCase() || "?";
}
