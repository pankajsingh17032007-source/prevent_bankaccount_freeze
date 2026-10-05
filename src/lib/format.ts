export const inr = (n: number) =>
  "Rs." + Math.round(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });

export const bandClass: Record<string, string> = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  CRITICAL: "critical",
};

export const bandColor: Record<string, string> = {
  LOW: "#16803c",
  MEDIUM: "#b45309",
  HIGH: "#c2410c",
  CRITICAL: "#c0234a",
};

export const fmtDate = (iso: string) => (iso ? iso.slice(0, 10) : "-");
export const fmtStamp = (iso: string) => (iso ? iso.slice(0, 16).replace("T", " ") : "-");

/*
 * Local wall-clock timestamps.
 *
 * Statement rows, freeze dates and SLA deadlines are all business events in IST.
 * `toISOString()` would shift them back to UTC (e.g. 09:15 IST becomes 03:45 and
 * lands in the "posted after midnight" bucket), so everything persisted or shown
 * as a date is formatted in the server's local zone instead.
 */
const p2 = (n: number) => String(n).padStart(2, "0");
export const localDate = (d: Date = new Date()) =>
  `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
export const localStamp = (d: Date = new Date()) =>
  `${localDate(d)}T${p2(d.getHours())}:${p2(d.getMinutes())}`;

export const daysBetween = (from: string, to = new Date()) =>
  Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 86400_000);
