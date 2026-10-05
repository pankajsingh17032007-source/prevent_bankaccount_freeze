import Link from "next/link";
import { notFound } from "next/navigation";

import { getCase, getMerchant, listDocuments, listStages } from "@/lib/db";
import { buildEvidencePack } from "@/lib/evidence";
import { lettersFor } from "@/lib/templates";
import { statusLabel } from "@/lib/cases";
import { setCaseStatus, toggleDocument, updateStageFromForm } from "@/app/actions";
import SelectAction from "@/app/components/SelectAction";
import { fmtDate, fmtStamp, inr } from "@/lib/format";

export const dynamic = "force-dynamic";

const CASE_STATUSES = [
  "open", "awaiting_bank", "awaiting_police", "ombudsman", "legal",
  "released", "partial_release", "closed",
];

const STAGE_STATUSES = ["not_started", "in_progress", "awaiting_response", "escalated", "done", "skipped"];

const DOC_GROUPS: Array<[string, string]> = [
  ["identity", "Identity & registration"],
  ["bank", "Bank records"],
  ["txn", "Payment trail"],
  ["order", "Orders & invoices"],
  ["shipping", "Shipping / delivery proof"],
  ["gst", "Tax filings"],
  ["affidavit", "Statements & affidavits"],
];

export default async function CaseDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = getCase(Number(id));
  if (!c) notFound();

  const merchant = getMerchant();
  const stages = listStages(c.id);
  const docs = listDocuments(c.id);
  const pack = buildEvidencePack(c);
  const letters = lettersFor(c, merchant, pack.traceable, pack.excess, pack.generatedOn);
  const active = stages.find((s) => s.status !== "done" && s.status !== "skipped") ?? stages[stages.length - 1];
  const heldPct = Math.min(100, (c.disputed_amount / Math.max(1, c.hold_amount)) * 100);
  const docsReady = docs.filter((d) => d.present).length;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <div className="row" style={{ marginBottom: 6 }}>
            <span className="badge brand">{c.case_ref}</span>
            <span className="badge plain">{statusLabel(c.hold_scope)}</span>
            <span className="badge plain">freeze {fmtDate(c.freeze_date)}</span>
          </div>
          <h1>{c.title}</h1>
          <p className="sub">
            {c.bank} · a/c {c.account_no}
            {c.branch ? ` · ${c.branch}` : ""}
            {c.fir_no ? ` · ${c.fir_no} (${c.police_station})` : ""}
            {c.ncrp_complaint ? ` · ${c.ncrp_complaint}` : ""}
          </p>
        </div>
        <div className="row no-print">
          <SelectAction
            label="Case status"
            action={setCaseStatus.bind(null, c.id)}
            defaultValue={c.status}
            options={CASE_STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))}
          />
          <a className="btn ghost" href={`/api/pack/${c.id}`} target="_blank">Evidence pack (.md)</a>
          <a className="btn" href={`/api/pack/${c.id}?format=html`} target="_blank">Print-ready pack</a>
        </div>
      </div>

      <div className="grid g-4">
        <div className="stat">
          <div className="k">Balance held</div>
          <div className="v">{inr(c.hold_amount)}</div>
          <div className="d">{statusLabel(c.hold_scope)}</div>
        </div>
        <div className="stat">
          <div className="k">Traceable / disputed</div>
          <div className="v">{inr(c.disputed_amount)}</div>
          <div className="d">{Math.round(heldPct)}% of the held amount</div>
        </div>
        <div className="stat">
          <div className="k">Claimable release</div>
          <div className="v">{inr(pack.excess)}</div>
          <div className="d">not traceable to the complaint</div>
        </div>
        <div className="stat">
          <div className="k">Evidence ready</div>
          <div className="v">{docsReady}/{docs.length}</div>
          <div className="d">{docs.length - docsReady} still to attach</div>
        </div>
      </div>

      <div className="grid g-12">
        <div className="card">
          <div className="card-head"><h2>Partial-release calculation</h2></div>
          <div className="bar-list">
            <div className="bar-row">
              <div className="bar-top"><span>Traceable to the complaint</span><span className="mono">{inr(c.disputed_amount)}</span></div>
              <div className="bar"><i style={{ width: `${heldPct}%`, background: "#c2410c" }} /></div>
            </div>
            <div className="bar-row">
              <div className="bar-top"><span>Unrelated balance to release</span><span className="mono">{inr(pack.excess)}</span></div>
              <div className="bar"><i style={{ width: `${100 - heldPct}%`, background: "#16803c" }} /></div>
            </div>
          </div>
          <p className="tiny muted" style={{ marginTop: 12 }}>
            Courts and regulator guidance have generally moved towards restricting a hold to the disputed or traceable
            amount rather than the whole balance. Verify the current position with counsel before citing it.
          </p>
          <div className="notice" style={{ marginTop: 10 }}>
            Posture taken in this case: do not contest a hold up to <b>{inr(c.disputed_amount)}</b>; ask for release of{" "}
            <b>{inr(pack.excess)}</b>.
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>Trigger</h2></div>
          <dl className="kv">
            <dt>Source</dt><dd>{c.trigger_source}</dd>
            {c.ncrp_complaint && (<><dt>NCRP complaint</dt><dd className="mono">{c.ncrp_complaint}</dd></>)}
            {c.fir_no && (<><dt>FIR</dt><dd className="mono">{c.fir_no}</dd></>)}
            {c.police_station && (<><dt>Investigating agency</dt><dd>{c.police_station}</dd></>)}
            <dt>Opened</dt><dd>{fmtDate(c.created_at)}</dd>
            <dt>Bank nodal officer</dt><dd>{merchant.nodal_officer}</dd>
          </dl>
          {c.notes && <p className="small" style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>{c.notes}</p>}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Escalation ladder</h2>
            <p className="sub small">Deadlines run from the freeze date. Move each step as you go - the next action stays pinned to the top.</p>
          </div>
          <span className="badge plain">{stages.filter((s) => s.status === "done").length} of {stages.length} done</span>
        </div>

        <div className="ladder">
          {stages.map((s) => (
            <div className={`step ${s.status}`} key={s.id}>
              <div className="step-rail">
                <div className="step-no">{s.status === "done" ? "✓" : s.step_no}</div>
                <div className="step-line" />
              </div>
              <div className="step-body">
                <div className="step-top">
                  <div className="grow">
                    <div className="row" style={{ marginBottom: 3 }}>
                      <b>{s.name}</b>
                      <span className={`badge ${s.status === "escalated" ? "critical" : s.status === "done" ? "ok" : "plain"}`}>
                        {statusLabel(s.status)}
                      </span>
                      {s.id === active.id && <span className="badge brand">you are here</span>}
                    </div>
                    <div className="tiny muted">{s.authority}</div>
                    <div className="small" style={{ marginTop: 6 }}>{s.log}</div>
                    <div className="tiny muted" style={{ marginTop: 5 }}>
                      SLA {s.sla_days} days · due {fmtDate(s.due_at)}
                      {s.actioned_at ? ` · actioned ${fmtStamp(s.actioned_at)}` : ""}
                    </div>
                  </div>
                  <div className="row no-print" style={{ justifyContent: "flex-end" }}>
                    <form action={updateStageFromForm}>
                      <input type="hidden" name="caseId" value={c.id} />
                      <input type="hidden" name="stageId" value={s.id} />
                      <div className="split">
                        <select name="status" defaultValue={s.status} style={{ width: "auto", padding: "6px 8px", fontSize: 12.5 }}>
                          {STAGE_STATUSES.map((st) => (
                            <option key={st} value={st}>{statusLabel(st)}</option>
                          ))}
                        </select>
                        <button className="sm ghost" type="submit">Update</button>
                      </div>
                    </form>
                    <a className="btn ghost sm" href={`/api/letter/${c.id}/${s.template_key}`} target="_blank">Draft letter</a>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid g-2">
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Evidence pack</h2>
              <p className="sub small">Auto-compiled from statements, orders and filings. Toggle items as you attach them.</p>
            </div>
            <span className="badge plain">{docsReady}/{docs.length}</span>
          </div>

          {DOC_GROUPS.map(([type, label]) => {
            const group = docs.filter((d) => d.doc_type === type);
            if (!group.length) return null;
            return (
              <div key={type}>
                <div className="nav-label" style={{ color: "var(--muted)", padding: "12px 0 4px" }}>{label}</div>
                {group.map((d) => (
                  <div className="doc-row" key={d.id}>
                    <div className="grow">
                      <div className="small"><b>{d.title}</b></div>
                      <div className="tiny muted">{d.ref}{d.note ? ` · ${d.note}` : ""}</div>
                    </div>
                    <div className="row no-print" style={{ justifyContent: "flex-end" }}>
                      <span className={`badge ${d.present ? "ok" : "critical"}`}>{d.present ? "Ready" : "Pending"}</span>
                      <form action={toggleDocument.bind(null, c.id, d.id)}>
                        <button className="sm ghost" type="submit">{d.present ? "Remove" : "Attach"}</button>
                      </form>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <h2>Evidence pack contents</h2>
              <p className="sub small">What the advocate, the nodal officer and the investigating officer receive.</p>
            </div>
          </div>
          <div className="stack" style={{ gap: 9 }}>
            {pack.sections.map((s) => (
              <div className="row" key={s.title} style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <div className="grow small">{s.title}</div>
                <span className="tiny muted">
                  {s.kind === "table" ? `${s.rows?.length ?? 0} rows` : s.kind === "list" ? `${s.items?.length ?? 0} points` : "text"}
                </span>
              </div>
            ))}
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <a className="btn ghost sm" href={`/api/pack/${c.id}`} target="_blank">Download .md</a>
            <a className="btn ghost sm" href={`/api/pack/${c.id}?format=html`} target="_blank">Print-ready HTML</a>
            <Link className="btn ghost sm" href="/cases">All cases</Link>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Draft letters</h2>
            <p className="sub small">
              Templates filled with this case&apos;s facts. Factual drafting only - a qualified advocate must settle
              anything that goes to a court, investigator or regulator.
            </p>
          </div>
        </div>
        <div className="stack">
          {letters.map((l) => (
            <details key={l.key} open={l.key === active.template_key}>
              <summary style={{ cursor: "pointer", padding: "9px 0", fontWeight: 600, fontSize: 13.5 }}>
                {l.title} <span className="muted small">→ {l.to}</span>
              </summary>
              <div className="letter" style={{ marginTop: 6 }}>
                <div className="tiny muted">Subject: {l.subject}</div>
                <pre>{l.body}</pre>
                <div className="caution">{l.caution}</div>
                <div className="row no-print" style={{ marginTop: 12 }}>
                  <a className="btn ghost sm" href={`/api/letter/${c.id}/${l.key}`} target="_blank">Open plain text</a>
                </div>
              </div>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}
