import Link from "next/link";

import { listCounterparties, listTransactions, bandSummary, creditTotal, countTransactions } from "@/lib/db";
import { explain, RULE_CATALOG } from "@/lib/risk";
import { setKyc, toggleWatchlist } from "@/app/actions";
import SelectAction from "@/app/components/SelectAction";
import { bandClass, bandColor, inr, fmtStamp } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function RiskPage() {
  const [flagged, high, cps, summary, total, criticalTotal, highTotal] = await Promise.all([
    listTransactions({ band: "CRITICAL", limit: 40 }), listTransactions({ band: "HIGH", limit: 40 }),
    listCounterparties(40), bandSummary(), countTransactions(), creditTotal("CRITICAL"), creditTotal("HIGH"),
  ]);
  const all = [...flagged, ...high].sort((a, b) => b.risk_score - a.risk_score).slice(0, 30);
  const bands = new Map(summary.map((b) => [b.band, b]));

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Risk monitor</h1>
          <p className="sub">
            A freeze almost always arrives because of someone else&apos;s fraud landing in your account. These are the
            inbound payments a bank or an investigator would question first - with the exact reason attached to each one.
          </p>
        </div>
        <div className="row no-print">
          <Link className="btn ghost" href="/cases">Open freeze cases</Link>
          <Link className="btn" href="/statements">Import statement</Link>
        </div>
      </div>

      <div className="grid g-4">
        <div className="stat">
          <div className="k">Critical credits</div>
          <div className="v">{bands.get("CRITICAL")?.n ?? 0}</div>
          <div className="d">{inr(criticalTotal)} received</div>
        </div>
        <div className="stat">
          <div className="k">High credits</div>
          <div className="v">{bands.get("HIGH")?.n ?? 0}</div>
          <div className="d">{inr(highTotal)} received</div>
        </div>
        <div className="stat">
          <div className="k">Watchlisted payers</div>
          <div className="v">{cps.filter((c) => c.watchlist === 1).length}</div>
          <div className="d">Upstream accounts already frozen</div>
        </div>
        <div className="stat">
          <div className="k">Credits reviewed</div>
          <div className="v">{total}</div>
          <div className="d">Across all loaded statements</div>
        </div>
      </div>

      <div className="card tight">
        <div className="card-head">
          <h2>Payments that need a human decision</h2>
          <span className="small muted">Scored 0-100 · LOW &lt; 25 · MEDIUM &lt; 50 · HIGH &lt; 75 · CRITICAL ≥ 75</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Posted</th><th>Payer</th><th className="right">Amount</th><th>Score</th><th>Reasons</th><th>Action</th></tr>
            </thead>
            <tbody>
              {all.map((t) => {
                const reasons = explain(t.risk_reasons);
                return (
                  <tr key={t.id}>
                    <td className="mono nowrap small">{fmtStamp(t.posted_at)}</td>
                    <td>
                      <b className="small">{t.payer}</b>
                      <div className="tiny muted">{t.order_id ? `order #${t.order_id}` : "unreconciled credit"}</div>
                    </td>
                    <td className="right mono">{inr(t.credit)}</td>
                    <td style={{ minWidth: 130 }}>
                      <div className="row" style={{ justifyContent: "space-between", marginBottom: 5 }}>
                        <span className={`badge ${bandClass[t.risk_band]}`}>{t.risk_band}</span>
                        <span className="mono tiny">{t.risk_score}</span>
                      </div>
                      <div className="meter">
                        <span style={{ width: `${t.risk_score}%`, background: bandColor[t.risk_band] }} />
                      </div>
                    </td>
                    <td style={{ maxWidth: 420 }}>
                      <div className="reasons">
                        {reasons.map((r) => (
                          <div className="reason" key={r.code}>
                            <span className="pts">+{r.points}</span>
                            <span>{r.label}</span>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="small">
                      {t.risk_score >= 75 ? "Hold in escrow, verify payer before settlement" : t.risk_score >= 50 ? "Query the payer, confirm the order" : "Monitor"}
                    </td>
                  </tr>
                );
              })}
              {!all.length && <tr><td colSpan={6} className="muted small" style={{ padding: 24 }}>Nothing flagged yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid g-2">
        <div className="card">
          <div className="card-head"><h2>Scoring rules</h2></div>
          <div className="stack" style={{ gap: 9 }}>
            {RULE_CATALOG.map((r) => (
              <div className="row" key={r.code} style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <div className="grow">
                  <div className="small"><b>{r.code.replace(/_/g, " ").toLowerCase()}</b></div>
                  <div className="tiny muted">{r.label}</div>
                </div>
                <span className="badge plain">+{r.points}</span>
              </div>
            ))}
          </div>
          <div className="notice" style={{ marginTop: 14 }}>
            Weights are product defaults, not a regulatory standard. Calibrate them against real freeze cases before
            showing a score to a bank.
          </div>
        </div>

        <div className="card tight">
          <div className="card-head"><h2>Counterparty hygiene</h2></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Payer</th><th className="right">Credits</th><th>KYC</th><th>Watchlist</th></tr></thead>
              <tbody>
                {cps.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <b className="small">{c.name}</b>
                      <div className="tiny muted">{c.note || `${c.credit_count} credits since ${c.first_seen.slice(0, 10)}`}</div>
                    </td>
                    <td className="right mono small">{inr(c.credits_total)}</td>
                    <td>
                      <SelectAction
                        label={`KYC status for ${c.name}`}
                        action={setKyc.bind(null, c.id)}
                        defaultValue={c.kyc_status}
                        options={[
                          { value: "verified", label: "verified" },
                          { value: "pending", label: "pending" },
                          { value: "unverified", label: "unverified" },
                          { value: "expired", label: "expired" },
                        ]}
                      />
                    </td>
                    <td>
                      <form action={toggleWatchlist.bind(null, c.id)}>
                        <button className="sm ghost" type="submit">{c.watchlist ? "On" : "Off"}</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="tiny muted" style={{ padding: "10px 14px 14px" }}>
            KYC status saves on select. A payer on the watchlist feeds straight back into rescoring.
          </p>
        </div>
      </div>
    </div>
  );
}
