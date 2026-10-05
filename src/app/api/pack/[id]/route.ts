import { NextRequest } from "next/server";

import { getCase } from "@/lib/db";
import { buildEvidencePack, packToMarkdown } from "@/lib/evidence";
import { statusLabel } from "@/lib/cases";
import { inr } from "@/lib/format";

export const dynamic = "force-dynamic";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const c = await getCase(Number(id));
  if (!c) return new Response("Case not found", { status: 404 });

  const pack = await buildEvidencePack(c);
  const wantsHtml = new URL(req.url).searchParams.get("format") === "html";
  const filename = `evidence-pack-${c.case_ref}`;

  if (!wantsHtml) {
    return new Response(packToMarkdown(pack), {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}.md"`,
      },
    });
  }

  const body = pack.sections
    .map((s) => {
      if (s.kind === "text") return `<h2>${esc(s.title)}</h2><pre class="text">${esc(s.text ?? "")}</pre>`;
      if (s.kind === "list") return `<h2>${esc(s.title)}</h2><ul>${(s.items ?? []).map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
      const head = (s.columns ?? []).map((h) => `<th>${esc(h)}</th>`).join("");
      const rows = (s.rows ?? [])
        .map((r) => `<tr>${r.map((cell) => `<td>${esc(String(cell))}</td>`).join("")}</tr>`)
        .join("");
      return `<h2>${esc(s.title)}</h2><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
    })
    .join("");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>Evidence pack ${esc(c.case_ref)}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; color: #0d1726; margin: 40px auto; max-width: 960px; line-height: 1.55; font-size: 13.5px; }
  h1 { font-size: 26px; letter-spacing: -0.02em; margin-bottom: 4px; }
  h2 { font-size: 15px; margin: 26px 0 8px; border-bottom: 1px solid #e3e8f0; padding-bottom: 5px; }
  table { width: 100%; border-collapse: collapse; font-size: 12.3px; }
  th { text-align: left; background: #f7f9fc; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #5d6b82; }
  th, td { border: 1px solid #e3e8f0; padding: 6px 8px; vertical-align: top; }
  pre.text { white-space: pre-wrap; font-family: inherit; background: #f7f9fc; padding: 12px; border-radius: 8px; }
  .meta { color: #5d6b82; }
  .disclaimer { background: #fdf1e0; border: 1px solid #f5ddbb; color: #8a4708; padding: 10px 14px; border-radius: 8px; margin-top: 24px; font-size: 12.3px; }
  @media print { body { margin: 0; } h2 { break-after: avoid; } tr { break-inside: avoid; } }
</style></head>
<body>
<h1>Evidence pack - ${esc(c.case_ref)}</h1>
<p class="meta">
  ${esc(c.title)}<br/>
  Merchant account ${esc(c.account_no)} · ${esc(c.bank)}<br/>
  Amount held ${inr(pack.held)} · traceable ${inr(pack.traceable)} · claiming release ${inr(pack.excess)} ·
  scope ${esc(statusLabel(c.hold_scope))} · generated ${esc(pack.generatedOn)}
</p>
${body}
<p class="disclaimer">
  This pack assembles records and drafts submissions automatically. It is not legal advice. Regulatory timelines,
  circulars and portal processes change - confirm the current position with a qualified advocate and the applicable
  regulator directions before filing anything.
</p>
</body></html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `inline; filename="${filename}.html"`,
    },
  });
}
