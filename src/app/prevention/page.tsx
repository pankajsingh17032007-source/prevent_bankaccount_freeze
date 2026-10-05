import { listCounterparties, listTransactions, bandSummary } from "@/lib/db";
import { RULE_CATALOG } from "@/lib/risk";
import { setKyc, toggleWatchlist } from "@/app/actions";
import SelectAction from "@/app/components/SelectAction";
import { bandClass, inr, fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PreventionPage() {
  const [cps, transactions, summary] = await Promise.all([
    listCounterparties(60), listTransactions({ limit: 1000 }), bandSummary(),
  ]);
  const credits = transactions.filter((t) => t.credit > 0);
  const reconciled = credits.filter((t) => t.reconciled === 1);
  const reconciledAmt = reconciled.reduce((s, t) => s + t.credit, 0);
  const totalAmt = credits.reduce((s, t) => s + t.credit, 0);
  const bands = new Map(summary.map((b) => [b.band, b.n]));
  const verified = cps.filter((c) => c.kyc_status === "verified").length;

  const controls: Array<[string, string, string]> = [
    [
      "Account separation",
      "Collection account sweeps 100% to a separate operating account at 21:00 IST; payroll and vendor payments run from the operating account at a second bank.",
      "Active",
    ],
    [
      "Inbound payment risk scoring",
      "Every credit is scored on payer history, fan-in clusters, night postings, watchlist exposure and order reconciliation before it is treated as settled.",
      "Active",
    ],
    [
      "Counterparty KYC",
      "Suppliers and large buyers are verified against GSTIN/PAN before the first payment; renewal is tracked with an expiry state.",
      `${verified}/${cps.length} verified`,
    ],
    [
      "Order-to-cash reconciliation",
      "A credit that cannot be mapped to a real order is quarantined instead of being swept - unreconciled money is what gets frozen first.",
      `${Math.round((reconciledAmt / Math.max(1, totalAmt)) * 100)}% reconciled`,
    ],
    [
      "Payment gateway / nodal routing",
      "Card and UPI volume routed through a gateway with its own nodal or escrow structure keeps card settlement out of the direct line of a lien.",
      "Recommended",
    ],
    [
      "Backup payment rail",
      "Axis backup account is funded by a standing transfer from operating; one payroll cycle can run without the frozen account.",
      "Armed",
    ],
  ];

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Prevention</h1>
          <p className="sub">
            A freeze is far cheaper to survive than to undo. These controls shrink both the chance of a freeze and the
            blast radius when one lands.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Account separation blueprint</h2>
            <p className="sub small">One lien should never be able to reach payroll.</p>
          </div>
          <span className="badge ok">Configured</span>
        </div>
        <div className="grid g-4" style={{ gap: 14 }}>
          <div className="card" style={{ background: "var(--panel-2)", boxShadow: "none" }}>
            <div className="tiny muted">1 · Collect</div>
            <h3 style={{ marginTop: 4 }}>HDFC collection</h3>
            <div className="mono small">50200048291736</div>
            <p className="tiny muted" style={{ marginTop: 6 }}>
              Receives every marketplace, PG and UPI credit. Only this account is exposed to a lien.
            </p>
          </div>
          <div className="card" style={{ background: "var(--panel-2)", boxShadow: "none" }}>
            <div className="tiny muted">2 · Sweep · daily 21:00 IST</div>
            <h3 style={{ marginTop: 4 }}>Auto-sweep</h3>
            <div className="mono small">100% → operating</div>
            <p className="tiny muted" style={{ marginTop: 6 }}>
              Balance is pushed out nightly so a freeze freezes today&apos;s receipts, not tomorrow&apos;s payroll.
            </p>
          </div>
          <div className="card" style={{ background: "var(--panel-2)", boxShadow: "none" }}>
            <div className="tiny muted">3 · Operate</div>
            <h3 style={{ marginTop: 4 }}>ICICI operating</h3>
            <div className="mono small">000705004419</div>
            <p className="tiny muted" style={{ marginTop: 6 }}>
              Payroll, vendors and GST payments. Unaffected while the collection account is held.
            </p>
          </div>
          <div className="card" style={{ background: "var(--panel-2)", boxShadow: "none" }}>
            <div className="tiny muted">4 · Backup</div>
            <h3 style={{ marginTop: 4 }}>Axis reserve</h3>
            <div className="mono small">918020071934401</div>
            <p className="tiny muted" style={{ marginTop: 6 }}>
              Second bank with its own relationship - the fallback rail if a hold spreads beyond one bank.
            </p>
          </div>
        </div>
      </div>

      <div className="grid g-21">
        <div className="card tight">
          <div className="card-head"><h2>Control checklist</h2></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Control</th><th>How it works</th><th>Status</th></tr></thead>
              <tbody>
                {controls.map(([name, how, status]) => (
                  <tr key={name}>
                    <td><b className="small">{name}</b></td>
                    <td className="small muted">{how}</td>
                    <td><span className={`badge ${status.includes("%") || status.includes("/") ? "brand" : "ok"}`}>{status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>Exposure snapshot</h2></div>
          <dl className="kv">
            <dt>Credits reviewed</dt><dd>{credits.length} · {inr(totalAmt)}</dd>
            <dt>Reconciled to orders</dt><dd>{reconciled.length} · {inr(reconciledAmt)}</dd>
            <dt>Unreconciled</dt><dd>{inr(totalAmt - reconciledAmt)}</dd>
            <dt>KYC verified</dt><dd>{verified} of {cps.length} counterparties</dd>
            <dt>Watchlisted payers</dt><dd>{cps.filter((c) => c.watchlist === 1).length}</dd>
            <dt>Critical band</dt><dd>{bands.get("CRITICAL") ?? 0} credits</dd>
          </dl>
          <div className="notice" style={{ marginTop: 14 }}>
            Money that cannot be tied to a real order is the money a bank holds first. Reconciliation coverage is the
            single highest-leverage prevention metric.
          </div>
        </div>
      </div>

      <div className="card tight">
        <div className="card-head">
          <h2>Counterparty register</h2>
          <span className="small muted">KYC saves on change · watchlist feeds the risk engine</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Counterparty</th><th>First seen</th><th>Last seen</th>
                <th className="right">Credits</th><th className="right">Count</th><th>KYC</th><th>Watchlist</th>
              </tr>
            </thead>
            <tbody>
              {cps.map((c) => (
                <tr key={c.id}>
                  <td>
                    <b className="small">{c.name}</b>
                    <div className="tiny muted">{c.note}</div>
                  </td>
                  <td className="small muted">{fmtDate(c.first_seen)}</td>
                  <td className="small muted">{fmtDate(c.last_seen)}</td>
                  <td className="right mono small">{inr(c.credits_total)}</td>
                  <td className="right mono small">{c.credit_count}</td>
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
                      <button className="sm ghost" type="submit">{c.watchlist ? "Flagged" : "Clear"}</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid g-2">
        <div className="card">
          <div className="card-head"><h2>Inbound risk signals in use</h2></div>
          <div className="stack" style={{ gap: 8 }}>
            {RULE_CATALOG.map((r) => (
              <div className="row" key={r.code} style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <div className="grow small">{r.label}</div>
                <span className="badge plain">+{r.points}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h2>Payment routing guidance</h2></div>
          <div className="stack" style={{ gap: 10 }}>
            <div>
              <b className="small">Keep card settlement in the gateway</b>
              <p className="tiny muted">Card captures that settle through a gateway with its own nodal structure do not sit as raw credits in the collection account for long.</p>
            </div>
            <div>
              <b className="small">Never commingle personal and trade receipts</b>
              <p className="tiny muted">A single unrelated credit in a business account is enough to pull the whole account into an investigation.</p>
            </div>
            <div>
              <b className="small">Quarantine unreconciled credits</b>
              <p className="tiny muted">Hold unmatched credits for a review window instead of sweeping them; if the payer is a mule, you have kept the money out of reach of a lien.</p>
            </div>
            <div>
              <b className="small">Name-match on every large credit</b>
              <p className="tiny muted">A payer name that does not match the order or the GSTIN on the invoice is the cheapest early warning there is.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="notice">
        Counterparty and routing controls reduce the chance of a freeze; they do not replace the bank&apos;s own
        obligations. Keep every circular you rely on dated and re-checked.
      </div>
    </div>
  );
}
