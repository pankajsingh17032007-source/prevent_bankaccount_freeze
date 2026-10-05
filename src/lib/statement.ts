/**
 * Bank statement parsing - pure functions, no database, no I/O.
 *
 * Kept free of imports so it can be unit-tested directly with Node's type
 * stripping (`node --experimental-strip-types --test`).
 */

export interface ParsedRow {
  posted_at: string;
  narration: string;
  payer: string;
  ref_no: string;
  credit: number;
  debit: number;
  balance: number;
}

export interface ParseResult {
  rows: ParsedRow[];
  skipped: number;
  issues: string[];
}

/* ------------------------------------------------------------------ */
/* generic CSV                                                          */
/* ------------------------------------------------------------------ */

export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const clean = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === "," || ch === "\t" || ch === ";") { row.push(cell); cell = ""; continue; }
    if (ch === "\n") { row.push(cell); out.push(row); row = []; cell = ""; continue; }
    cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); out.push(row); }
  return out.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c.length));
}

const HEADER: Record<string, string[]> = {
  posted_at: ["date", "txn date", "transaction date", "value date", "posted on"],
  narration: ["narration", "description", "particulars", "details", "transaction remarks", "remark"],
  ref_no: ["ref", "reference", "utr", "rrn", "cheque", "instr no", "reference no"],
  debit: ["debit", "withdrawal", "dr", "paid out", "debit (dr)"],
  credit: ["credit", "deposit", "cr", "paid in", "credit (cr)"],
  balance: ["balance", "closing balance", "balance amount"],
};

function matchCol(header: string[], keys: string[]): number {
  const h = header.map((x) => x.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim());
  for (const k of keys) {
    const i = h.findIndex((x) => x === k || x.replace(/\s+/g, " ") === k);
    if (i >= 0) return i;
  }
  for (const k of keys) {
    const i = h.findIndex((x) => x.includes(k));
    if (i >= 0) return i;
  }
  return -1;
}

const p2 = (n: number) => String(n).padStart(2, "0");

/**
 * Parse an Indian bank statement date. Time of day is taken from the row when the
 * export carries it; when it does not, midday is assumed so the after-midnight rule
 * never fires on a statement that simply has no time column.
 *
 * Dates are kept as local wall-clock strings - a freeze at 09:15 IST must not be
 * rewritten to 03:45 by a UTC conversion.
 */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const tm = /(\d{1,2}):(\d{2})(?::\d{2})?/.exec(s);
  const time = tm ? `${tm[1].padStart(2, "0")}:${tm[2]}` : "12:00";

  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${time}`;

  m = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/.exec(s);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = `20${y}`;
    // Indian exports are overwhelmingly dd/mm/yyyy
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T${time}`;
  }

  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})/.exec(s);
  if (m) {
    const mi = months.indexOf(m[2].toLowerCase());
    if (mi >= 0) return `${m[3]}-${p2(mi + 1)}-${m[1].padStart(2, "0")}T${time}`;
  }

  const t = Date.parse(s);
  if (!Number.isNaN(t)) {
    const d = new Date(t);
    const date = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
    return `${date}T${time}`;
  }
  return null;
}

const amount = (raw: string): number => {
  const n = Number(String(raw).replace(/[,₹\s]/g, "").replace(/[()]/g, (x) => (x === "(" ? "-" : "")));
  return Number.isFinite(n) ? Math.abs(n) : 0;
};

/**
 * Indian exports often write amounts as 1,299 or 1,95,000 without quoting them,
 * which splits a row into more cells than there are columns. Re-join the numeric
 * fragments (the last group is always 1-3 digits) until the row lines up again.
 */
function realignRow(row: string[], columns: number): string[] {
  const r = [...row];
  while (r.length > columns) {
    let idx = -1;
    for (let i = 0; i < r.length - 1; i++) {
      if (/^\d{1,4}$/.test(r[i]) && /^\d{1,3}$/.test(r[i + 1])) { idx = i; break; }
    }
    if (idx < 0) break;
    r.splice(idx, 2, r[idx] + r[idx + 1]);
  }
  return r;
}

