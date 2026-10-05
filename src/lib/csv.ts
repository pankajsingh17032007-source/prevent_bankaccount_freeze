import { db } from "./db";
import { localStamp } from "./format";
import { scoreTransaction } from "./risk";
import type { ScoreContext, TxnInput } from "./risk";
import { parseStatement } from "./statement";
import type { ParsedRow } from "./statement";

// The pure parsers live in ./statement.ts (unit-tested on their own); re-exported
// here so callers only need one import.
export { extractPayer, parseCsv, parseDate, parseStatement } from "./statement";
export type { ParsedRow, ParseResult } from "./statement";

/* ------------------------------------------------------------------ */
/* ingestion                                                            */
/* ------------------------------------------------------------------ */

export interface IngestResult {
  statementId: number;
  inserted: number;
  flagged: number;
  highestBand: string;
  issues: string[];
}

export async function ingestStatement(text: string, filename: string, bank: string, account: string): Promise<IngestResult> {
  const parsed = parseStatement(text);
  const d = await db();
  const tx = await d.transaction("write");
  try {
    const statement = await tx.execute({
      sql: "INSERT INTO statements(filename, bank, account_no, uploaded_at, txn_count) VALUES(?,?,?,?,0) RETURNING id",
      args: [filename, bank, account, localStamp()],
    });
    const sid = Number(statement.rows[0]?.id);

    // Reconcile credits to existing orders by amount + date.
    const orderResult = await tx.execute("SELECT id, amount, placed_at FROM orders WHERE id NOT IN (SELECT order_id FROM transactions WHERE order_id IS NOT NULL)");
    const orders = orderResult.rows as unknown as Array<{ id: number; amount: number; placed_at: string }>;
  const orderByKey = new Map<string, number>();
  for (const o of orders) orderByKey.set(`${o.amount}|${o.placed_at.slice(0, 10)}`, o.id);
  const used = new Set<number>();

  const txns: Array<ParsedRow & { order_id: number | null; reconciled: number }> = [];

  for (const r of parsed.rows) {
    let order_id: number | null = null;
    if (r.credit > 0) {
      const key = `${r.credit}|${r.posted_at.slice(0, 10)}`;
      const hit = orderByKey.get(key);
      if (hit && !used.has(hit)) { used.add(hit); order_id = hit; }
    }
    txns.push({ ...r, order_id, reconciled: order_id ? 1 : r.credit > 0 ? 0 : 1 });
  }

  // Score in chronological order: "first ever credit from this payer" is only
  // accurate if the ledger is walked in the order money actually arrived.
  const ctx = await buildContext(txns, tx);
  const blobs = ctx as ScoreContext & Partial<ScoreBlobs>;
  const flagged: number[] = [];

  const inserts = [];
  for (const t of txns) {
    const input: TxnInput = {
      posted_at: t.posted_at, payer: t.payer, narration: t.narration,
      credit: t.credit, debit: t.debit, reconciled: t.reconciled, order_id: t.order_id,
    };
    const day = t.posted_at.slice(0, 10);
    ctx.dayCluster = blobs.clusters?.get(day) ?? { amounts: new Map(), payers: new Set() };
    ctx.payerHistory = blobs.history?.get(t.payer.toUpperCase()) ?? { count: 0, first: t.posted_at };
    const res = scoreTransaction(input, ctx);
    ctx.knownPayers.add(t.payer.toUpperCase());
    if (res.score >= 50) flagged.push(res.score);
    inserts.push({
      sql: `INSERT INTO transactions
        (statement_id, posted_at, narration, payer, ref_no, credit, debit, balance, order_id, risk_score, risk_band, risk_reasons, reconciled)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [sid, t.posted_at, t.narration, t.payer, t.ref_no, t.credit, t.debit, t.balance,
        t.order_id, res.score, res.band, JSON.stringify(res.reasons), t.reconciled],
    });
  }

    if (inserts.length) await tx.batch(inserts);
    await tx.execute({ sql: "UPDATE statements SET txn_count=? WHERE id=?", args: [txns.length, sid] });
    await refreshCounterparties(tx);
    await tx.commit();

    return {
      statementId: sid,
      inserted: txns.length,
      flagged: flagged.length,
      highestBand: flagged.some((s) => s >= 75) ? "CRITICAL" : flagged.length ? "HIGH" : "LOW",
      issues: parsed.issues,
    };
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.close();
  }
}

interface ScoreBlobs {
  clusters: Map<string, { amounts: Map<number, number>; payers: Set<string> }>;
  history: Map<string, { count: number; first: string }>;
}

/**
 * Recompute the counterparty register from the ledger. Keeps first/last seen and
 * totals honest when a statement is re-uploaded, while preserving the KYC and
 * watchlist judgements a human already made.
 */
async function refreshCounterparties(d: import("@libsql/client").Client | import("@libsql/client").Transaction): Promise<void> {
  const result = await d.execute(
    `SELECT upper(trim(payer)) name, min(posted_at) first_seen, max(posted_at) last_seen,
            sum(credit) total, count(*) n
     FROM transactions WHERE credit > 0 AND trim(payer) <> ''
     GROUP BY upper(trim(payer))`,
  );
  const agg = result.rows as unknown as Array<{ name: string; first_seen: string; last_seen: string; total: number; n: number }>;
  if (agg.length) await d.batch(agg.map((a) => ({
    sql: `INSERT INTO counterparties (name, kind, gstin, kyc_status, first_seen, last_seen, credits_total, credit_count, note, watchlist)
      VALUES (?, 'customer', NULL, 'unverified', ?, ?, ?, ?, '', 0)
      ON CONFLICT(name) DO UPDATE SET
        first_seen = MIN(counterparties.first_seen, excluded.first_seen),
        last_seen = MAX(counterparties.last_seen, excluded.last_seen),
        credits_total = excluded.credits_total, credit_count = excluded.credit_count`,
    args: [a.name, a.first_seen, a.last_seen, Math.round(a.total), a.n],
  })));
}

/**
 * Assemble the aggregates the scorer needs: same-day clusters, per-payer history,
 * known payers and the watchlist of accounts already frozen upstream.
 */
async function buildContext(
  txns: Array<ParsedRow & { order_id: number | null }>,
  d: import("@libsql/client").Client | import("@libsql/client").Transaction,
): Promise<ScoreContext> {
  const ctx: ScoreContext & Partial<ScoreBlobs> = {
    knownPayers: new Set<string>(),
    dayCluster: { amounts: new Map(), payers: new Set() },
    payerHistory: { count: 0, first: "" },
    watchlist: new Set<string>(),
    now: localStamp(),
    clusters: new Map(),
    history: new Map(),
  };

  const watchlistRows = await d.execute("SELECT name FROM counterparties WHERE watchlist=1");
  for (const r of watchlistRows.rows as unknown as Array<{ name: string }>) ctx.watchlist.add(r.name.toUpperCase());
  // Payers seen in earlier statements are not "first-ever" credits, so the
  // new-payer rule only fires for genuinely unknown accounts.
  const knownRows = await d.execute("SELECT name FROM counterparties");
  for (const r of knownRows.rows as unknown as Array<{ name: string }>) ctx.knownPayers.add(r.name.toUpperCase());

  const clusters = ctx.clusters!;
  for (const t of txns) {
    if (t.credit <= 0) continue;
    const day = t.posted_at.slice(0, 10);
    let c = clusters.get(day);
    if (!c) clusters.set(day, (c = { amounts: new Map(), payers: new Set() }));
    c.amounts.set(t.credit, (c.amounts.get(t.credit) ?? 0) + 1);
    c.payers.add(t.payer.toUpperCase());
  }

  const history = ctx.history!;
  for (const t of txns) {
    const key = t.payer.toUpperCase();
    const h = history.get(key);
    if (!h) history.set(key, { count: 1, first: t.posted_at });
    else h.count += 1;
  }
  return ctx;
}
