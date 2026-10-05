"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { db, getMerchant } from "@/lib/db";
import { ingestStatement } from "@/lib/csv";
import { localDate, localStamp } from "@/lib/format";

function refresh(paths: string[] = ["/", "/risk", "/cases", "/prevention"]) {
  for (const p of paths) revalidatePath(p);
}

/* ---------------- statements ---------------- */

export async function uploadStatement(formData: FormData): Promise<void> {
  const file = formData.get("file");
  const bank = String(formData.get("bank") || "Uploaded bank");
  const account = String(formData.get("account") || "-");

  if (!(file instanceof File) || file.size === 0) {
    redirect("/statements?err=" + encodeURIComponent("Choose a CSV statement first."));
  }
  const text = await file.text();
  const res = ingestStatement(text, file.name, bank, account);
  refresh();
  const q = new URLSearchParams({
    ok: "1",
    n: String(res.inserted),
    flagged: String(res.flagged),
    band: res.highestBand,
    issues: res.issues.join(" "),
  });
  redirect("/statements?" + q.toString());
}

/* ---------------- escalation ladder ---------------- */

export async function setStageStatus(caseId: number, stageId: number, status: string): Promise<void> {
  const allowed = ["not_started", "in_progress", "awaiting_response", "escalated", "done", "skipped"];
  if (!allowed.includes(status)) return;
  const stamp = localStamp();
  db()
    .prepare(
      `UPDATE case_stages SET status=?, actioned_at=CASE WHEN ?='done' THEN ? ELSE actioned_at END,
       log=? WHERE id=? AND case_id=?`,
    )
    .run(status, status, stamp, `Marked ${status} on ${stamp}.`, stageId, caseId);
  refresh(["/cases", `/cases/${caseId}`]);
}

/** Form wrapper: hidden case/stage ids plus the chosen status. */
export async function updateStageFromForm(formData: FormData): Promise<void> {
  const caseId = Number(formData.get("caseId"));
  const stageId = Number(formData.get("stageId"));
  const status = String(formData.get("status") ?? "");
  if (!caseId || !stageId) return;
  await setStageStatus(caseId, stageId, status);
}

export async function setCaseStatus(caseId: number, status: string): Promise<void> {
  const allowed = [
    "open", "awaiting_bank", "awaiting_police", "ombudsman", "legal",
    "released", "partial_release", "closed",
  ];
  if (!allowed.includes(status)) return;
  db().prepare("UPDATE cases SET status=? WHERE id=?").run(status, caseId);
  refresh(["/cases", `/cases/${caseId}`]);
}

export async function createCase(formData: FormData): Promise<void> {
  const str = (k: string) => String(formData.get(k) ?? "").trim();
  const num = (k: string) => Number(String(formData.get(k) ?? "0").replace(/[, ]/g, "")) || 0;
  const title = str("title");
  if (!title) return;
  const merchant = getMerchant();
  const freezeDate = str("freeze_date") || localDate();
  const n = (db().prepare("SELECT COUNT(*) c FROM cases").get() as { c: number }).c + 1;
  const caseRef = `AF-${new Date().getFullYear()}-${String(140 + n).padStart(4, "0")}`;
  const hold = num("hold_amount");
  const disputed = num("disputed_amount");
  const res = db()
    .prepare(
      `INSERT INTO cases (case_ref, title, account_no, bank, branch, hold_amount, disputed_amount,
        account_balance, hold_scope, trigger_source, ncrp_complaint, fir_no, police_station,
        freeze_date, status, created_at, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      caseRef, title, str("account_no") || merchant.collection_account, str("bank") || merchant.collection_bank,
      str("branch") || merchant.collection_branch, hold, disputed, num("account_balance") || hold,
      formData.get("hold_scope") === "disputed_amount" ? "disputed_amount" : "full_balance",
      str("trigger_source") || "NCRP/I4C cyber-fraud portal complaint",
      str("ncrp_complaint") || null, str("fir_no") || null, str("police_station"),
      freezeDate, "open", localDate(), str("notes"),
    );
  const caseId = Number(res.lastInsertRowid);
  refresh(["/cases"]);
  redirect(`/cases/${caseId}`);
}

/* ---------------- documents & counterparties ---------------- */

export async function toggleDocument(caseId: number, docId: number): Promise<void> {
  db().prepare("UPDATE documents SET present = CASE WHEN present=1 THEN 0 ELSE 1 END WHERE id=? AND case_id=?")
    .run(docId, caseId);
  refresh([`/cases/${caseId}`, "/cases"]);
}

export async function setKyc(cpId: number, status: string): Promise<void> {
  if (!["verified", "pending", "unverified", "expired"].includes(status)) return;
  db().prepare("UPDATE counterparties SET kyc_status=? WHERE id=?").run(status, cpId);
  refresh(["/prevention", "/risk", "/profile"]);
}

export async function toggleWatchlist(cpId: number): Promise<void> {
  db().prepare("UPDATE counterparties SET watchlist = CASE WHEN watchlist=1 THEN 0 ELSE 1 END WHERE id=?").run(cpId);
  refresh(["/prevention", "/risk"]);
}

export async function setCreditLine(id: number, status: string): Promise<void> {
  if (!["available", "applied", "approved", "drawn"].includes(status)) return;
  db().prepare("UPDATE credit_lines SET status=? WHERE id=?").run(status, id);
  refresh(["/bridge"]);
}

export async function setCounterpartyNote(cpId: number, note: string): Promise<void> {
  db().prepare("UPDATE counterparties SET note=? WHERE id=?").run(String(note).slice(0, 400), cpId);
  refresh(["/prevention"]);
}