/**
 * Pull a payer name out of an Indian bank narration.
 *
 * Formats handled:
 *   UPI/DR/<ref>/<PAYEE>/BANK/vpa
 *   IMPS/P2A/<ref>/<PAYEE>/TIME hh:mm
 *   NEFT-CR-<ref>/<PAYEE>/BATCH      (scheme and ref joined by dashes)
 *   RTGS/NEFT-<ref>/<PAYEE>/IFSC
 */
export function extractPayer(narration: string): string {
  const clean = (s: string) =>
    s.replace(/[^A-Z0-9 .&]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);

  const n = narration.toUpperCase();
  const parts = n.split("/").map((p) => p.trim()).filter(Boolean);
  const head = parts[0] ?? "";

  let name: string | undefined;
  if (head.startsWith("UPI") && parts.length > 3) name = parts[3];
  else if (head.startsWith("IMPS") && parts.length > 3) name = parts[3];
  else if (/^(NEFT|RTGS|ACH|NACH)/.test(head)) {
    if (head.includes("-")) name = parts[1];
    else if (parts.length > 2) name = parts[2];
  }
  if (!name) {
    // scheme token is not first, e.g. "RTGS/NEFT-<ref>/<PAYEE>/IFSC"
    const idx = parts.findIndex((p) => /^(UPI|IMPS|NEFT|RTGS|ACH|NACH)-/.test(p));
    if (idx >= 0 && parts.length > idx + 1) name = parts[idx + 1];
  }
  // A pure reference number is never the payer.
  if (name && name.replace(/[^0-9]/g, "").length >= 8 && !/[A-Z]{3}/.test(name)) name = undefined;
  if (name) return clean(name);
  return clean(narration);
}

/* ------------------------------------------------------------------ */
/* statement                                                            */
/* ------------------------------------------------------------------ */

export function parseStatement(text: string): ParseResult {
  const grid = parseCsv(text);
  const issues: string[] = [];
  if (!grid.length) return { rows: [], skipped: 0, issues: ["The file appears to be empty."] };

  const headerIdx = Math.max(0, grid.findIndex((r) => r.some((c) => /^date/i.test(c) || /^txn date/i.test(c))));
  const header = grid[headerIdx];

  const cols = {
    posted_at: matchCol(header, HEADER.posted_at),
    narration: matchCol(header, HEADER.narration),
    ref_no: matchCol(header, HEADER.ref_no),
    debit: matchCol(header, HEADER.debit),
    credit: matchCol(header, HEADER.credit),
    balance: matchCol(header, HEADER.balance),
  };
  if (cols.posted_at < 0) issues.push("No date column found - check the header row.");
  if (cols.credit < 0 && cols.debit < 0) issues.push("Neither a credit nor a debit column was found.");

  const rows: ParsedRow[] = [];
  let skipped = 0;
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const r = realignRow(grid[i], header.length);
    const posted = cols.posted_at >= 0 ? parseDate(r[cols.posted_at] ?? "") : null;
    if (!posted) { skipped++; continue; }
    const narration = cols.narration >= 0 ? r[cols.narration] ?? "" : r.join(" ");
    const credit = cols.credit >= 0 ? amount(r[cols.credit] ?? "") : 0;
    const debit = cols.debit >= 0 ? amount(r[cols.debit] ?? "") : 0;
    if (!credit && !debit) { skipped++; continue; }
    rows.push({
      posted_at: posted,
      narration,
      payer: extractPayer(narration),
      ref_no: cols.ref_no >= 0 ? r[cols.ref_no] ?? "" : "",
      credit,
      debit,
      balance: cols.balance >= 0 ? amount(r[cols.balance] ?? "") : 0,
    });
  }
  rows.sort((a, b) => a.posted_at.localeCompare(b.posted_at));
  if (!rows.length) issues.push("No usable transactions were parsed from the file.");
  return { rows, skipped, issues };
}
