/**
 * Unit tests for the inbound payment risk engine.
 * Run: npm test
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { scoreTransaction, toBand } from "../src/lib/risk.ts";
import type { ScoreContext, TxnInput } from "../src/lib/risk.ts";

function ctx(overrides: Partial<ScoreContext> = {}): ScoreContext {
  return {
    knownPayers: new Set<string>(),
    dayCluster: { amounts: new Map(), payers: new Set<string>() },
    payerHistory: { count: 1, first: "2026-01-01T10:00" },
    watchlist: new Set<string>(),
    now: "2026-10-05T10:00",
    ...overrides,
  };
}

function txn(overrides: Partial<TxnInput> = {}): TxnInput {
  return {
    posted_at: "2026-10-02T11:00",
    payer: "PRIYA NAIR",
    narration: "UPI/DR/123/PRIYA NAIR/HDFC/x@okhdfcbank",
    credit: 1299,
    debit: 0,
    reconciled: 1,
    order_id: 1,
    ...overrides,
  };
}

const codes = (r: { reasons: Array<{ code: string }> }) => r.reasons.map((x) => x.code);

test("a reconciled daytime credit from a known payer scores nothing", () => {
  const res = scoreTransaction(txn(), ctx({ knownPayers: new Set(["PRIYA NAIR"]) }));
  assert.equal(res.score, 0);
  assert.equal(res.band, "LOW");
  assert.deepEqual(res.reasons, []);
});

test("a first-ever payer is a mild signal even when the order matches", () => {
  const res = scoreTransaction(txn(), ctx());
  assert.deepEqual(codes(res), ["NEW_PAYER"]);
  assert.equal(res.band, "LOW"); // worth watching, not worth escalating
});

test("debits never carry an inbound-fraud signal", () => {
  const res = scoreTransaction(txn({ credit: 0, debit: 90000, reconciled: 0, order_id: null }), ctx());
  assert.equal(res.score, 0);
});

test("watchlist payer lands in CRITICAL", () => {
  const res = scoreTransaction(
    txn({ payer: "GLOBAL PAY SOLUTIONS", credit: 148000, reconciled: 0, order_id: null }),
    ctx({ watchlist: new Set(["GLOBAL PAY SOLUTIONS"]) }),
  );
  assert.ok(codes(res).includes("WATCHLIST"));
  assert.ok(res.score >= 75, `expected CRITICAL, got ${res.score}`);
  assert.equal(res.band, "CRITICAL");
});

test("same-day fan-in of identical amounts is flagged", () => {
  const amounts = new Map<number, number>([[19500, 14]]);
  const payers = new Set(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N"]);
  const res = scoreTransaction(
    txn({ payer: "RAMESH KUMAR", credit: 19500, reconciled: 0, order_id: null }),
    ctx({ dayCluster: { amounts, payers } }),
  );
  assert.ok(codes(res).includes("FAN_IN_SAME_DAY"));
  assert.ok(codes(res).includes("DAY_VOLUME"));
  assert.ok(res.score >= 50, `expected HIGH, got ${res.score}`);
});

test("an after-midnight credit carries the night penalty", () => {
  const res = scoreTransaction(txn({ posted_at: "2026-10-02T02:14" }), ctx());
  assert.ok(codes(res).includes("NIGHT"));
  assert.equal(res.reasons[0].points, 15);
});

test("an unreconciled large credit is penalised twice over", () => {
  const res = scoreTransaction(
    txn({ payer: "KRISHNA ENTERPRISES", credit: 480000, reconciled: 0, order_id: null }),
    ctx(),
  );
  assert.ok(codes(res).includes("UNRECONCILED"));
  assert.ok(codes(res).includes("LARGE_UNRECONCILED"));
  assert.ok(res.score >= 50, `expected HIGH, got ${res.score}`);
});

test("a known, reconciled payer stays low even for a big amount", () => {
  const res = scoreTransaction(
    txn({ payer: "AMAZON SELLING SERVICES", credit: 148000, reconciled: 1, order_id: 9 }),
    ctx({ knownPayers: new Set(["AMAZON SELLING SERVICES"]) }),
  );
  assert.equal(res.score, 0);
});

test("band boundaries are half-open", () => {
  assert.equal(toBand(0), "LOW");
  assert.equal(toBand(24), "LOW");
  assert.equal(toBand(25), "MEDIUM");
  assert.equal(toBand(49), "MEDIUM");
  assert.equal(toBand(50), "HIGH");
  assert.equal(toBand(74), "HIGH");
  assert.equal(toBand(75), "CRITICAL");
  assert.equal(toBand(100), "CRITICAL");
});

test("score is capped at 100", () => {
  const res = scoreTransaction(
    txn({ payer: "SUNRISE TRADERS", credit: 195000, posted_at: "2026-10-04T02:14", reconciled: 0, order_id: null }),
    ctx({
      watchlist: new Set(["SUNRISE TRADERS"]),
      knownPayers: new Set(),
      dayCluster: {
        amounts: new Map([[195000, 4]]),
        payers: new Set(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"]),
      },
    }),
  );
  assert.ok(res.score <= 100);
  assert.equal(res.band, "CRITICAL");
});
