/** `YYYY-MM-DD` and `HH:mm` of a timestamp in a time zone (client-safe, no @kortex/db import). */
export function localDateTime(iso: string, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
  const [date = "", time = ""] = parts.split(" ");
  return { date, time: time.slice(0, 5) };
}
