export type RiskBand = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface RiskReason {
  code: string;
  label: string;
  points: number;
}

export interface RiskResult {
  score: number;
  band: RiskBand;
  reasons: RiskReason[];
}

export type PayerType = "customer" | "supplier" | "unknown" | "refund";

export interface Statement {
  id: number;
  filename: string;
  bank: string;
  account_no: string;
  uploaded_at: string;
  txn_count: number;
}

export interface Transaction {
  id: number;
  statement_id: number;
  posted_at: string;
  narration: string;
  payer: string;
  ref_no: string;
  credit: number;
  debit: number;
  balance: number;
  order_id: number | null;
  risk_score: number;
  risk_band: RiskBand;
  risk_reasons: string;
  reconciled: number;
}

export type CounterpartyKind = "buyer" | "supplier" | "customer";
export type KycStatus = "verified" | "pending" | "unverified" | "expired";

export interface Counterparty {
  id: number;
  name: string;
  kind: CounterpartyKind;
  gstin: string | null;
  kyc_status: KycStatus;
  first_seen: string;
  last_seen: string;
  credits_total: number;
  credit_count: number;
  note: string;
  watchlist: number;
}

export interface Order {
  id: number;
  order_no: string;
  buyer: string;
  amount: number;
  placed_at: string;
  invoice_no: string | null;
  ship_status: "unshipped" | "in_transit" | "delivered";
  awb: string | null;
  proof_url: string | null;
}

export type CaseStatus =
  | "open"
  | "awaiting_bank"
  | "awaiting_police"
  | "ombudsman"
  | "legal"
  | "released"
  | "partial_release"
  | "closed";

export type HoldScope = "full_balance" | "disputed_amount";

export interface FreezeCase {
  id: number;
  case_ref: string;
  title: string;
  account_no: string;
  bank: string;
  branch: string;
  hold_amount: number;
  disputed_amount: number;
  account_balance: number;
  hold_scope: HoldScope;
  trigger_source: string;
  ncrp_complaint: string | null;
  fir_no: string | null;
  police_station: string;
  freeze_date: string;
  status: CaseStatus;
  created_at: string;
  notes: string;
}

export type StageStatus =
  | "not_started"
  | "in_progress"
  | "awaiting_response"
  | "escalated"
  | "done"
  | "skipped";

export interface CaseStage {
  id: number;
  case_id: number;
  step_no: number;
  name: string;
  authority: string;
  sla_days: number;
  due_at: string;
  status: StageStatus;
  template_key: string;
  actioned_at: string | null;
  log: string;
}

export interface CreditLine {
  id: number;
  provider: string;
  kind: "overdraft" | "invoice_discounting" | "working_capital" | "payroll_rail";
  limit_amount: number;
  rate_pa: number;
  eligibility: string;
  activation: string;
  status: "available" | "applied" | "approved" | "drawn";
}
