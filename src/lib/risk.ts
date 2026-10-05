import type { RiskBand, RiskReason, RiskResult } from "./types";

/**
 * Inbound payment risk scoring.
 *
 * Pure rules, no model: every point is attributable to an explainable reason so a
 * merchant (or a bank) can be told exactly WHY a credit looks risky. Weights are
 * product defaults until calibrated against real freeze cases - they are not a
 * regulatory standard.
 */

export interface TxnInput {
  posted_at: string;
  payer: string;
  narration: string;
  credit: number;
  debit: number;
  reconciled: number;
  order_id: number | null;
}

export interface ScoreContext {
  /** payers already seen earlier in the statement, in chronological order */
  knownPayers: Set<string>;
  /** same-day inbound aggregates */
  dayCluster: { amounts: Map<number, number>; payers: Set<string> };
  payerHistory: { count: number; first: string };
  watchlist: Set<string>;
  now: string;
}

/** Typical ticket size for this merchant - used for "unusually large" tests. */
const TYPICAL_AMOUNT = 1900;

const RULES = {
  WATCHLIST: { code: "WATCHLIST", points: 45, label: "Payer account is on the watchlist (upstream account already frozen / mule-flagged)" },
  FANIN: { code: "FAN_IN_SAME_DAY", points: 25, label: "Fan-in: many unrelated accounts sent the identical amount the same day (structuring signature)" },
  NIGHT: { code: "NIGHT", points: 15, label: "Posted between 00:00 and 05:00 - outside normal trading hours" },
  UNRECONCILED: { code: "UNRECONCILED", points: 20, label: "No matching order, invoice or settlement record for this credit" },
  NEW_PAYER: { code: "NEW_PAYER", points: 10, label: "First-ever credit from this payer (no relationship history)" },
  NEAR_THRESHOLD: { code: "NEAR_THRESHOLD", points: 15, label: "Amount sits just below a common reporting threshold in a same-day cluster" },
  LARGE_UNRECONCILED: { code: "LARGE_UNRECONCILED", points: 20, label: "Large credit (>= Rs.2,00,000) with no invoice linkage" },
  DAY_VOLUME: { code: "DAY_VOLUME", points: 10, label: "Unusually high number of distinct payers crediting on the same day" },
} as const;

/** Rule catalogue for the UI - see the monitor page. */
export const RULE_CATALOG = Object.values(RULES);

export function scoreTransaction(tx: TxnInput, ctx: ScoreContext): RiskResult {
  const reasons: RiskReason[] = [];
  const add = (r: { code: string; label: string; points: number }) =>
    reasons.push({ code: r.code, label: r.label, points: r.points });

  // Debits and zero-value rows carry no inbound-fraud signal.
  if (tx.credit <= 0) return { score: 0, band: "LOW", reasons: [] };

  const hour = Number(tx.posted_at.slice(11, 13));
  const payer = tx.payer.trim().toUpperCase();
  const unreconciled = tx.reconciled === 0 && !tx.order_id;
  const sameAmountCount = ctx.dayCluster.amounts.get(tx.credit) ?? 0;

  if (ctx.watchlist.has(payer)) add(RULES.WATCHLIST);
  if (sameAmountCount >= 8) add(RULES.FANIN);
  if (hour < 5) add(RULES.NIGHT);
  if (unreconciled) add(RULES.UNRECONCILED);
  if (!ctx.knownPayers.has(payer)) add(RULES.NEW_PAYER);
  if (tx.credit >= 150000 && tx.credit < 200000) add(RULES.NEAR_THRESHOLD);
  if (tx.credit >= 200000 && unreconciled) add(RULES.LARGE_UNRECONCILED);
  if (ctx.dayCluster.payers.size >= 12) add(RULES.DAY_VOLUME);

  const score = Math.min(100, reasons.reduce((s, r) => s + r.points, 0));
  return { score, band: toBand(score), reasons };
}

export function toBand(score: number): RiskBand {
  if (score >= 75) return "CRITICAL";
  if (score >= 50) return "HIGH";
  if (score >= 25) return "MEDIUM";
  return "LOW";
}

/** Human summary used in the UI and the evidence pack. */
export function explain(json: string): RiskReason[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
