import type { Client, InArgs, InValue, InStatement, Transaction as LibsqlTransaction } from "@libsql/client";

import { turso } from "./turso";
import { buildStages } from "./cases";
import { localDate, localStamp } from "./format";
import { scoreTransaction } from "./risk";
import type { Counterparty, CreditLine, FreezeCase, Order, Statement, Transaction } from "./types";

let initialization: Promise<void> | undefined;

export async function db(): Promise<Client> {
  if (!initialization) initialization = initializeDatabase(turso);
  await initialization;
  return turso;
}

async function initializeDatabase(d: Client): Promise<void> {
  await d.executeMultiple(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS statements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    bank TEXT NOT NULL,
    account_no TEXT NOT NULL,
    uploaded_at TEXT NOT NULL,
    txn_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    statement_id INTEGER NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
    posted_at TEXT NOT NULL,
    narration TEXT NOT NULL,
    payer TEXT NOT NULL DEFAULT '',
    ref_no TEXT NOT NULL DEFAULT '',
    credit REAL NOT NULL DEFAULT 0,
    debit REAL NOT NULL DEFAULT 0,
    balance REAL NOT NULL DEFAULT 0,
    order_id INTEGER,
    risk_score INTEGER NOT NULL DEFAULT 0,
    risk_band TEXT NOT NULL DEFAULT 'LOW',
    risk_reasons TEXT NOT NULL DEFAULT '[]',
    reconciled INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_txn_posted ON transactions(posted_at);
  CREATE INDEX IF NOT EXISTS idx_txn_band ON transactions(risk_band);

  CREATE TABLE IF NOT EXISTS counterparties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL DEFAULT 'customer',
    gstin TEXT,
    kyc_status TEXT NOT NULL DEFAULT 'unverified',
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    credits_total REAL NOT NULL DEFAULT 0,
    credit_count INTEGER NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT '',
    watchlist INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no TEXT NOT NULL UNIQUE,
    buyer TEXT NOT NULL,
    amount REAL NOT NULL,
    placed_at TEXT NOT NULL,
    invoice_no TEXT,
    ship_status TEXT NOT NULL DEFAULT 'delivered',
    awb TEXT,
    proof_url TEXT
  );

  CREATE TABLE IF NOT EXISTS cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_ref TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    account_no TEXT NOT NULL,
    bank TEXT NOT NULL,
    branch TEXT NOT NULL DEFAULT '',
    hold_amount REAL NOT NULL,
    disputed_amount REAL NOT NULL,
    account_balance REAL NOT NULL,
    hold_scope TEXT NOT NULL DEFAULT 'full_balance',
    trigger_source TEXT NOT NULL DEFAULT 'NCRP/I4C complaint',
    ncrp_complaint TEXT,
    fir_no TEXT,
    police_station TEXT NOT NULL DEFAULT '',
    freeze_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS case_stages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    step_no INTEGER NOT NULL,
    name TEXT NOT NULL,
    authority TEXT NOT NULL,
    sla_days INTEGER NOT NULL,
    due_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'not_started',
    template_key TEXT NOT NULL,
    actioned_at TEXT,
    log TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_stage_case ON case_stages(case_id);

  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    doc_type TEXT NOT NULL,
    title TEXT NOT NULL,
    ref TEXT NOT NULL DEFAULT '',
    present INTEGER NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS credit_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    kind TEXT NOT NULL,
    limit_amount REAL NOT NULL,
    rate_pa REAL NOT NULL,
    eligibility TEXT NOT NULL DEFAULT '',
    activation TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'available'
  );
  `);
  const tx = await d.transaction("write");
  try {
    const result = await tx.execute({ sql: "SELECT COUNT(*) AS n FROM statements" });
    if (Number(result.rows[0]?.n ?? 0) === 0) await seed(tx);
    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.close();
  }
}

/* ------------------------------------------------------------------ */
/* seed                                                                */
/* ------------------------------------------------------------------ */

const CUSTOMER_NAMES = [
  "RAHUL SHARMA", "ANANYA IYER", "VIKRAM SINGH", "PRIYA NAIR", "AMIT KULKARNI",
  "SNEHA REDDY", "ARJUN MEHTA", "DIVYA PILLAI", "ROHAN GUPTA", "KAVITA JOSHI",
  "MANISH AGRAWAL", "NEHA BHALERAO", "SANDEEP KAPOOR", "TANVI DESAI", "IMRAN KHAN",
  "POOJA MENON", "HARSH VARDHAN", "RICHA SAXENA", "DEV PATEL", "MEGHA CHOPRA",
  "SIDDHARTH RAO", "ANJALI VERMA", "NIKHIL BHATIA", "SHREYA KAMATH", "GAURAV TYAGI",
];

// Accounts that appear on our internal watchlist (frozen / mule-flagged upstream).
const WATCHLIST_NAMES = [
  "SUNRISE TRADERS", "GLOBAL PAY SOLUTIONS", "OM Sai Enterprises",
];

const SUSPICIOUS_FANIN_NAMES = [
  "RAMESH KUMAR", "SUNITA DEVI", "AJAY PRASAD", "KAMLESH YADAV", "GEETA WATAN",
  "MOHAN LAL", "SARITA BEN", "DEEPAK CHOUDHARY", "VEENA MISHRA", "PRAKASH THAKUR",
  "ANIL KHERA", "REENA BAWEJA", "SATISH RANA", "LATA SINGHAL",
];

const SUPPLIERS = [
  { name: "SHREE PACKAGING PVT LTD", amount: [42000, 96000] },
  { name: "BLUEDART LOGISTICS", amount: [18000, 34000] },
  { name: "AMAZON SELLING SERVICES", amount: [64000, 148000] },
  { name: "HDFC BANK CHARGES", amount: [800, 2600] },
  { name: "CLOUD HOSTING INDIA", amount: [9000, 21000] },
  { name: "PAYROLL PVT LTD", amount: [310000, 310000] },
];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const iso = (d: Date) => localDate(d);
const stamp = (d: Date) => localStamp(d);

export const MERCHANT = {
  legal_name: "Kaveri Home Products Pvt Ltd",
  short_name: "Kaveri Home",
  gstin: "29AAECK1234F1Z5",
  pan: "AAECK1234F",
  nature: "D2C home & kitchen goods",
  collection_bank: "HDFC Bank",
  collection_account: "50200048291736",
  collection_branch: "Indiranagar, Bengaluru",
  operating_bank: "ICICI Bank",
  operating_account: "000705004419",
  backup_bank: "Axis Bank",
  backup_account: "918020071934401",
  nodal_officer: "Ms. Ritu Malhotra, Nodal Officer - Grievances, HDFC Bank",
  nodal_email: "grievance@hdfcbank.example",
  sweep_policy: "100% of collection credits swept to operating account at 21:00 IST daily",
};

async function seed(d: LibsqlTransaction): Promise<void> {
  const rnd = mulberry32(20261005);
  const today = new Date();
  today.setHours(10, 0, 0, 0);
  const daysBack = 75;

  const seedBatch: InStatement[] = [
    { sql: "INSERT INTO settings(key, value) VALUES('merchant', ?)", args: [JSON.stringify(MERCHANT)] },
  ];
  const orderInserts: InStatement[] = [];
  const transactionInserts: InStatement[] = [];
  const counterpartyInserts: InStatement[] = [];

  type Row = {
    statement_id: number; posted_at: string; narration: string; payer: string; ref_no: string;
    credit: number; debit: number; balance: number; order_id: number | null;
    risk_score: number; risk_band: string; risk_reasons: string; reconciled: number;
  };
  const rows: Row[] = [];
  const cpMap = new Map<string, { first: string; last: string; total: number; count: number; watchlist: number; kind: string; kyc: string; note: string }>();

  const rememberCp = (name: string, when: string, amount: number, watchlist = 0, kyc = "unverified", note = "") => {
    const cur = cpMap.get(name);
    if (!cur) {
      cpMap.set(name, {
        first: when, last: when, total: amount, count: 1, watchlist,
        kind: watchlist ? "customer" : "customer", kyc, note,
      });
    } else {
      cur.last = when > cur.last ? when : cur.last;
      cur.first = when < cur.first ? when : cur.first;
      cur.total += amount;
      cur.count += 1;
      cur.watchlist = Math.max(cur.watchlist, watchlist);
      if (note) cur.note = note;
      if (watchlist) cur.kyc = "unverified";
    }
  };

  // statement 1: the whole window
  const st1 = await d.execute({
    sql: "INSERT INTO statements(filename, bank, account_no, uploaded_at, txn_count) VALUES(?,?,?,?,0) RETURNING id",
    args: ["hdfc-collection-75d.csv", MERCHANT.collection_bank, MERCHANT.collection_account, stamp(new Date(today.getTime() - 864e5))],
  });
  const statementId = Number(st1.rows[0]?.id);

  let balance = 486000;
  let orderSeq = 4100;
  let invoiceSeq = 2200;
  let refSeq = 412000000000;

  type NewRow = Omit<Row, "risk_score" | "risk_band" | "risk_reasons" | "order_id"> & {
    order_id?: number | null;
  };
  const push = (r: NewRow) => {
    rows.push({ ...r, order_id: r.order_id ?? null, risk_score: 0, risk_band: "LOW", risk_reasons: "[]" });
  };

  for (let back = daysBack; back >= 0; back--) {
    const day = new Date(today.getTime() - back * 864e5);
    const dow = day.getDay();
    const sales = dow === 0 ? 3 : 5 + Math.floor(rnd() * 7);

    // --- ordinary, reconciled D2C sales ---
    for (let i = 0; i < sales; i++) {
      const when = new Date(day);
      when.setHours(8 + Math.floor(rnd() * 13), Math.floor(rnd() * 60), 0, 0);
      const name = CUSTOMER_NAMES[Math.floor(rnd() * CUSTOMER_NAMES.length)];
      const amount = [499, 749, 999, 1299, 1899, 2499, 3499, 4999, 6999, 8999][Math.floor(rnd() * 10)];
      balance += amount;
      orderSeq += 1;
      invoiceSeq += 1;
      const placed = stamp(when);
      orderInserts.push({
        sql: "INSERT INTO orders (order_no, buyer, amount, placed_at, invoice_no, ship_status, awb, proof_url) VALUES (?,?,?,?,?,?,?,?)",
        args: [
          `KH-${orderSeq}`, name, amount, placed, `KHP/26-27/${invoiceSeq}`,
          back > 2 ? "delivered" : rnd() > 0.4 ? "delivered" : "in_transit",
          `AWB${String(1000000 + Math.floor(rnd() * 8999999))}`,
          back > 2 ? `https://cdn.example.com/pod/KH-${orderSeq}.pdf` : null,
        ],
      });
      push({
        statement_id: statementId,
        posted_at: stamp(when),
        narration: `UPI/DR/${(refSeq += 1)}/${name}/HDFC/kaveri${(orderSeq % 97) + 1}@okhdfcbank`,
        payer: name,
        ref_no: String(refSeq),
        credit: amount,
        debit: 0,
        balance,
        order_id: orderSeq,
        reconciled: 1,
      });
      rememberCp(name, stamp(when), amount, 0, rnd() > 0.5 ? "verified" : "pending", "");
    }

    // --- supplier / operating outflows ---
    if (dow === 1 || rnd() > 0.72) {
      const sup = SUPPLIERS[Math.floor(rnd() * SUPPLIERS.length)];
      const amount = Math.round(sup.amount[0] + rnd() * (sup.amount[1] - sup.amount[0]));
      if (balance > amount + 100000) {
        balance -= amount;
        push({
          statement_id: statementId,
          posted_at: stamp(new Date(day.getTime() + 11 * 36e5)),
          narration: `NEFT-CR-${(refSeq += 1)}/${sup.name}/BATCH`,
          payer: sup.name,
          ref_no: String(refSeq),
          credit: 0,
          debit: amount,
          balance,
          reconciled: 1,
        });
      }
    }

    // --- sweep to operating account at 21:00 ---
    if (rnd() > 0.35 && balance > 500000) {
      const sweep = Math.floor((balance - 250000) / 10000) * 10000;
      if (sweep > 0) {
        balance -= sweep;
        push({
          statement_id: statementId,
          posted_at: stamp(new Date(day.getTime() + 21 * 36e5)),
          narration: `IMPS/P2A/${(refSeq += 1)}/SWEEP TO ICICI OPERATING 000705004419`,
          payer: "INTERNAL SWEEP",
          ref_no: String(refSeq),
          credit: 0,
          debit: sweep,
          balance,
          reconciled: 1,
        });
      }
    }
  }

  /* ---- Attack pattern A: fan-in structuring (mule accounts, same amount) ---- */
  {
    const day = new Date(today.getTime() - 6 * 864e5);
    for (let i = 0; i < SUSPICIOUS_FANIN_NAMES.length; i++) {
      const when = new Date(day);
      when.setHours(9 + Math.floor(rnd() * 5), Math.floor(rnd() * 60), 0, 0);
      const amount = 19500;
      balance += amount;
      push({
        statement_id: statementId,
        posted_at: stamp(when),
        narration: `UPI/DR/${(refSeq += 1)}/${SUSPICIOUS_FANIN_NAMES[i]}/PAYTM/p2m${i}4x`,
        payer: SUSPICIOUS_FANIN_NAMES[i],
        ref_no: String(refSeq),
        credit: amount,
        debit: 0,
        balance,
        reconciled: 0,
      });
      rememberCp(SUSPICIOUS_FANIN_NAMES[i], stamp(when), amount, 0, "unverified", "Part of a same-day fan-in cluster.");
    }
  }

  /* ---- Attack pattern B: late-night credit from an unknown payer ---- */
  {
    const when = new Date(today.getTime() - 4 * 864e5);
    when.setHours(2, 14, 0, 0);
    const amount = 92000;
    balance += amount;
    push({
      statement_id: statementId,
      posted_at: stamp(when),
      narration: `IMPS/P2A/${(refSeq += 1)}/SANJAY GUPTA/TIME 02:14`,
      payer: "SANJAY GUPTA",
      ref_no: String(refSeq),
      credit: amount,
      debit: 0,
      balance,
      reconciled: 0,
    });
    rememberCp("SANJAY GUPTA", stamp(when), amount, 0, "unverified", "No order history; single night credit.");
  }

  /* ---- Attack pattern C: watchlist (upstream-frozen) payer ---- */
  {
    const when = new Date(today.getTime() - 3 * 864e5);
    when.setHours(14, 41, 0, 0);
    const amount = 148000;
    balance += amount;
    push({
      statement_id: statementId,
      posted_at: stamp(when),
      narration: `NEFT-CR-${(refSeq += 1)}/GLOBAL PAY SOLUTIONS/RRN88231`,
      payer: "GLOBAL PAY SOLUTIONS",
      ref_no: String(refSeq),
      credit: amount,
      debit: 0,
      balance,
      reconciled: 0,
    });
    rememberCp("GLOBAL PAY SOLUTIONS", stamp(when), amount, 1, "unverified", "Upstream account frozen in a cyber-fraud case.");
  }

  /* ---- Attack pattern D: large unreconciled credit with no order ---- */
  {
    const when = new Date(today.getTime() - 2 * 864e5);
    when.setHours(16, 2, 0, 0);
    const amount = 480000;
    balance += amount;
    push({
      statement_id: statementId,
      posted_at: stamp(when),
      narration: `RTGS/NEFT-${(refSeq += 1)}/KRISHNA ENTERPRISES/HDFT0001234`,
      payer: "KRISHNA ENTERPRISES",
      ref_no: String(refSeq),
      credit: amount,
      debit: 0,
      balance,
      reconciled: 0,
    });
    rememberCp("KRISHNA ENTERPRISES", stamp(when), amount, 0, "pending", "Large RTGS credit with no invoice on record.");
  }

  /* ---- Attack pattern E: same-amount credits clustered just under reporting thresholds ---- */
  {
    const day = new Date(today.getTime() - 1 * 864e5);
    for (let i = 0; i < 4; i++) {
      const when = new Date(day);
      when.setHours(10 + i, 12 + i * 3, 0, 0);
      const amount = 195000;
      balance += amount;
      const payer = ["SUNRISE TRADERS", "VERMA TEXTILES", "SUNRISE TRADERS", "OM SAI ENTERPRISES"][i];
      push({
        statement_id: statementId,
        posted_at: stamp(when),
        narration: `IMPS/P2A/${(refSeq += 1)}/${payer}/BATCH${i}`,
        payer,
        ref_no: String(refSeq),
        credit: amount,
        debit: 0,
        balance,
        reconciled: 0,
      });
      rememberCp(payer, stamp(when), amount, payer === "SUNRISE TRADERS" || payer === "OM SAI ENTERPRISES" ? 1 : 0,
        "unverified", payer === "SUNRISE TRADERS" ? "Flagged in internal watchlist." : "Repeated equal-value credits.");
    }
  }

  // score every transaction
  const nowIso = stamp(today);
  const payerAgg = new Map<string, { count: number; first: string }>();
  for (const r of rows) {
    const key = r.payer;
    const prev = payerAgg.get(key);
    if (!prev) payerAgg.set(key, { count: 1, first: r.posted_at });
    else prev.count += 1;
  }

  const dayCluster = new Map<string, { amounts: Map<number, number>; payers: Set<string> }>();
  for (const r of rows) {
    if (r.credit <= 0) continue;
    const day = r.posted_at.slice(0, 10);
    let c = dayCluster.get(day);
    if (!c) dayCluster.set(day, (c = { amounts: new Map(), payers: new Set() }));
    c.amounts.set(r.credit, (c.amounts.get(r.credit) ?? 0) + 1);
    c.payers.add(r.payer);
  }

  const watchlistNames = new Set<string>(["GLOBAL PAY SOLUTIONS", "SUNRISE TRADERS", "OM SAI ENTERPRISES"]);
  const knownNames = new Set<string>();

  for (const r of rows) {
    const context = {
      knownPayers: knownNames,
      dayCluster: dayCluster.get(r.posted_at.slice(0, 10)) ?? { amounts: new Map(), payers: new Set() },
      payerHistory: payerAgg.get(r.payer)!,
      watchlist: watchlistNames,
      now: nowIso,
    };
    const res = scoreTransaction(
      {
        posted_at: r.posted_at,
        payer: r.payer,
        narration: r.narration,
        credit: r.credit,
        debit: r.debit,
        reconciled: r.reconciled,
        order_id: r.order_id,
      },
      context,
    );
    r.risk_score = res.score;
    r.risk_band = res.band;
    r.risk_reasons = JSON.stringify(res.reasons);
    knownNames.add(r.payer);
    transactionInserts.push({
      sql: `INSERT INTO transactions
        (statement_id, posted_at, narration, payer, ref_no, credit, debit, balance, order_id, risk_score, risk_band, risk_reasons, reconciled)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [r.statement_id, r.posted_at, r.narration, r.payer, r.ref_no, r.credit, r.debit, r.balance,
        r.order_id, r.risk_score, r.risk_band, r.risk_reasons, r.reconciled],
    });
  }

  for (const [name, v] of cpMap) {
    counterpartyInserts.push({
      sql: `INSERT INTO counterparties (name, kind, gstin, kyc_status, first_seen, last_seen, credits_total, credit_count, note, watchlist)
        VALUES (?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(name) DO UPDATE SET last_seen=excluded.last_seen, credits_total=excluded.credits_total,
        credit_count=excluded.credit_count, watchlist=MAX(watchlist, excluded.watchlist),
        kyc_status=CASE WHEN excluded.watchlist=1 THEN 'unverified' ELSE counterparties.kyc_status END`,
      args: [name, "customer", null, v.kyc, v.first, v.last, Math.round(v.total), v.count, v.note, v.watchlist],
    });
  }

  await d.batch([...seedBatch, ...orderInserts, ...transactionInserts, ...counterpartyInserts]);
  await d.execute({
    sql: "UPDATE statements SET txn_count = (SELECT COUNT(*) FROM transactions WHERE statement_id = statements.id) WHERE id = ?",
    args: [statementId],
  });
  await d.execute({
    sql: "UPDATE counterparties SET kind='supplier', kyc_status='verified', gstin=? WHERE name IN ('SHREE PACKAGING PVT LTD','BLUEDART LOGISTICS','CLOUD HOSTING INDIA')",
    args: ["29AABCS9988K1Z2"],
  });

  await seedCases(d, today);
  await seedCreditLines(d);
}

async function seedCases(d: LibsqlTransaction, today: Date): Promise<void> {
  const insertCase = (args: InArgs) => d.execute({ sql: `
    INSERT INTO cases
      (case_ref, title, account_no, bank, branch, hold_amount, disputed_amount, account_balance,
       hold_scope, trigger_source, ncrp_complaint, fir_no, police_station, freeze_date, status, created_at, notes)
    VALUES (@case_ref, @title, @account_no, @bank, @branch, @hold_amount, @disputed_amount, @account_balance,
       @hold_scope, @trigger_source, @ncrp_complaint, @fir_no, @police_station, @freeze_date, @status, @created_at, @notes)
    RETURNING id
  `, args });
  const insertStage = (args: InArgs) => d.execute({ sql: `
    INSERT INTO case_stages (case_id, step_no, name, authority, sla_days, due_at, status, template_key, actioned_at, log)
    VALUES (@case_id, @step_no, @name, @authority, @sla_days, @due_at, @status, @template_key, @actioned_at, @log)
  `, args });
  const insertDoc = (args: InArgs) => d.execute({ sql: `
    INSERT INTO documents (case_id, doc_type, title, ref, present, note)
    VALUES (@case_id, @doc_type, @title, @ref, @present, @note)
  `, args });

  const freezeDate = iso(new Date(today.getTime() - 3 * 864e5));
  const r1 = await insertCase({
    case_ref: "AF-2026-0142",
    title: "Full-account lien after NCRP complaint on fan-in credits",
    account_no: MERCHANT.collection_account,
    bank: MERCHANT.collection_bank,
    branch: MERCHANT.collection_branch,
    hold_amount: 1186400,
    disputed_amount: 273000,
    account_balance: 1186400,
    hold_scope: "full_balance",
    trigger_source: "NCRP/I4C cyber-fraud portal complaint by an defrauded victim",
    ncrp_complaint: "NCRP/2026/HR/884213",
    fir_no: "FIR 417/2026",
    police_station: "Cyber Cell, Gurugram City",
    freeze_date: freezeDate,
    status: "awaiting_bank",
    created_at: freezeDate,
    notes:
      "Victim transferred ₹19,500 to one of 14 fan-in accounts on 29 Sep. Bank froze the entire collection account on 02 Oct rather than the traceable ₹2,73,000. Operating account (ICICI) is unaffected but sweep has stopped.",
  });
  const case1 = Number(r1.rows[0]?.id);

  for (const s of buildStages(new Date(freezeDate).getTime(), "awaiting_bank")) {
    await insertStage({ case_id: case1, ...s });
  }

  const docs1: Array<[string, string, string, number, string]> = [    ["identity", "Certificate of incorporation", "CIN U36999KA2021PTC148822", 1, "Companies Act filing"],
    ["identity", "GST registration (GSTIN)", MERCHANT.gstin, 1, "Portal download"],
    ["identity", "PAN", MERCHANT.pan, 1, ""],
    ["bank", "Account opening / KYC form", "HDFC-KYC-291736", 1, "Branch copy"],
    ["bank", "Bank statement with freeze mark", "hdfc-collection-75d.csv", 1, "Statement shows lien entry"],
    ["txn", "Payment trail for disputed credits", "14 credits x ₹19,500 on 29 Sep", 1, "Reconciled to UPI switch logs"],
    ["txn", "UPI switch / RRN extract", "RRN 6109xxxxxx series", 0, "Raise request with PG"],
    ["order", "Orders & invoices for matched credits", "KH-4100 to KH-4560", 1, "Auto-linked by reconciliation"],
    ["shipping", "Proof of delivery (POD) for delivered orders", "82 POD PDFs", 1, "Courier download"],
    ["gst", "GSTR-1 / GSTR-3B (Sep 2026)", "Filed 11 Oct 2026", 1, "Turnover consistent with credits"],
    ["affidavit", "Affidavit on source of funds", "Draft - lawyer review pending", 0, "Not a substitute for legal advice"],
  ];
  for (const [type, title, ref, present, note] of docs1) {
    await insertDoc({ case_id: case1, doc_type: type, title, ref, present, note });
  }

  const freezeDate2 = iso(new Date(today.getTime() - 26 * 864e5));
  const r2 = await insertCase({
    case_ref: "AF-2026-0128",
    title: "Partial hold on RTGS credit from Krishna Enterprises",
    account_no: MERCHANT.collection_account,
    bank: MERCHANT.collection_bank,
    branch: MERCHANT.collection_branch,
    hold_amount: 480000,
    disputed_amount: 480000,
    account_balance: 1186400,
    hold_scope: "disputed_amount",
    trigger_source: "Bank self-assessed risk hold on inbound RTGS",
    ncrp_complaint: null,
    fir_no: null,
    police_station: "",
    freeze_date: freezeDate2,
    status: "partial_release",
    created_at: freezeDate2,
    notes:
      "Bank held only the disputed amount after we submitted the source-of-funds pack. Release order awaited; remaining amount still earmarked until the beneficiary confirms.",
  });
  const case2 = Number(r2.rows[0]?.id);
  for (const s of buildStages(new Date(freezeDate2).getTime(), "partial_release")) {
    await insertStage({ case_id: case2, ...s });
  }

  const docs2: Array<[string, string, string, number, string]> = [
    ["identity", "Certificate of incorporation", "CIN U36999KA2021PTC148822", 1, ""],
    ["identity", "GST registration (GSTIN)", MERCHANT.gstin, 1, ""],
    ["txn", "Payment trail - RTGS credit", "RRN88231 / ₹4,80,000", 1, "Originator details obtained"],
    ["order", "Invoice raised on Krishna Enterprises", "KHP/26-27/2188", 0, "Buyer claims order via WhatsApp; invoice never raised"],
    ["bank", "Statement with lien entry", "hdfc-collection-75d.csv", 1, ""],
  ];
  for (const [type, title, ref, present, note] of docs2) {
    await insertDoc({ case_id: case2, doc_type: type, title, ref, present, note });
  }
}

async function seedCreditLines(d: LibsqlTransaction): Promise<void> {
  const rows: Array<Omit<CreditLine, "id">> = [
    {
      provider: "Kaveri's alternate bank (ICICI) - overdraft against FD/GST",
      kind: "overdraft",
      limit_amount: 1500000,
      rate_pa: 10.5,
      eligibility: "18 months of GST filings, avg monthly turnover ₹26L",
      activation: "Instant drawdown; not linked to the frozen HDFC account",
      status: "available",
    },
    {
      provider: "Invoice discounting platform (TReDS / NBFC)",
      kind: "invoice_discounting",
      limit_amount: 800000,
      rate_pa: 12.0,
      eligibility: "Invoices to verified B2B buyers with 30-60 day terms",
      activation: "Raise against unbilled-unpaid invoices within 1 working day",
      status: "available",
    },
    {
      provider: "Working-capital term loan (pre-approved)",
      kind: "working_capital",
      limit_amount: 2500000,
      rate_pa: 13.25,
      eligibility: "Pre-approved offer based on 24 months banking",
      activation: "Requires no-link-to-frozen-account declaration",
      status: "applied",
    },
    {
      provider: "Payroll rail - salary advance via alternate bank",
      kind: "payroll_rail",
      limit_amount: 450000,
      rate_pa: 0,
      eligibility: "28 employees on Axis salary accounts",
      activation: "Switch disbursement account to Axis backup for one cycle",
      status: "available",
    },
  ];
  await d.batch(rows.map((r) => ({
    sql: `INSERT INTO credit_lines (provider, kind, limit_amount, rate_pa, eligibility, activation, status)
      VALUES (@provider, @kind, @limit_amount, @rate_pa, @eligibility, @activation, @status)`,
    args: r,
  })));
}

/* ------------------------------------------------------------------ */
/* queries                                                             */
/* ------------------------------------------------------------------ */

async function selectRows<T>(sql: string, args?: InArgs): Promise<T[]> {
  const result = await (await db()).execute(sql, args);
  return result.rows as unknown as T[];
}

export async function getMerchant(): Promise<typeof MERCHANT> {
  const row = (await selectRows<{ value: string }>("SELECT value FROM settings WHERE key='merchant'"))[0];
  return row ? JSON.parse(row.value) : MERCHANT;
}

export async function listStatements(): Promise<Statement[]> {
  return selectRows<Statement>("SELECT * FROM statements ORDER BY id DESC");
}

export async function listTransactions(opts: { band?: string; limit?: number; offset?: number; q?: string } = {}): Promise<Transaction[]> {
  const where: string[] = [];
  const params: InValue[] = [];
  if (opts.band && opts.band !== "ALL") {
    where.push("risk_band = ?");
    params.push(opts.band);
  }
  if (opts.q) {
    where.push("(payer LIKE ? OR narration LIKE ? OR ref_no LIKE ?)");
    params.push(`%${opts.q}%`, `%${opts.q}%`, `%${opts.q}%`);
  }
  const sql = `SELECT * FROM transactions ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY posted_at DESC LIMIT ? OFFSET ?`;
  params.push(opts.limit ?? 200, opts.offset ?? 0);
  return selectRows<Transaction>(sql, params);
}

export async function countTransactions(band?: string): Promise<number> {
  const rows = band && band !== "ALL"
    ? await selectRows<{ n: number }>("SELECT COUNT(*) n FROM transactions WHERE risk_band=?", [band])
    : await selectRows<{ n: number }>("SELECT COUNT(*) n FROM transactions");
  return Number(rows[0]?.n ?? 0);
}

export async function bandSummary(): Promise<Array<{ band: string; n: number; amount: number }>> {
  return selectRows("SELECT risk_band band, COUNT(*) n, SUM(credit) amount FROM transactions WHERE credit>0 GROUP BY risk_band");
}

export async function creditTotal(band: string): Promise<number> {
  const rows = await selectRows<{ t: number }>("SELECT COALESCE(SUM(credit),0) t FROM transactions WHERE risk_band=?", [band]);
  return Number(rows[0]?.t ?? 0);
}

export async function listCounterparties(limit = 50): Promise<Counterparty[]> {
  return selectRows("SELECT * FROM counterparties ORDER BY credits_total DESC LIMIT ?", [limit]);
}

export async function listOrders(limit = 40): Promise<Order[]> {
  return selectRows("SELECT * FROM orders ORDER BY placed_at DESC LIMIT ?", [limit]);
}

export async function listCases(): Promise<FreezeCase[]> {
  return selectRows("SELECT * FROM cases ORDER BY freeze_date DESC");
}

export async function getCase(id: number): Promise<FreezeCase | undefined> {
  return (await selectRows<FreezeCase>("SELECT * FROM cases WHERE id=?", [id]))[0];
}

export async function listStages(caseId: number): Promise<Array<{
  id: number; case_id: number; step_no: number; name: string; authority: string; sla_days: number;
  due_at: string; status: string; template_key: string; actioned_at: string | null; log: string;
}>> {
  return selectRows("SELECT * FROM case_stages WHERE case_id=? ORDER BY step_no", [caseId]);
}

export async function listDocuments(caseId: number): Promise<Array<{
  id: number; case_id: number; doc_type: string; title: string; ref: string; present: number; note: string;
}>> {
  return selectRows("SELECT * FROM documents WHERE case_id=? ORDER BY doc_type, id", [caseId]);
}

export async function listCreditLines(): Promise<CreditLine[]> {
  return selectRows("SELECT * FROM credit_lines ORDER BY id");
}

export async function caseStats(): Promise<{ openCases: number; amountHeld: number; overdueStages: number; missingDocs: number }> {
  const [open, held, overdues, pendingDocs] = await Promise.all([
    selectRows<{ n: number }>("SELECT COUNT(*) n FROM cases WHERE status NOT IN ('released','closed')"),
    selectRows<{ t: number }>("SELECT COALESCE(SUM(hold_amount),0) t FROM cases WHERE status NOT IN ('released','closed')"),
    selectRows<{ n: number }>("SELECT COUNT(*) n FROM case_stages WHERE status IN ('not_started','in_progress','awaiting_response') AND due_at < datetime('now')"),
    selectRows<{ n: number }>("SELECT COUNT(*) n FROM documents WHERE present=0"),
  ]);
  return {
    openCases: Number(open[0]?.n ?? 0), amountHeld: Number(held[0]?.t ?? 0),
    overdueStages: Number(overdues[0]?.n ?? 0), missingDocs: Number(pendingDocs[0]?.n ?? 0),
  };
}

export async function riskFeed(limit = 40): Promise<Transaction[]> {
  return selectRows("SELECT * FROM transactions WHERE risk_band IN ('HIGH','CRITICAL') ORDER BY posted_at DESC LIMIT ?", [limit]);
}

export async function recentTransactions(limit = 25): Promise<Transaction[]> {
  return selectRows("SELECT * FROM transactions ORDER BY posted_at DESC LIMIT ?", [limit]);
}
