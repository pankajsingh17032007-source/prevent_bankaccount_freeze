import { bandSummary, countTransactions, getMerchant, listCases, listCounterparties, listCreditLines, listStatements, listTransactions } from "@/lib/db";
import { statusLabel } from "@/lib/cases";
import PrintButton from "@/app/components/PrintButton";
import { bandClass, fmtDate, inr, localDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function ProfilePage() {
  const merchant = getMerchant();
  const cps = listCounterparties(80);
  const credits = listTransactions({ limit: 2000 }).filter((t) => t.credit > 0);
  const totalAmt = credits.reduce((s, t) => s + t.credit, 0);
  const reconciledAmt = credits.filter((t) => t.reconciled === 1).reduce((s, t) => s + t.credit, 0);
  const bands = bandSummary();
  const cases = listCases();
  const lines = listCreditLines();
  const statements = listStatements();
  const verified = cps.filter((c) => c.kyc_status === "verified").length;
  const watchlisted = cps.filter((c) => c.watchlist === 1).length;
  const months = Math.max(1, Math.round(statements.reduce((s, x) => s + x.txn_count, 0) / 250));
  const profileId = `MV-${merchant.gstin}-2026`;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Merchant verified profile</h1>
          <p className="sub">
            A standardised profile a bank can look up before a blanket freeze: who this entity is, how money moves
            through it, and how much of it reconciles to real trade.
          </p>
        </div>
        <div className="row no-print">
          <PrintButton />
          <a className="btn" href="/api/profile" target="_blank">Open shareable version</a>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div className="tiny muted">Profile reference</div>
            <h2 style={{ fontSize: 20, marginBottom: 2 }}>{merchant.legal_name}</h2>
            <div className="small muted">
              {merchant.nature} · GSTIN {merchant.gstin} · PAN {merchant.pan}
            </div>
          </div>
          <div className="right">
            <span className="badge ok">Active</span>
            <div className="tiny muted" style={{ marginTop: 6 }}>{profileId}</div>
            <div className="tiny muted">generated {localDate()}</div>
          </div>
        </div>

        <div className="grid g-4" style={{ marginTop: 16, gap: 14 }}>
          <div className="stat" style={{ boxShadow: "none" }}>
            <div className="k">Inbound reconciled</div>
            <div className="v">{Math.round((reconciledAmt / Math.max(1, totalAmt)) * 100)}%</div>
            <div className="d">{inr(reconciledAmt)} of {inr(totalAmt)}</div>
          </div>
          <div className="stat" style={{ boxShadow: "none" }}>
            <div className="k">Counterparties verified</div>
            <div className="v">{verified}/{cps.length}</div>
            <div className="d">GSTIN / PAN checked</div>
          </div>
          <div className="stat" style={{ boxShadow: "none" }}>
            <div className="k">Statement coverage</div>
            <div className="v">{countTransactions()}</div>
            <div className="d">transactions across {statements.length} statements</div>
          </div>
          <div className="stat" style={{ boxShadow: "none" }}>
            <div className="k">Open disputes</div>
            <div className="v">{cases.filter((c) => !["released", "closed"].includes(c.status)).length}</div>
            <div className="d">disclosed below, not concealed</div>
          </div>
        </div>
      </div>

      <div className="grid g-2">
        <div className="card">
          <div className="card-head"><h2>Account architecture</h2></div>
          <dl className="kv">
            <dt>Collection</dt><dd>{merchant.collection_bank} · {merchant.collection_account}</dd>
            <dt>Operating</dt><dd>{merchant.operating_bank} · {merchant.operating_account}</dd>
            <dt>Backup</dt><dd>{merchant.backup_bank} · {merchant.backup_account}</dd>
            <dt>Sweep policy</dt><dd>{merchant.sweep_policy}</dd>
            <dt>Nodal contact</dt><dd>{merchant.nodal_officer}</dd>
          </dl>
          <p className="tiny muted" style={{ marginTop: 10 }}>
            Merchant accounts are deliberately separated so that a lien on receipts does not stop payroll, vendor
            payments or tax filings.
          </p>
        </div>

        <div className="card">
          <div className="card-head"><h2>Risk posture</h2></div>
          <div className="row" style={{ gap: 8 }}>
            {bands.map((b) => (
              <span className={`badge ${bandClass[b.band]}`} key={b.band}>
                {b.band} · {b.n}
              </span>
            ))}
          </div>
          <dl className="kv" style={{ marginTop: 14 }}>
            <dt>Watchlisted payers</dt><dd>{watchlisted} (flagged after receipt, disclosed)</dd>
            <dt>Standby liquidity</dt><dd>{inr(lines.filter((l) => l.status !== "drawn").reduce((s, l) => s + l.limit_amount, 0))} outside the collection bank</dd>
            <dt>Avg. monthly receipts</dt><dd>{inr(totalAmt / Math.max(1, months))}</dd>
            <dt>Risk controls</dt><dd>Inbound scoring, order reconciliation, counterparty KYC, nightly sweep</dd>
          </dl>
        </div>
      </div>

      <div className="card tight">
        <div className="card-head"><h2>Disclosed hold history</h2></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Case</th><th>Date</th><th>Scope</th><th className="right">Held</th><th className="right">Traceable</th><th>Status</th></tr></thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id}>
                  <td><b className="small">{c.case_ref}</b><div className="tiny muted">{c.title}</div></td>
                  <td className="small">{fmtDate(c.freeze_date)}</td>
                  <td className="small">{statusLabel(c.hold_scope)}</td>
                  <td className="right mono">{inr(c.hold_amount)}</td>
                  <td className="right mono">{inr(c.disputed_amount)}</td>
                  <td><span className="badge brand">{statusLabel(c.status)}</span></td>
                </tr>
              ))}
              {!cases.length && <tr><td colSpan={6} className="muted small" style={{ padding: 20 }}>No hold history.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Attestation</h2></div>
        <p className="small">
          This profile is generated from the entity&apos;s own bank statements, invoices, GST filings and KYC records.
          Every figure above is traceable to a document in the evidence pack. The merchant does not contest a hold up
          to the traceable amount in any disclosed matter, and undertakes to keep this profile current.
        </p>
        <div className="notice" style={{ marginTop: 12 }}>
          This is a product concept for a &quot;merchant verified&quot; directory - a shared attestation banks can query
          before placing a blanket lien. It has no legal standing on its own; it is only as good as the documents
          behind it.
        </div>
      </div>
    </div>
  );
}
