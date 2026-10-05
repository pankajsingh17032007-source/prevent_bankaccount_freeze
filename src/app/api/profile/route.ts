import { bandSummary, countTransactions, getMerchant, listCases, listCounterparties, listCreditLines, listStatements, listTransactions } from "@/lib/db";
import { statusLabel } from "@/lib/cases";
import { inr, localDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function GET() {
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
  const pct = Math.round((reconciledAmt / Math.max(1, totalAmt)) * 100);

  const rows = cases
    .map(
      (c) => `<tr><td><b>${esc(c.case_ref)}</b><br/><span class="muted">${esc(c.title)}</span></td>
      <td>${esc(c.freeze_date)}</td><td>${esc(statusLabel(c.hold_scope))}</td>
      <td class="r">${inr(c.hold_amount)}</td><td class="r">${inr(c.disputed_amount)}</td>
      <td>${esc(statusLabel(c.status))}</td></tr>`,
    )
    .join("");

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<title>Merchant verified profile - ${esc(merchant.legal_name)}</title>
<style>
 body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; color:#0d1726; margin:40px auto; max-width:900px; font-size:13.5px; line-height:1.55; }
 h1 { font-size:24px; margin:0 0 4px; letter-spacing:-0.02em; }
 h2 { font-size:15px; margin:26px 0 8px; border-bottom:1px solid #e3e8f0; padding-bottom:5px; }
 .muted { color:#5d6b82; } .small { font-size:12.5px; }
 .grid { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
 .tile { border:1px solid #e3e8f0; border-radius:10px; padding:12px; }
 .tile .k { font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:#5d6b82; }
 .tile .v { font-size:22px; font-weight:700; margin-top:4px; }
 table { width:100%; border-collapse:collapse; font-size:12.5px; }
 th { text-align:left; background:#f7f9fc; font-size:11px; text-transform:uppercase; color:#5d6b82; }
 th,td { border:1px solid #e3e8f0; padding:7px 9px; vertical-align:top; }
 .r { text-align:right; font-variant-numeric:tabular-nums; }
 .kv { display:grid; grid-template-columns:180px 1fr; gap:6px 14px; }
 .kv dt { color:#5d6b82; } .kv dd { margin:0; font-weight:600; }
 .note { background:#eaf0ff; border:1px solid #d4e0ff; color:#1c3f9e; padding:10px 14px; border-radius:8px; font-size:12.5px; }
 @media print { body { margin:0; } }
</style></head><body>
<h1>${esc(merchant.legal_name)}</h1>
<p class="muted">Merchant verified profile · ${esc(merchant.nature)} · GSTIN ${esc(merchant.gstin)} · PAN ${esc(merchant.pan)} · generated ${localDate()}</p>
<div class="grid">
 <div class="tile"><div class="k">Inbound reconciled</div><div class="v">${pct}%</div><div class="small muted">${inr(reconciledAmt)} of ${inr(totalAmt)}</div></div>
 <div class="tile"><div class="k">Counterparties verified</div><div class="v">${verified}/${cps.length}</div><div class="small muted">GSTIN / PAN checked</div></div>
 <div class="tile"><div class="k">Transactions covered</div><div class="v">${countTransactions()}</div><div class="small muted">${statements.length} statements</div></div>
 <div class="tile"><div class="k">Watchlisted payers</div><div class="v">${watchlisted}</div><div class="small muted">disclosed, not concealed</div></div>
</div>
<h2>Account architecture</h2>
<dl class="kv">
 <dt>Collection</dt><dd>${esc(merchant.collection_bank)} · ${esc(merchant.collection_account)}</dd>
 <dt>Operating</dt><dd>${esc(merchant.operating_bank)} · ${esc(merchant.operating_account)}</dd>
 <dt>Backup</dt><dd>${esc(merchant.backup_bank)} · ${esc(merchant.backup_account)}</dd>
 <dt>Sweep policy</dt><dd>${esc(merchant.sweep_policy)}</dd>
</dl>
<h2>Risk posture</h2>
<p>${bands.map((b) => `${b.band}: ${b.n}`).join(" · ")}</p>
<p class="small muted">Standby liquidity outside the collection bank: ${inr(lines.filter((l) => l.status !== "drawn").reduce((s, l) => s + l.limit_amount, 0))} · average monthly receipts ${inr(totalAmt / Math.max(1, months))}</p>
<h2>Disclosed hold history</h2>
<table><thead><tr><th>Case</th><th>Date</th><th>Scope</th><th class="r">Held</th><th class="r">Traceable</th><th>Status</th></tr></thead>
<tbody>${rows || '<tr><td colspan="6">No hold history.</td></tr>'}</tbody></table>
<h2>Atestation</h2>
<p>This profile is generated from the entity's own bank statements, invoices, GST filings and KYC records. Every figure is traceable to a document in the evidence pack. The merchant does not contest a hold up to the traceable amount in any disclosed matter.</p>
<p class="note">Product concept for a shared &quot;merchant verified&quot; directory. It carries no legal standing by itself and does not constitute legal advice.</p>
</body></html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": "inline" },
  });
}
