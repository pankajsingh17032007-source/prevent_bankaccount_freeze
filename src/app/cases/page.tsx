import Link from "next/link";

import { caseStats, getMerchant, listCases, listStages } from "@/lib/db";
import { statusLabel } from "@/lib/cases";
import { createCase } from "@/app/actions";
import { inr, fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function CasesPage() {
  const [cases, stats, merchant] = await Promise.all([listCases(), caseStats(), getMerchant()]);
  const stagesByCase = new Map(await Promise.all(cases.map(async (c) => [c.id, await listStages(c.id)] as const)));

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Freeze cases</h1>
          <p className="sub">
            Each case carries the hold, the traceable amount, the escalation ladder with deadlines, the draft letters
            and the evidence pack. The default posture is partial release: contest only the disputed sum.
          </p>
        </div>
      </div>

      <div className="grid g-4">
        <div className="stat"><div className="k">Open cases</div><div className="v">{stats.openCases}</div><div className="d">awaiting a decision</div></div>
        <div className="stat"><div className="k">Amount held</div><div className="v">{inr(stats.amountHeld)}</div><div className="d">across live cases</div></div>
        <div className="stat"><div className="k">Overdue steps</div><div className="v">{stats.overdueStages}</div><div className="d">escalate today</div></div>
        <div className="stat"><div className="k">Evidence gaps</div><div className="v">{stats.missingDocs}</div><div className="d">documents pending</div></div>
      </div>

      <div className="grid g-21">
        <div className="stack">
          {cases.map((c) => {
            const stages = stagesByCase.get(c.id) ?? [];
            const next = stages.find((s) => s.status !== "done" && s.status !== "skipped");
            const done = stages.filter((s) => s.status === "done").length;
            return (
              <div className="card" key={c.id}>
                <div className="card-head">
                  <div>
                    <h2>
                      <Link href={`/cases/${c.id}`}>{c.case_ref}</Link> · {c.title}
                    </h2>
                    <p className="sub small">
                      {c.bank} · a/c {c.account_no} · freeze {fmtDate(c.freeze_date)} ·{" "}
                      {c.fir_no ? `${c.fir_no}, ${c.police_station}` : c.ncrp_complaint ?? "no police reference"}
                    </p>
                  </div>
                  <span className="badge brand">{statusLabel(c.status)}</span>
                </div>

                <div className="grid g-4" style={{ gap: 12 }}>
                  <div>
                    <div className="tiny muted">Held</div>
                    <div className="mono"><b>{inr(c.hold_amount)}</b></div>
                  </div>
                  <div>
                    <div className="tiny muted">Traceable / disputed</div>
                    <div className="mono">{inr(c.disputed_amount)}</div>
                  </div>
                  <div>
                    <div className="tiny muted">Claimable release</div>
                    <div className="mono"><b>{inr(Math.max(0, c.hold_amount - c.disputed_amount))}</b></div>
                  </div>
                  <div>
                    <div className="tiny muted">Ladder</div>
                    <div className="mono">{done}/{stages.length} steps</div>
                  </div>
                </div>

                {next && (
                  <div className="notice" style={{ marginTop: 13 }}>
                    <b>Next:</b> step {next.step_no} - {next.name} · {next.authority} · due {fmtDate(next.due_at)} ({statusLabel(next.status)})
                  </div>
                )}

                <div className="row" style={{ marginTop: 13 }}>
                  <Link className="btn sm" href={`/cases/${c.id}`}>Open case</Link>
                  <a className="btn ghost sm" href={`/api/pack/${c.id}`} target="_blank">Evidence pack (.md)</a>
                </div>
              </div>
            );
          })}
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-head"><h2>Log a new freeze</h2></div>
            <form action={createCase} className="stack" style={{ gap: 11 }}>
              <div>
                <label className="field" htmlFor="title">What happened</label>
                <input id="title" name="title" type="text" placeholder="Full-account lien after NCRP complaint" required />
              </div>
              <div className="grid g-2" style={{ gap: 11 }}>
                <div>
                  <label className="field" htmlFor="hold_amount">Amount held (Rs.)</label>
                  <input id="hold_amount" name="hold_amount" type="text" inputMode="numeric" placeholder="1186400" />
                </div>
                <div>
                  <label className="field" htmlFor="disputed_amount">Traceable amount (Rs.)</label>
                  <input id="disputed_amount" name="disputed_amount" type="text" inputMode="numeric" placeholder="273000" />
                </div>
              </div>
              <div className="grid g-2" style={{ gap: 11 }}>
                <div>
                  <label className="field" htmlFor="freeze_date">Freeze date</label>
                  <input id="freeze_date" name="freeze_date" type="date" />
                </div>
                <div>
                  <label className="field" htmlFor="hold_scope">Scope</label>
                  <select id="hold_scope" name="hold_scope" defaultValue="full_balance">
                    <option value="full_balance">Entire balance</option>
                    <option value="disputed_amount">Disputed amount only</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="field" htmlFor="trigger_source">Trigger</label>
                <input id="trigger_source" name="trigger_source" type="text" defaultValue="NCRP/I4C cyber-fraud portal complaint" />
              </div>
              <div className="grid g-2" style={{ gap: 11 }}>
                <div>
                  <label className="field" htmlFor="ncrp_complaint">NCRP complaint no.</label>
                  <input id="ncrp_complaint" name="ncrp_complaint" type="text" placeholder="NCRP/2026/HR/884213" />
                </div>
                <div>
                  <label className="field" htmlFor="fir_no">FIR no.</label>
                  <input id="fir_no" name="fir_no" type="text" placeholder="FIR 417/2026" />
                </div>
              </div>
              <div>
                <label className="field" htmlFor="police_station">Police station / Cyber Cell</label>
                <input id="police_station" name="police_station" type="text" placeholder="Cyber Cell, Gurugram City" />
              </div>
              <div>
                <label className="field" htmlFor="notes">Notes</label>
                <textarea id="notes" name="notes" rows={3} placeholder="What the bank told you, what is blocked, what is still running." />
              </div>
              <input type="hidden" name="account_no" value={merchant.collection_account} />
              <input type="hidden" name="bank" value={merchant.collection_bank} />
              <input type="hidden" name="branch" value={merchant.collection_branch} />
              <button type="submit" className="block">Open case and build the ladder</button>
              <p className="tiny muted">
                Opening a case generates the six-step escalation ladder with deadlines measured from the freeze date.
              </p>
            </form>
          </div>

          <div className="notice warn">
            Not legal advice. Timelines shown are product defaults derived from published grievance-redressal practice
            and court observations - confirm the current circular and portal process before relying on them.
          </div>
        </div>
      </div>
    </div>
  );
}
