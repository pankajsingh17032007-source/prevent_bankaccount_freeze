import Link from "next/link";

import { countTransactions, listStatements, listTransactions, bandSummary } from "@/lib/db";
import { explain } from "@/lib/risk";
import { uploadStatement } from "@/app/actions";
import { bandClass, inr, fmtStamp } from "@/lib/format";

export const dynamic = "force-dynamic";

const BANDS = ["ALL", "CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;

export default async function StatementsPage({
  searchParams,
}: {
  searchParams: Promise<{ band?: string; q?: string; ok?: string; n?: string; flagged?: string; band_msg?: string; err?: string; issues?: string }>;
}) {
  const sp = await searchParams;
  const band = (sp.band ?? "ALL").toUpperCase();
  const q = sp.q ?? "";
  const statements = listStatements();
  const rows = listTransactions({ band, q, limit: 120 });
  const counts = new Map(bandSummary().map((b) => [b.band, b.n]));
  const total = countTransactions();

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Statements</h1>
          <p className="sub">
            Upload a bank statement (CSV export) or work from the seeded collection account. Every credit is parsed,
            reconciled against orders and scored before it lands in the ledger.
          </p>
        </div>
      </div>

      {sp.err && <div className="notice warn">{sp.err}</div>}
      {sp.ok && (
        <div className="notice">
          Parsed <b>{sp.n}</b> transactions - <b>{sp.flagged}</b> flagged as HIGH/CRITICAL
          {sp.band_msg && sp.band_msg !== "LOW" ? <> (worst band: {sp.band_msg})</> : null}.
          {sp.issues ? <> Notes: {sp.issues}</> : null}
        </div>
      )}

      <div className="grid g-12">
        <div className="card">
          <div className="card-head"><h2>Upload a statement</h2></div>
          <form action={uploadStatement} className="stack" style={{ gap: 12 }}>
            <div>
              <label className="field" htmlFor="file">CSV file (date, narration, debit, credit, balance)</label>
              <input id="file" name="file" type="file" accept=".csv,text/csv,text/plain" required />
            </div>
            <div className="grid g-2" style={{ gap: 12 }}>
              <div>
                <label className="field" htmlFor="bank">Bank</label>
                <input id="bank" name="bank" type="text" defaultValue="HDFC Bank" />
              </div>
              <div>
                <label className="field" htmlFor="account">Account number</label>
                <input id="account" name="account" type="text" defaultValue="50200048291736" />
              </div>
            </div>
            <button type="submit" className="block">Parse and score inbound payments</button>
            <p className="tiny muted">
              The file stays on this machine - parsing happens in the request. Works with the usual Indian bank CSV
              exports (dd/mm/yyyy dates, UPI/IMPS/NEFT narrations). Time of day is used for the after-midnight rule
              when the export carries it; otherwise midday is assumed.
            </p>
          </form>
        </div>

        <div className="card tight">
          <div className="card-head"><h2>Loaded statements</h2></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>File</th><th>Bank</th><th>Account</th><th className="right">Txns</th><th>Uploaded</th></tr></thead>
              <tbody>
                {statements.map((s) => (
                  <tr key={s.id}>
                    <td className="small"><b>{s.filename}</b></td>
                    <td className="small">{s.bank}</td>
                    <td className="mono small">{s.account_no}</td>
                    <td className="right mono">{s.txn_count}</td>
                    <td className="small muted">{fmtStamp(s.uploaded_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card tight">
        <div className="card-head">
          <h2>Scored transactions <span className="muted small">({rows.length} of {total})</span></h2>
          <div className="filters no-print">
            {BANDS.map((b) => {
              const href = b === "ALL" ? "/statements" : `/statements?band=${b}`;
              return (
                <Link key={b} href={href} className={`chip ${band === b ? "on" : ""}`}>
                  {b} {b !== "ALL" ? `(${counts.get(b) ?? 0})` : `(${total})`}
                </Link>
              );
            })}
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Posted</th><th>Payer</th><th>Narration</th>
                <th className="right">Credit</th><th className="right">Score</th><th>Band</th><th>Why</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const reasons = explain(t.risk_reasons);
                return (
                  <tr key={t.id}>
                    <td className="mono nowrap small">{fmtStamp(t.posted_at)}</td>
                    <td className="small">
                      <b>{t.payer}</b>
                      {t.order_id ? <div className="tiny muted">order #{t.order_id} linked</div> : <div className="tiny muted">no order linkage</div>}
                    </td>
                    <td className="tiny muted" style={{ maxWidth: 280 }}>{t.narration.slice(0, 72)}</td>
                    <td className="right mono">{t.credit ? inr(t.credit) : <span className="muted">{inr(t.debit)}</span>}</td>
                    <td className="right mono"><b>{t.risk_score}</b></td>
                    <td><span className={`badge ${bandClass[t.risk_band]}`}>{t.risk_band}</span></td>
                    <td style={{ maxWidth: 340 }}>
                      {reasons.length ? (
                        <div className="reasons">
                          {reasons.slice(0, 3).map((r) => (
                            <div className="reason" key={r.code}>
                              <span className="pts">+{r.points}</span>
                              <span>{r.label}</span>
                            </div>
                          ))}
                          {reasons.length > 3 && <div className="tiny muted">+{reasons.length - 3} more</div>}
                        </div>
                      ) : (
                        <span className="tiny muted">Reconciled to an order - no anomaly</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr><td colSpan={7} className="muted small" style={{ padding: 22 }}>No transactions match this filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
