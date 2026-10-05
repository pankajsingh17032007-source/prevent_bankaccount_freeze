import { getCase, getMerchant } from "@/lib/db";
import { buildEvidencePack } from "@/lib/evidence";
import { localDate } from "@/lib/format";
import { getLetter } from "@/lib/templates";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string; key: string }> }) {
  const { id, key } = await ctx.params;
  const c = await getCase(Number(id));
  if (!c) return new Response("Case not found", { status: 404 });

  const [merchant, pack] = await Promise.all([getMerchant(), buildEvidencePack(c)]);
  const today = localDate();
  const letter = getLetter(key, { merchant, c, traceable: pack.traceable, excess: pack.excess, generatedOn: today });

  const text = `SUBJECT: ${letter.subject}\nTO: ${letter.to}\n\n${letter.body}\n\nNOTE: ${letter.caution}\n`;
  return new Response(text, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${c.case_ref}-${letter.key}.txt"`,
    },
  });
}
