import { listCreditLines, listCases, caseStats } from "@/lib/db";
import { setCreditLine } from "@/app/actions";
import SelectAction from "@/app/components/SelectAction";
import { inr } from "@/lib/format";

export const dynamic = "force-dynamic";

const STATUS_OPTS = [
  { value: "available", label: "available" },
  { value: "applied", label: "applied" },
  { value: "approved", label: "approved" },
  { value: "drawn", label: "drawn" },
];

const PAYROLL = 310000;
const VENDOR_WEEK = 260000;

export default function BridgePage() {
  const lines = listCreditLines();
  const stats = caseStats();
  const cases = listCases();
  const held = stats.amountHeld;

  const available = lines.filter((l) => l.status === "available" || l.status === "approved");
  const standby = available.reduce((s, l) => s + l.limit_amount, 0);
  const payrollCycles = Math.floor(standby / PAYROLL);
  const weeksCovered = Math.floor(standby / VENDOR_WEEK);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Capital bridge</h1>
          <p className="sub">
            The account being frozen and the account funding payroll should never be the same account. This is the
            pre-arranged money that keeps the business running while a hold is untangled.
          </p>
        </div>
      </div>

      <div className="grid g-4">
        <div className="stat"><div className="k">Standby liquidity</div><div className="v">{inr(standby)}</div><div className="d">not linked to the frozen account</div></div>
        <div className="stat"><div className="k">Payroll cycles covered</div><div className="v">{payrollCycles}</div><div className="d">at {inr(PAYROLL)} per cycle</div></div>
        <div className="stat"><div className="k">Vendor weeks covered</div><div className="v">{weeksCovered}</div><div className="d">at {inr(VENDOR_WEEK)} per week</div></div>
        <div className="stat"><div className="k">Currently held</div><div className="v">{inr(held)}</div><div className="d">across {stats.openCases} open case(s)</div></div>
      </div>

      <div className="card tight">
        <div className="card-head">
          <h2>Pre-arranged facilities</h2>
          <span className="small muted">Move a facility to &quot;drawn&quot; when a freeze is detected</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Provider / facility</th><th>Type</th><th className="right">Limit</th><th className="right">Rate p.a.</th><th>Eligibility</th><th>Activation</th><th>Status</th></tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td><b className="small">{l.provider}</b></td>
                  <td className="small">{l.kind.replace(/_/g, " ")}</td>
                  <td className="right mono">{inr(l.limit_amount)}</td>
                  <td className="right mono">{l.rate_pa ? `${l.rate_pa}%` : "-"}</td>
                  <td className="tiny muted" style={{ maxWidth: 240 }}>{l.eligibility}</td>
                  <td className="tiny muted" style={{ maxWidth: 240 }}>{l.activation}</td>
                  <td>
                    <SelectAction
                      label={`Status for ${l.provider}`}
                      action={setCreditLine.bind(null, l.id)}
                      defaultValue={l.status}
                      options={STATUS_OPTS}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid g-2">
        <div className="card">
          <div className="card-head"><h2>Continuity plan while frozen</h2></div>
          <div className="ladder">
            {[
              ["Day 0", "Confirm the hold scope in writing", "Ask the bank for the exact amount held, the reason code and the lift conditions. Screenshot the lien entry in the statement."],
              ["Day 0", "Switch the sweep source", "Collection sweep is dead - fund the operating account from the reserve rail or draw the overdraft."],
              ["Day 1", "Payroll first", "Disburse salaries from the Axis backup account for this cycle so the team never sees the freeze."],
              ["Day 1-2", "Vendor triage", "Pay GST, salaries and critical logistics; defer the rest and tell vendors the real reason."],
              ["Day 2-7", "Run the escalation ladder", "Nodal officer representation with the partial-release ask, evidence pack attached."],
              ["Day 7+", "Decide on financing", "If release slips beyond the standby window, trigger invoice discounting rather than a distressed borrowing."],
            ].map(([when, title, body], i) => (
              <div className="step done" key={i}>
                <div className="step-rail"><div className="step-no">{i + 1}</div><div className="step-line" /></div>
                <div className="step-body">
                  <div className="row" style={{ marginBottom: 3 }}>
                    <b>{title}</b><span className="badge plain">{when}</span>
                  </div>
                  <div className="small muted">{body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-head"><h2>Trigger policy</h2></div>
            <dl className="kv">
              <dt>Detection</dt><dd>Lien entry in the statement, or a HIGH/CRITICAL credit from a watchlisted payer</dd>
              <dt>Automatic</dt><dd>Freeze case opened, ladder built, evidence pack compiled</dd>
              <dt>Finance</dt><dd>Standby facility moved to &quot;applied&quot; on case open</dd>
              <dt>Payments</dt><dd>Payroll account switched to Axis backup for one cycle</dd>
              <dt>Human</dt><dd>Founder signs the nodal-officer representation before it is sent</dd>
            </dl>
          </div>

          <div className="card">
            <div className="card-head"><h2>Cost of the bridge</h2></div>
            <div className="bar-list">
              {lines.filter((l) => l.rate_pa > 0).map((l) => {
                const monthly = (l.limit_amount * (l.rate_pa / 100)) / 12;
                return (
                  <div className="bar-row" key={l.id}>
                    <div className="bar-top">
                      <span className="small">{l.kind.replace(/_/g, " ")} · {l.provider.split(" - ")[0]}</span>
                      <span className="mono small">{inr(monthly)}/mo if fully drawn</span>
                    </div>
                    <div className="bar"><i style={{ width: `${Math.min(100, (monthly / 30000) * 100)}%`, background: "#1f56e0" }} /></div>
                  </div>
                );
              })}
            </div>
            <p className="tiny muted" style={{ marginTop: 12 }}>
              Compare the cost of the bridge against the cost of missed payroll, missed GST dates and stalled vendor
              credit - usually the borrowing is the cheap option.
            </p>
          </div>

          <div className="notice warn">
            Facility terms shown are illustrative product defaults, not offers. Confirm eligibility, pricing and
            underwriting with the lender before relying on any line.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Where the money is right now</h2></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Case</th><th>Status</th><th className="right">Held</th><th className="right">Traceable</th><th className="right">Tied up beyond the dispute</th></tr></thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id}>
                  <td><b className="small">{c.case_ref}</b> <span className="tiny muted">{c.title}</span></td>
                  <td className="small">{c.status.replace(/_/g, " ")}</td>
                  <td className="right mono">{inr(c.hold_amount)}</td>
                  <td className="right mono">{inr(c.disputed_amount)}</td>
                  <td className="right mono"><b>{inr(Math.max(0, c.hold_amount - c.disputed_amount))}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
