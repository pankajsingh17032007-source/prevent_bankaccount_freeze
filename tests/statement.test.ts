/**
 * Unit tests for the pure statement parser.
 * Run: npm test   (node --experimental-strip-types --test)
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { extractPayer, parseCsv, parseDate, parseStatement } from "../src/lib/statement.ts";

test("parseCsv handles quotes, semicolons and blank lines", () => {
  const grid = parseCsv('a,b\n"hello, world",2\n\n');
  assert.deepEqual(grid, [["a", "b"], ["hello, world", "2"]]);
});

test("parseDate keeps Indian dd/mm/yyyy and preserves the time", () => {
  assert.equal(parseDate("02/10/2026 09:15"), "2026-10-02T09:15");
  assert.equal(parseDate("02/10/2026"), "2026-10-02T12:00"); // no time column -> neutral midday
  assert.equal(parseDate("2026-10-02"), "2026-10-02T12:00");
  assert.equal(parseDate("5-Oct-2026 02:14"), "2026-10-05T02:14");
});

test("parseDate rejects rubbish rather than inventing a row", () => {
  assert.equal(parseDate(""), null);
  assert.equal(parseDate("narration only"), null);
});

test("extractPayer pulls the name out of every supported narration", () => {
  const cases: Array<[string, string]> = [
    ["UPI/DR/412000000587/PRIYA NAIR/HDFC/kaveri1@okhdfcbank", "PRIYA NAIR"],
    ["IMPS/P2A/77889900/UNKNOWN PAYEE/TIME 02:14", "UNKNOWN PAYEE"],
    ["NEFT-CR-99112233/SUNRISE TRADERS/BATCH", "SUNRISE TRADERS"],
    ["RTGS/NEFT-412000000608/KRISHNA ENTERPRISES/HDFT0001234", "KRISHNA ENTERPRISES"],
    ["IMPS/P2A/11223344/VERMA TEXTILES/BATCH1", "VERMA TEXTILES"],
  ];
  for (const [narration, expected] of cases) {
    assert.equal(extractPayer(narration), expected, narration);
  }
});

test("extractPayer never returns a bare reference number", () => {
  assert.notEqual(extractPayer("NEFT-CR-99112233/SUNRISE TRADERS/BATCH"), "99112233");
});

test("parseStatement reads a full statement, including unquoted thousands", () => {
  const csv = [
    "Date,Narration,Ref No.,Withdrawal (Dr.),Deposit (Cr.),Closing Balance",
    '01/10/2026 09:12,UPI/DR/555100223344/PRIYA NAIR/HDFC/x@okhdfcbank,UPI555100223344,,1,299,1187699',
    '02/10/2026,NEFT-CR-99112233/SUNRISE TRADERS/BATCH,RRN99112233,,"1,95,000",1384598',
    '03/10/2026,NEFT-CR-55667788/SHREE PACKAGING PVT LTD/BATCH,NEFT55667788,48,000,,1623598',
    "not a transaction row",
  ].join("\n");

  const res = parseStatement(csv);
  assert.equal(res.issues.length, 0, res.issues.join("; "));
  assert.equal(res.rows.length, 3);

  const [a, b, c] = res.rows;
  assert.equal(a.posted_at, "2026-10-01T09:12");
  assert.equal(a.payer, "PRIYA NAIR");
  assert.equal(a.credit, 1299); // unquoted 1,299 re-joined
  assert.equal(b.payer, "SUNRISE TRADERS");
  assert.equal(b.credit, 195000); // quoted 1,95,000 with Indian grouping
  assert.equal(b.balance, 1384598);
  assert.equal(c.debit, 48000);
  assert.equal(c.credit, 0);
  assert.equal(c.balance, 1623598);
});

test("parseStatement reports a header it cannot understand", () => {
  const res = parseStatement("foo,bar\nbaz,qux");
  assert.equal(res.rows.length, 0);
  assert.ok(res.issues.length > 0);
});

test("unquoted Indian amount grouping is re-joined, not truncated", () => {
  const csv = [
    "Date,Narration,Ref No.,Withdrawal (Dr.),Deposit (Cr.),Closing Balance",
    "02/10/2026 11:05,NEFT-CR-99112233/SUNRISE TRADERS/BATCH,RRN99112233,,1,95,000,1384598",
    "03/10/2026 15:02,IMPS/P2A/11223344/VERMA TEXTILES/BATCH1,IMPS11223344,,4,29,000,1671598",
  ].join("\n");

  const res = parseStatement(csv);
  assert.equal(res.rows.length, 2);
  assert.equal(res.rows[0].payer, "SUNRISE TRADERS");
  assert.equal(res.rows[0].credit, 195000, "1,95,000 must not become 1");
  assert.equal(res.rows[0].balance, 1384598);
  assert.equal(res.rows[1].credit, 429000);
  assert.equal(res.rows[1].balance, 1671598);
});
