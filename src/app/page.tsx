import Link from "next/link";

import { bandSummary, caseStats, creditTotal, listCounterparties, listCreditLines, listCases, recentTransactions, riskFeed } from "@/lib/db";
import { explain } from "@/lib/risk";
import { statusLabel } from "@/lib/cases";

export const dynamic = "force-dynamic";

const inr = (n: number) => "Rs." + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
const bandClass: Record<string, string> = { LOW: "low", MEDIUM: "medium", HIGH: "high", CRITICAL: "critical" };
const bandColor: Record<string, string> = { LOW: "#16803c", MEDIUM: "#b45309", HIGH: "#c2410c", CRITICAL: "#c0234a" };

export default async function Overview() {
  const [stats, bands, feed, recent, cases, counterparties, lines, criticalTotal, highTotal] = await Promise.all([
    caseStats(), bandSummary(), riskFeed(8), recentTransactions(9), listCases(),
    listCounterparties(6), listCreditLines(), creditTotal("CRITICAL"), creditTotal("HIGH"),
  ]);
  const watchlist = counterparties.filter((c) => c.watchlist === 1);
  const critical = criticalTotal + highTotal;

  const bandMap = new Map(bands.map((b) => [b.band, b]));
  const totalCredits = bands.reduce((s, b) => s + (b.amount ?? 0), 0) || 1;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p className="sub">
            Inbound payment risk, live holds and the clock on every escalation for Kaveri Home Products.
          </p>
        </div>
        <div className="row no-print">
          <Link className="btn ghost" href="/risk">Open risk monitor</Link>
          <Link className="btn" href="/cases">Run a freeze case</Link>
        </div>
      </div>

      <div className="grid g-4">
        <div className="stat">
          <div className="k">Capital currently held</div>
          <div className="v">{inr(stats.amountHeld)}</div>
          <div className="d">{stats.openCases} open case{stats.openCases === 1 ? "" : "s"}</div>
        </div>
        <div className="stat">
          <div className="k">High-risk credits (30d)</div>
          <div className="v">{inr(critical)}</div>
          <div className="d">{feed.length} flagged inbound payments</div>
        </div>
        <div className="stat">
          <div className="k">Escalation steps overdue</div>
          <div className="v">{stats.overdueStages}</div>
          <div className="d">Missed deadlines escalate the case</div>
        </div>
        <div className="stat">
          <div className="k">Evidence gaps</div>
          <div className="v">{stats.missingDocs}</div>
          <div className="d">Documents still to attach</div>
        </div>
      </div>

      <div className="grid g-21">
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Risk profile of inbound credits</h2>
              <p className="sub small">Each credit is scored against explainable rules - fan-in, watchlist payers, night postings, unreconciled amounts.</p>
            </div>
            <Link className="small" href="/risk">All rules →</Link>
          </div>
          <div className="bar-list">
            {(["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).map((b) => {
              const row = bandMap.get(b);
              const amount = row?.amount ?? 0;
              const count = row?.n ?? 0;
              const pct = Math.max(1.5, (amount / totalCredits) * 100);
              return (
                <div className="bar-row" key={b}>
                  <div className="bar-top">
                    <span><span className={`badge ${bandClass[b]}`}>{b}</span> <span className="muted small">{count} credit{count === 1 ? "" : "s"}</span></span>
                    <span className="mono">{inr(amount)}</span>
                  </div>
                  <div className="bar"><i style={{ width: `${pct}%`, background: bandColor[b] }} /></div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>Live risk feed</h2></div>
          <div className="stack" style={{ gap: 10 }}>
            {feed.slice(0, 5).map((t) => {
              const reasons = explain(t.risk_reasons);
              return (
                <div key={t.id}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span className={`badge ${bandClass[t.risk_band]}`}>{t.risk_band}</span>
                    <span className="mono">{inr(t.credit)}</span>
                  </div>
                  <div className="small" style={{ marginTop: 4 }}>
                    <b>{t.payer}</b> · {t.posted_at.slice(0, 16).replace("T", " ")}
                  </div>
                  <div className="tiny muted">{reasons[0]?.label ?? "Reconciled to an order"}</div>
                </div>
              );
            })}
            {!feed.length && <p className="sub small">No flagged credits in the current window.</p>}
          </div>
        </div>
      </div>

      <div className="grid g-21">
        <div className="card tight">
          <div className="card-head">
            <h2>Freeze cases</h2>
            <Link className="small" href="/cases">Open all →</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Case</th><th>Scope</th><th>Held</th><th>Traceable</th><th>Claimable release</th><th>Status</th></tr>
              </thead>
              <tbody>
                {cases.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/cases/${c.id}`}><b>{c.case_ref}</b></Link>
                      <div className="tiny muted">{c.title}</div>
                    </td>
                    <td className="small">{statusLabel(c.hold_scope)}</td>
                    <td className="mono">{inr(c.hold_amount)}</td>
                    <td className="mono">{inr(c.disputed_amount)}</td>
                    <td className="mono"><b>{inr(Math.max(0, c.hold_amount - c.disputed_amount))}</b></td>
                    <td><span className="badge brand">{statusLabel(c.status)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-head"><h2>Continuity check</h2></div>
            <dl className="kv">
              <dt>Collection account</dt><dd>HDFC - sweep to operating halted</dd>
              <dt>Operating account</dt><dd>ICICI - unaffected</dd>
              <dt>Backup rail</dt><dd>Axis - payroll switch armed</dd>
              <dt>Standby credit</dt><dd>{inr(lines.filter((l) => l.status !== "drawn").reduce((s, l) => s + l.limit_amount, 0))} available</dd>
            </dl>
            <div className="row" style={{ marginTop: 12 }}>
              <Link className="btn ghost sm" href="/bridge">Capital bridge</Link>
              <Link className="btn ghost sm" href="/prevention">Prevention</Link>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h2>Watchlist exposure</h2></div>
            {watchlist.length ? (
              <div className="stack" style={{ gap: 8 }}>
                {watchlist.map((c) => (
                  <div className="row" key={c.id} style={{ justifyContent: "space-between" }}>
                    <span className="small"><b>{c.name}</b></span>
                    <span className="mono small">{inr(c.credits_total)}</span>
                  </div>
                ))}
                <p className="tiny muted">Credits from these payers were received before they were flagged upstream - exactly how a downstream merchant gets swept in.</p>
              </div>
            ) : (
              <p className="sub small">No watchlisted payers.</p>
            )}
          </div>
        </div>
      </div>

      <div className="card tight">
        <div className="card-head">
          <h2>Recent statement activity</h2>
          <Link className="small" href="/statements">Upload a statement →</Link>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Posted</th><th>Narration</th><th>Payer</th><th className="right">Credit</th><th className="right">Debit</th><th>Band</th></tr>
            </thead>
            <tbody>
              {recent.map((t) => (
                <tr key={t.id}>
                  <td className="mono nowrap">{t.posted_at.slice(0, 16).replace("T", " ")}</td>
                  <td className="small">{t.narration.slice(0, 64)}</td>
                  <td className="small">{t.payer}</td>
                  <td className="right mono">{t.credit ? inr(t.credit) : "-"}</td>
                  <td className="right mono">{t.debit ? inr(t.debit) : "-"}</td>
                  <td><span className={`badge ${bandClass[t.risk_band]}`}>{t.risk_band}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
