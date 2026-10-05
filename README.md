# FreezeShield

B2B SaaS concept for D2C / small e-commerce merchants whose operating accounts get frozen because of
someone else's fraud upstream. The MVP centres on the two hardest, most defensible pieces:
**inbound payment risk detection** and **freeze case resolution**.

## What it does

| Area | What is built |
| --- | --- |
| Statements | CSV upload (Indian bank formats: `dd/mm/yyyy`, UPI/IMPS/NEFT narrations), payer extraction, order reconciliation |
| Risk monitor | Explainable 0-100 scoring per credit: watchlist payers, same-day fan-in, night postings, near-threshold clusters, unreconciled money |
| Freeze cases | Case record (hold, traceable amount, NCRP/FIR refs), 6-step escalation ladder with deadlines measured from the freeze date |
| Evidence pack | Auto-compiled pack: payment trail, invoices, PODs, GST/KYC checklist, partial-release computation, chronology — export as Markdown or print-ready HTML |
| Draft letters | Templates for the internal memo, nodal officer, cyber cell, grievance officer, Ombudsman and an advocate's brief |
| Prevention | Account-separation blueprint, sweep policy, counterparty KYC register, watchlist, reconciliation coverage |
| Capital bridge | Standby facilities, continuity plan, cost of the bridge, payroll/vendor coverage math |
| Verified profile | Shareable "merchant verified" attestation a bank can look up before a blanket freeze |

## Run it

```bash
npm install
```

Configure `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in `.env.local` with the credentials
for your Turso database before running the app. The first request connects to Turso and seeds
the demo merchant when the statements table is empty.

```bash
npm run dev        # http://localhost:3000
npm test           # parser + risk-engine unit tests (node --test)
npm run typecheck  # tsc --noEmit
npm run build      # production build
```

The seeded data includes a demo merchant (Kaveri Home Products), ~75 days of statement activity,
five distinct fraud patterns, two live freeze cases, documents and standby credit lines. To re-seed,
clear the demo rows from the Turso database.

## Scoring rules

Points are product defaults, not a regulatory standard.

| Rule | Points |
| --- | --- |
| Payer on the watchlist (already frozen upstream) | +45 |
| Fan-in: ≥8 unrelated accounts, identical amount, same day | +25 |
| Unreconciled credit (no order / invoice) | +20 |
| Large credit (≥ ₹2,00,000) with no invoice linkage | +20 |
| Posted 00:00-05:00 | +15 |
| Just below a reporting threshold in a cluster | +15 |
| First-ever credit from this payer | +10 |
| ≥12 distinct payers crediting the same day | +10 |

Bands: LOW < 25 · MEDIUM < 50 · HIGH < 75 · CRITICAL ≥ 75.

## Escalation ladder

1. Evidence lock-down and quantification of the traceable amount — 2 days
2. Partial-release representation to the bank's nodal officer — 7 days
3. Statement of facts to the investigating Cyber Cell / PS — 10 days
4. Escalation to the bank's grievance officer — 15 days
5. Complaint to the Banking Ombudsman — 30 days
6. Writ under Article 226, via advocate — 45 days

Timelines are product defaults derived from published grievance-redressal practice and court
observations that a lien should be limited to the traceable amount. **They must be re-verified
against the current circular and portal process before anyone relies on them.**

## Risks this build deliberately respects

- **No legal advice.** Every generated document is labelled as factual drafting; legal
  characterisation is deferred to an advocate.
- **No bank integration required.** Everything works off statement uploads, so early value does not
  depend on banks cooperating.
- **Sensitive data is stored in Turso.** Uploaded statements and derived records are sent to the
  configured Turso database. Restrict database access and add field-level PII handling and audited
  access before real customer data goes in.

## Layout

```
src/lib/statement.ts   pure CSV/date/payer parsing (unit-tested)
src/lib/risk.ts        scoring rules + rule catalogue
src/lib/csv.ts         ingestion: reconcile, score, write, refresh register
src/lib/cases.ts       escalation ladder builder (deadlines, statuses)
src/lib/templates.ts   letter templates per stage
src/lib/evidence.ts    evidence pack + markdown export
src/lib/db.ts          Turso schema, seed data, async queries
src/app/               pages, server actions, download routes
src/app/api/pack       evidence pack (.md / .html)
src/app/api/letter     individual letters (.txt)
src/app/api/profile    shareable verified profile
tests/                 statement parser + risk engine unit tests
```

## Not yet built (deliberate cuts)

- Account Aggregator / account-link integrations (statement upload covers the MVP)
- Real payment-gateway nodal integration, live bank APIs
- Lawyer marketplace and financing partner workflows (modelled as facilities + templates)
- Auth, multi-tenant organisations, encryption at rest
