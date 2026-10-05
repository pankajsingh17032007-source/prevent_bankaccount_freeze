/**
 * Escalation ladder for a frozen merchant account.
 *
 * Timelines are derived from the general shape of RBI grievance-redressal
 * directions, NCRP/I4C practice and court observations that a lien should be
 * limited to the traceable amount. They are product defaults, NOT legal advice,
 * and must be re-verified against the current circular before anyone relies on
 * them - RBI timelines and portal processes change.
 */

import { localStamp } from "./format";

const DAY = 86400_000;

export interface StageSpec {
  step_no: number;
  name: string;
  authority: string;
  sla_days: number;
  template_key: string;
  why: string;
}

export const LADDER: StageSpec[] = [
  {
    step_no: 1,
    name: "Lock down evidence and quantify the traceable amount",
    authority: "Internal - merchant, CA and compliance owner",
    sla_days: 2,
    template_key: "internal_memo",
    why: "Before anything is filed, freeze the record: statement with the lien entry, UPI/RRN trail, invoices, PODs and GST returns. Compute what is actually traceable so you can argue for partial release.",
  },
  {
    step_no: 2,
    name: "Partial-release representation to the Bank Nodal Officer",
    authority: "Bank Nodal Officer (grievance channel designated with the regulator)",
    sla_days: 7,
    template_key: "nodal_officer",
    why: "The fastest lever. Ask explicitly for release of the balance beyond the disputed, traceable amount - courts have repeatedly said a lien should not be a blanket freeze.",
  },
  {
    step_no: 3,
    name: "Statement of facts to the investigating Cyber Cell / police station",
    authority: "Investigating officer, Cyber Cell / Police Station",
    sla_days: 10,
    template_key: "cyber_cell",
    why: "Only the investigator (or a court) can direct a bank to de-freeze. Put the merchant's legitimate-sale trail in front of them so the account is not treated as a mule account.",
  },
  {
    step_no: 4,
    name: "Escalation to the Bank Grievance Officer",
    authority: "Bank Grievance Officer / escalation matrix",
    sla_days: 15,
    template_key: "grievance_officer",
    why: "If the nodal officer is silent, escalate in writing with the original reference number. Silence past the stated timeline is itself grounds for the next step.",
  },
  {
    step_no: 5,
    name: "Complaint to the Banking Ombudsman",
    authority: "Reserve Bank of India - Ombudsman / CRPC integrated dispute resolution",
    sla_days: 30,
    template_key: "ombudsman",
    why: "Available once the bank has failed to redress within the prescribed period. Keep the pack pre-formatted: the complaint is decided on documents.",
  },
  {
    step_no: 6,
    name: "Writ petition under Article 226 - via advocate",
    authority: "High Court",
    sla_days: 45,
    template_key: "writ",
    why: "The endgame for a disproportionate freeze. This stage is drafting work for a qualified advocate; the platform only prepares the brief and the chronology.",
  },
];

export interface BuiltStage {
  step_no: number;
  name: string;
  authority: string;
  sla_days: number;
  due_at: string;
  status:
    | "not_started"
    | "in_progress"
    | "awaiting_response"
    | "escalated"
    | "done"
    | "skipped";
  template_key: string;
  actioned_at: string | null;
  log: string;
}

const DAY_MS = DAY;

