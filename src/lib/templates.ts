import type { FreezeCase } from "./types";

/**
 * Letter templates for the escalation ladder.
 *
 * These are drafting aids, not legal advice. Anything sent to a court, an
 * investigator or a regulator should be reviewed by a qualified advocate or a
 * practising professional before it goes out.
 */

export interface LetterContext {
  merchant: {
    legal_name: string; gstin: string; pan: string; nature: string;
    collection_bank: string; collection_account: string; collection_branch: string;
    operating_bank: string; operating_account: string;
    backup_bank: string; backup_account: string;
    nodal_officer: string; nodal_email: string;
  };
  c: FreezeCase;
  traceable: number;
  excess: number;
  generatedOn: string;
}

export interface Letter {
  key: string;
  title: string;
  to: string;
  subject: string;
  body: string;
  caution: string;
}

const inr = (n: number) =>
  "Rs." + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

const accountLine = (c: FreezeCase) =>
  `A/c ${c.account_no}, ${c.bank}${c.branch ? ", " + c.branch : ""}`;

export function getLetter(key: string, ctx: LetterContext): Letter {
  const { merchant, c, generatedOn } = ctx;
  const common = {
    ref: `Ref: ${c.case_ref} / dated ${generatedOn}`,
    party: `${merchant.legal_name}\nGSTIN ${merchant.gstin} | PAN ${merchant.pan}\n${merchant.nature}`,
  };

  const letters: Record<string, Letter> = {
    internal_memo: {
      key,
      title: "Internal action memo",
      to: "Internal - founder, finance and compliance owner",
      subject: `Action memo: freeze on ${accountLine(c)}`,
      body: `${common.party}

${common.ref}

1. ACCOUNT HELD
   ${accountLine(c)}
   Hold placed on ${c.freeze_date} for ${inr(c.hold_amount)} (${c.hold_scope === "full_balance" ? "entire balance" : "disputed amount only"}).
   Disputed / traceable amount: ${inr(c.disputed_amount)}.
   Amount beyond the dispute: ${inr(ctx.excess)} - this is what we are asking to be released.

2. TRIGGER
   ${c.trigger_source}${c.ncrp_complaint ? `\n   NCRP complaint: ${c.ncrp_complaint}` : ""}${c.fir_no ? `\n   ${c.fir_no}, ${c.police_station}` : ""}

3. EVIDENCE TO LOCK TODAY (do not let these age out)
   - Bank statement carrying the lien / hold endorsement.
   - UPI/IMPS/NEFT reference numbers for every inbound credit in the disputed window.
   - Invoices, order confirmations and proof of delivery matching those credits.
   - GSTR-1 and GSTR-3B for the period, showing turnover consistent with the credits.
   - Certificate of incorporation, GSTIN, PAN and the account KYC set.
   - Internal reconciliation sheet: credit -> order -> invoice -> AWB -> POD.

4. OPERATING CONTINUITY
   - Sweep to the ${merchant.operating_bank} operating account is stopped; move payroll
     disbursement to the ${merchant.backup_bank} backup account for this cycle.
   - Check available standby credit lines in the Bridge tab before any vendor payment runs short.

5. NEXT RUNG
   Lodge the partial-release representation with the ${merchant.nodal_officer}
   within 2 working days; day-count starts from ${c.freeze_date}.

Caution: this memo organises facts. It is not legal advice.`,
      caution: "Internal use only. Nothing here is legal advice.",
    },

    nodal_officer: {
      key,
      title: "Representation for partial release - Bank Nodal Officer",
      to: merchant.nodal_officer,
      subject: `Request for partial release of lien beyond the disputed amount - A/c ${c.account_no} - ${c.case_ref}`,
      body: `To: ${merchant.nodal_officer}
Email: ${merchant.nodal_email}

${common.party}

${common.ref}

Dear Sir / Madam,

1. An amount of ${inr(c.hold_amount)} stands held in the above account with effect from
   ${c.freeze_date}. Our understanding is that the hold follows ${c.trigger_source.toLowerCase()}.

2. The amount actually in dispute is ${inr(c.disputed_amount)}. It is our case that the
   balance of ${inr(ctx.excess)} represents genuine, invoiced sales of this company and is
   neither traceable to, nor the proceeds of, the complained transaction.

3. In support we enclose:
   a. Statement of account carrying the hold endorsement and the complete credit trail.
   b. Reconciliation mapping each disputed credit to an order, invoice and proof of delivery.
   c. GSTR-1 / GSTR-3B returns for the period, consistent with the credited turnover.
   d. Certificate of incorporation, GSTIN, PAN and KYC records of the account.

4. We therefore request that the bank:
   a. restrict the hold to the disputed and traceable sum of ${inr(c.disputed_amount)};
   b. release the balance of ${inr(ctx.excess)} forthwith, or within the timeline prescribed
      by the bank's grievance-redressal policy; and
   c. confirm in writing the precise scope, reason code and lift conditions of the hold,
      together with the reference number of this complaint.

5. If any further particulars are required, we are available on working days between
   10:00 and 18:00 IST.

Enclosures as listed in the evidence pack.

Yours faithfully,
For ${merchant.legal_name}
Authorised signatory

--
Generated from the freeze case file. Facts are assembled automatically; the legal
submissions must be reviewed by a qualified professional before filing.`,
      caution: "Verify current bank policy and regulator timelines before sending.",
    },

    cyber_cell: {
      key,
      title: "Statement of facts - Investigating officer",
      to: c.police_station || "Investigating officer / Cyber Cell",
      subject: `Statement of facts regarding account of ${merchant.legal_name} - ${c.fir_no || c.ncrp_complaint || c.case_ref}`,
      body: `To
The Investigating Officer
${c.police_station || "Cyber Cell"}
${c.fir_no ? `FIR: ${c.fir_no}` : ""}
${c.ncrp_complaint ? `NCRP complaint: ${c.ncrp_complaint}` : ""}

${common.party}

${common.ref}

Respected Sir / Madam,

1. We are a registered goods-and-services seller. The subject account has been in
   continuous use for trade settlements with ${merchant.collection_bank},
   ${accountLine(c)}.

2. A hold of ${inr(c.hold_amount)} was placed on ${c.freeze_date}. The sum attributable to
   the complained transaction is ${inr(c.disputed_amount)}; the remainder, ${inr(ctx.excess)},
   arises from unrelated, invoiced sales.

3. Our position, with documents:
   a. Every credit in the disputed window is mapped to an order, invoice and delivery proof.
   b. GSTR-1 / GSTR-3B filings match the credited turnover for the period.
   c. The payers in the disputed cluster are not our suppliers, directors or beneficial owners.
   d. We have no common bank account, mobile number or device with any suspect account.

4. We are not opposing a hold to the extent of the traceable amount. We request that our
   legitimate trade turnover be distinguished from the disputed sum so that routine
   business - payroll and vendor payments in particular - is not held up.

5. We are willing to appear with the complete record and provide any clarification required.

Enclosures: evidence pack index, statement of account, reconciliation sheet, invoices,
proofs of delivery, GST returns, incorporation and KYC documents.

Yours faithfully
For ${merchant.legal_name}
Authorised signatory

--
Facts and enclosures are compiled from our records. The legal characterisation of this
matter must be settled by an advocate; this document is not legal advice.`,
      caution: "Do not characterise the matter legally. Present facts and enclosures only.",
    },

    grievance_officer: {
      key,
      title: "Escalation - Bank Grievance Officer",
      to: `Grievance Officer, ${merchant.collection_bank}`,
      subject: `Escalation on unresolved complaint - partial release of hold - A/c ${c.account_no} - ${c.case_ref}`,
      body: `To
The Grievance Officer
${merchant.collection_bank}
${merchant.collection_branch}

${common.party}

${common.ref}

Dear Sir / Madam,

1. Our representation of ${c.freeze_date} to the nodal officer sought restriction of the
   hold to the disputed sum of ${inr(c.disputed_amount)} and release of ${inr(ctx.excess)}.
   The matter remains unresolved.

2. The hold of ${inr(c.hold_amount)} is disproportionate to the dispute and has stopped the
   sweep that funds payroll and vendor payments for this business.

3. We ask the bank to:
   a. release ${inr(ctx.excess)} being the undisputed balance;
   b. record and communicate a reason code for the hold and the conditions on which it
      will be lifted; and
   c. confirm the timeline for the same, in writing, with a complaint reference.

4. If this escalation is not redressed within the period prescribed by the bank's
   grievance-redressal policy, we will be constrained to approach the appropriate
   Ombudsman with the same record.

Enclosures: original representation with acknowledgement, evidence pack index.

Yours faithfully
For ${merchant.legal_name}

--
Drafted from case records. Review before sending; not legal advice.`,
      caution: "Attach the acknowledgement of the original nodal-officer complaint.",
    },

    ombudsman: {
      key,
      title: "Complaint to the Banking Ombudsman",
      to: "Reserve Bank of India - Ombudsman / integrated dispute resolution mechanism",
      subject: `Complaint against ${merchant.collection_bank} - failure to release undisputed balance - ${c.case_ref}`,
      body: `To
The Banking Ombudsman
Reserve Bank of India

Complainant: ${merchant.legal_name}, GSTIN ${merchant.gstin}
Account: ${accountLine(c)}
Complainant reference: ${c.case_ref}

1. Ground of complaint
   A hold of ${inr(c.hold_amount)} was placed on ${c.freeze_date} although the amount in
   dispute is ${inr(c.disputed_amount)}. The bank has not released the undisputed balance of
   ${inr(ctx.excess)} despite a written representation.

2. Chronology
   ${c.freeze_date} - hold placed on the account.
   ${c.freeze_date} - evidence pack compiled; internal action memo issued.
   Within 2 days - representation to the nodal officer seeking partial release.
   Subsequently - escalation to the grievance officer; no redress within the period
   prescribed by the bank's grievance-redressal policy.

3. Relief sought
   a. Release of ${inr(ctx.excess)}, being the undisputed portion of the balance.
   b. Written communication of the scope, reason and lift conditions of the hold.
   c. Compensation for the disruption caused to payroll and vendor payments, to the extent
      the mechanism permits.

4. Declaration
   The complainant is not contesting a hold to the extent of the traceable sum of
   ${inr(c.disputed_amount)}. The complaint is confined to the balance.

Enclosures: statement of account, representation with acknowledgement, escalation with
acknowledgement, reconciliation sheet, GST returns, incorporation and KYC documents.

${merchant.legal_name}
Authorised signatory

--
Jurisdiction and limitation periods must be checked against the current scheme before
filing. This is a drafting aid, not legal advice.`,
      caution: "Check eligibility: the bank must have failed to redress within the prescribed period.",
    },

    writ: {
      key,
      title: "Instruction brief for counsel - writ under Article 226",
      to: "Advocate on record",
      subject: `Brief for instructions - challenge to disproportionate hold - ${c.case_ref}`,
      body: `BRIEF FOR COUNSEL
Matter: ${c.case_ref} - ${c.title}
Account: ${accountLine(c)}
${c.fir_no ? `FIR: ${c.fir_no}, ${c.police_station}` : ""}
${c.ncrp_complaint ? `NCRP complaint: ${c.ncrp_complaint}` : ""}

1. Relief contemplated
   a. Declaration that a hold of ${inr(c.hold_amount)} on the entire balance is
      disproportionate where the disputed and traceable sum is ${inr(c.disputed_amount)}.
   b. Direction to restrict the lien to the traceable amount and to release
      ${inr(ctx.excess)}.
   c. Direction to communicate the scope, reason code and lift conditions of the hold.
   d. Any consequential or interim relief deemed appropriate.

2. Facts on record
   - Merchant: ${merchant.legal_name}, GSTIN ${merchant.gstin}, PAN ${merchant.pan}.
   - Hold placed ${c.freeze_date}; trigger: ${c.trigger_source}.
   - The account carries genuine trade receipts mapped to invoices, deliveries and GST filings.

3. Steps already taken (with acknowledgements)
   - Evidence pack compiled and traceable amount computed.
   - Representation to the nodal officer.
   - Escalation to the grievance officer.
   - Ombudsman complaint, where applicable.

4. Documents attached
   Evidence pack index with pagination, statement of account, reconciliation sheet,
   invoices, proofs of delivery, GST returns, incorporation and KYC set.

5. Instructions sought
   - Whether interim relief is advisable and on which grounds.
   - Whether the investigating officer's position needs to be impleaded.
   - Estimated timeline and cost.

--
Prepared as a factual brief for a qualified advocate. This is not legal advice and no
petition should be filed without counsel's review.`,
      caution: "Counsel must settle grounds, forum and interim relief. Not legal advice.",
    },
  };

  return letters[key] ?? letters.internal_memo;
}

export function lettersFor(c: FreezeCase, merchant: LetterContext["merchant"], traceable: number, excess: number, generatedOn: string): Letter[] {
  const ctx: LetterContext = { merchant, c, traceable, excess, generatedOn };
  const keys =
    c.status === "partial_release" || c.status === "released" || c.status === "closed"
      ? ["internal_memo", "nodal_officer", "cyber_cell", "grievance_officer"]
      : ["internal_memo", "nodal_officer", "cyber_cell", "grievance_officer", "ombudsman", "writ"];
  return keys.map((k) => getLetter(k, ctx));
}
