import { db, getMerchant, listDocuments, listStages } from "./db";
import { statusLabel } from "./cases";
import { localDate, localStamp } from "./format";
import { explain } from "./risk";
import type { FreezeCase, Transaction } from "./types";

export interface PackSection {
  title: string;
  kind: "table" | "text" | "list";
  columns?: string[];
  rows?: string[][];
  text?: string;
  items?: string[];
}

export interface EvidencePack {
  case: FreezeCase;
  generatedOn: string;
  held: number;
  traceable: number;
  excess: number;
  sections: PackSection[];
}

const inr = (n: number) => "Rs." + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
const dayMs = 86400_000;

export async function buildEvidencePack(c: FreezeCase): Promise<EvidencePack> {
  const merchant = await getMerchant();
  const database = await db();
  const generatedOn = localDate();
  const held = c.hold_amount;
  const traceable = c.disputed_amount;
  const excess = Math.max(0, held - traceable);

  const freezeTs = new Date(c.freeze_date).getTime();
  const windowStart = localStamp(new Date(freezeTs - 30 * dayMs));
  const trailResult = await database.execute(
      `SELECT * FROM transactions
       WHERE credit > 0 AND posted_at >= ? AND posted_at <= datetime(?, '+1 day')
       ORDER BY credit DESC`,
      [windowStart, c.freeze_date],
    );
  const trail = trailResult.rows as unknown as Transaction[];

  const risky = trail.filter((t) => t.risk_band === "HIGH" || t.risk_band === "CRITICAL" || t.reconciled === 0);
  const clean = trail.filter((t) => t.risk_band === "LOW" && t.reconciled === 1);

  const ordersResult = await database.execute(
      `SELECT order_no, buyer, amount, placed_at, invoice_no, ship_status, awb
       FROM orders WHERE placed_at >= ? ORDER BY placed_at DESC LIMIT 60`,
      [windowStart],
    );
  const orders = ordersResult.rows as unknown as Array<{
    order_no: string; buyer: string; amount: number; placed_at: string;
    invoice_no: string | null; ship_status: string; awb: string | null;
  }>;

  const matchedSum = clean.reduce((s, t) => s + t.credit, 0);
  const riskSum = risky.reduce((s, t) => s + t.credit, 0);
  const [docs, stages] = await Promise.all([listDocuments(c.id), listStages(c.id)]);

  const sections: PackSection[] = [
    {
      title: "1. Cover summary",
      kind: "text",
      text: [
        `Merchant: ${merchant.legal_name} (GSTIN ${merchant.gstin}, PAN ${merchant.pan})`,
        `Account: ${c.account_no}, ${c.bank}${c.branch ? ", " + c.branch : ""}`,
        `Hold placed: ${c.freeze_date} | Scope: ${statusLabel(c.hold_scope)} | Amount held: ${inr(held)}`,
        `Disputed / traceable amount: ${inr(traceable)} | Balance beyond dispute: ${inr(excess)}`,
        `Trigger: ${c.trigger_source}`,
        c.ncrp_complaint ? `NCRP complaint: ${c.ncrp_complaint}` : "",
        c.fir_no ? `${c.fir_no} - ${c.police_station}` : "",
        "",
        `Purpose of this pack: to show that ${inr(excess)} of the held balance is unrelated to the`,
        `disputed transaction and should be released, while not contesting a hold up to ${inr(traceable)}.`,
      ]
        .filter(Boolean)
        .join("\n"),
    },
    {
      title: "2. Risk-flagged credits in the 30 days before the hold",
      kind: "table",
      columns: ["Posted", "Payer", "Credit", "Band", "Score", "Why it was flagged"],
      rows: risky.slice(0, 25).map((t) => [
        t.posted_at,
        t.payer,
        inr(t.credit),
        t.risk_band,
        String(t.risk_score),
        explain(t.risk_reasons)
          .map((r) => r.label)
          .join("; ") || "Reconciled to an order",
      ]),
    },
    {
      title: "3. Reconciled, invoiced sales (the undisputed balance)",
      kind: "table",
      columns: ["Posted", "Payer", "Credit", "Evidence"],
      rows: clean.slice(0, 25).map((t) => [t.posted_at, t.payer, inr(t.credit), t.order_id ? `Order/Invoice linked (#${t.order_id})` : "Settlement record"]),
    },
    {
      title: "4. Payment-trail totals",
      kind: "table",
      columns: ["Bucket", "Credits", "Count"],
      rows: [
        ["Reconciled to order / invoice", inr(matchedSum), String(clean.length)],
        ["Unreconciled or risk-flagged", inr(riskSum), String(risky.length)],
        ["Total inbound in window", inr(matchedSum + riskSum), String(trail.length)],
      ],
    },
    {
      title: "5. Orders, invoices and shipping proof",
      kind: "table",
      columns: ["Order", "Buyer", "Amount", "Placed", "Invoice", "Shipping", "AWB"],
      rows: orders.slice(0, 25).map((o) => [
        o.order_no, o.buyer, inr(o.amount), o.placed_at, o.invoice_no ?? "-",
        o.ship_status, o.awb ?? "-",
      ]),
    },
    {
      title: "6. Identity, tax and bank documents",
      kind: "table",
      columns: ["Document", "Reference", "Status", "Note"],
      rows: docs.map((d) => [d.title, d.ref || "-", d.present ? "Ready" : "PENDING", d.note]),
    },
    {
      title: "7. Partial-release computation",
      kind: "table",
      columns: ["Item", "Amount", "Basis"],
      rows: [
        ["Total balance held", inr(held), c.hold_scope === "full_balance" ? "Entire account balance frozen" : "Lien limited to disputed sum"],
        ["Disputed / traceable amount", inr(traceable), "Attributable to the complained transaction"],
        ["Amount claimable for release", inr(excess), "Held balance minus the traceable amount"],
        ["Disputed credits in window", inr(riskSum), "Unreconciled or risk-flagged inbound"],
        ["Invoiced sales in window", inr(matchedSum), "Matched to order, invoice and delivery"],
      ],
    },
    {
      title: "8. Escalation chronology",
      kind: "table",
      columns: ["#", "Step", "Authority", "SLA (days)", "Due", "Status"],
      rows: stages.map((s) => [String(s.step_no), s.name, s.authority, String(s.sla_days), s.due_at, statusLabel(s.status)]),
    },
    {
      title: "9. Declaration",
      kind: "list",
      items: [
        "The account is used for bona fide trade receipts of the named entity.",
        "Each reconciled credit maps to an order, invoice and delivery record.",
        "Turnover reported in GST returns is consistent with the credited amounts.",
        "The complainant does not contest a hold up to the traceable amount.",
        `Release of ${inr(excess)} is sought as it is unrelated to the disputed transaction.`,
        "No director, employee or supplier of this entity shares identifiers with the suspect accounts.",
      ],
    },
    {
      title: "10. Important notice",
      kind: "text",
      text:
        "This pack assembles records and drafts submissions automatically. It does not constitute " +
        "legal advice. Regulatory timelines, portal processes and circulars change - confirm the " +
        "current position with a qualified advocate, the bank's grievance policy and the applicable " +
        "regulator directions before filing anything.",
    },
  ];

  return { case: c, generatedOn, held, traceable, excess, sections };
}