export function buildStages(freezeTs: number, caseStatus: string): BuiltStage[] {
  const now = Date.now();
  const elapsed = Math.max(0, Math.floor((now - freezeTs) / DAY_MS));
  const out: BuiltStage[] = [];
  let cursor = 0;

  for (const spec of LADDER) {
    const startDay = cursor;
    const endDay = cursor + spec.sla_days;
    cursor = endDay;

    const due = localStamp(new Date(freezeTs + endDay * DAY_MS));
    let status: BuiltStage["status"] = "not_started";
    let actioned: string | null = null;
    let log = "";

    if (elapsed >= endDay) {
      status = "done";
      actioned = localStamp(new Date(freezeTs + Math.min(endDay, elapsed) * DAY_MS));
      log = `Closed at day ${Math.min(endDay, elapsed)}.`;
    } else if (elapsed >= startDay) {
      status = endDay - elapsed <= 2 ? "escalated" : "in_progress";
      log = `Day ${elapsed} of ${spec.sla_days}-day window (day ${endDay} deadline).`;
    } else {
      log = `Opens on day ${startDay} of the ladder.`;
    }

    out.push({
      step_no: spec.step_no,
      name: spec.name,
      authority: spec.authority,
      sla_days: spec.sla_days,
      due_at: due,
      status,
      template_key: spec.template_key,
      actioned_at: actioned,
      log,
    });
  }

  applyStatusOverride(out, caseStatus, freezeTs);
  return out;
}

/**
 * Case-level truth wins over the pure elapsed-time model: a case that already
 * settled, or one that skipped the police stage (no FIR), should read that way.
 */
function applyStatusOverride(stages: BuiltStage[], caseStatus: string, freezeTs: number): void {
  const set = (step: number, status: BuiltStage["status"], note: string) => {
    const s = stages.find((x) => x.step_no === step);
    if (!s) return;
    s.status = status;
    if (status === "done" && !s.actioned_at) {
      s.actioned_at = localStamp(new Date(Math.min(Date.now(), freezeTs + 2 * DAY_MS)));
    }
    if (note) s.log = note;
  };

  switch (caseStatus) {
    case "awaiting_bank":
      set(1, "done", "Evidence pack compiled and traceable amount computed.");
      set(2, "awaiting_response", "Representation mailed to the nodal officer; awaiting reply.");
      set(3, "not_started", "Queued if the bank does not release the balance.");
      set(4, "not_started", "");
      set(5, "not_started", "");
      set(6, "not_started", "");
      break;
    case "awaiting_police":
      set(1, "done", "");
      set(2, "done", "Bank replied - lien upheld pending investigation.");
      set(3, "awaiting_response", "Statement of facts served on the investigating officer.");
      set(4, "not_started", "");
      set(5, "not_started", "");
      set(6, "not_started", "");
      break;
    case "ombudsman":
      set(1, "done", "");
      set(2, "done", "No redress within the stated timeline.");
      set(3, "done", "");
      set(4, "escalated", "Escalation window lapsed without remedy.");
      set(5, "in_progress", "Complaint filed with the Ombudsman; documents served.");
      set(6, "not_started", "");
      break;
    case "legal":
      set(1, "done", "");
      set(2, "done", "");
      set(3, "done", "");
      set(4, "done", "");
      set(5, "done", "Ombudsman did not provide relief / out of jurisdiction.");
      set(6, "in_progress", "Brief and chronology handed to the advocate.");
      break;
    case "partial_release":
      set(1, "done", "");
      set(2, "done", "Bank accepted partial release of the undisputed balance.");
      set(3, "skipped", "No FIR in this matter - bank-initiated hold only.");
      set(4, "done", "");
      set(5, "not_started", "Only needed if the balance stays blocked.");
      set(6, "not_started", "");
      break;
    case "released":
    case "closed":
      for (const s of stages) {
        s.status = s.step_no === 6 ? "skipped" : "done";
        if (!s.actioned_at) s.actioned_at = localStamp(new Date(freezeTs + 3 * DAY_MS));
        s.log = "Case resolved.";
      }
      break;
  }
}

export function statusLabel(status: string): string {
  return {
    not_started: "Not started",
    in_progress: "In progress",
    awaiting_response: "Awaiting response",
    escalated: "Due / escalate",
    done: "Done",
    skipped: "Skipped",
    open: "Open",
    awaiting_bank: "Awaiting bank",
    awaiting_police: "Awaiting police",
    ombudsman: "With Ombudsman",
    legal: "In court",
    released: "Released",
    partial_release: "Partial release",
    closed: "Closed",
    full_balance: "Full balance held",
    disputed_amount: "Disputed amount only",
  }[status] ?? status;
}