export function packToMarkdown(pack: EvidencePack): string {
  const c = pack.case;
  const lines: string[] = [
    `# Evidence pack - ${c.case_ref}`,
    "",
    `**Case:** ${c.title}`,
    `**Generated:** ${pack.generatedOn}`,
    `**Account:** ${c.account_no}, ${c.bank}`,
    `**Amount held:** ${inr(pack.held)} | **Traceable:** ${inr(pack.traceable)} | **Claiming release of:** ${inr(pack.excess)}`,
    "",
    "> Factual compilation only. Not legal advice. Verify current circulars and timelines before filing.",
    "",
  ];

  for (const s of pack.sections) {
    lines.push(`## ${s.title}`, "");
    if (s.kind === "text" && s.text) lines.push(s.text, "");
    if (s.kind === "list" && s.items) {
      for (const i of s.items) lines.push(`- ${i}`);
      lines.push("");
    }
    if (s.kind === "table" && s.rows) {
      const head = s.columns ?? [];
      lines.push("| " + head.join(" | ") + " |");
      lines.push("|" + head.map(() => "---").join("|") + "|");
      for (const r of s.rows) lines.push("| " + r.map((x) => String(x).replace(/\|/g, "/")).join(" | ") + " |");
      lines.push("");
    }
  }
  return lines.join("\n");
}

/** Compact evidence for an individual disputed transaction. */
export function transactionTrail(t: Transaction) {
  return {
    posted_at: t.posted_at,
    payer: t.payer,
    amount: t.credit,
    band: t.risk_band,
    score: t.risk_score,
    reasons: explain(t.risk_reasons),
    reconciled: t.reconciled === 1,
    order_id: t.order_id,
    ref_no: t.ref_no,
  };
}
