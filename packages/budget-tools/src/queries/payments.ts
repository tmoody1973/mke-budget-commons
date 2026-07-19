// City Open Checkbook — cash vendor disbursements.
//
// These tools NEVER return a budget figure, and every response carries a
// machine-readable `basis` block with `comparable_to_budget: false`. A model has
// to actively override an explicit flag rather than merely fail to infer a
// caveat from prose. See docs/CHECKBOOK-GUARDRAIL.md for the measured evidence.

import { query } from "../db";
import { num } from "../citation";
import type { PaymentBasis, VendorPaymentResults, TopVendors, PaymentSummary, BudgetVsPayments } from "../types";

/** Attached to every response from this module. Not decoration — the guardrail. */
export const BASIS: PaymentBasis = {
  amount_basis: "cash_disbursement",
  excludes: ["direct salaries and wages", "interdepartmental charges"],
  includes_non_operating: ["pension remittances", "debt principal", "interest"],
  comparable_to_budget: false,
  note:
    "Vendor disbursements from the City Open Checkbook. NOT actuals-against-budget: " +
    "different granularity (70 spending units vs 25 budget departments), scope " +
    "(excludes payroll), content (includes debt service and pension) and basis " +
    "(cash vs appropriation). See docs/CHECKBOOK-GUARDRAIL.md.",
};

/** Resolve a spending-unit name or id to unit_ids; returns candidates when ambiguous. */
export async function resolveUnit(name: string) {
  return (await query(
    `SELECT unit_id, unit_name FROM dim_spending_unit
      WHERE unit_name ILIKE $1 OR unit_id = $2
      ORDER BY unit_name`,
    [`%${name}%`, name],
  )) as { unit_id: string; unit_name: string }[];
}

const citeRows = (rows: any[]) => {
  const seen = new Set<string>();
  const out: { doc_id: string; source_row: number; locator: "row" }[] = [];
  for (const r of rows) {
    const k = `${r.doc_id}:${r.source_row}`;
    if (r.doc_id != null && r.source_row != null && !seen.has(k)) {
      seen.add(k);
      out.push({ doc_id: r.doc_id, source_row: r.source_row, locator: "row" });
    }
  }
  return out.slice(0, 25);
};

export async function searchVendorPayments(a: {
  vendor?: string; unit?: string; account?: string;
  year?: number; min_amount?: number; limit: number;
}): Promise<VendorPaymentResults> {
  const where: string[] = [];
  const params: any[] = [];
  if (a.vendor) { params.push(`%${a.vendor}%`); where.push(`p.vendor_name ILIKE $${params.length}`); }
  if (a.unit) { params.push(`%${a.unit}%`); where.push(`u.unit_name ILIKE $${params.length}`); }
  if (a.account) { params.push(`%${a.account}%`); where.push(`p.account_description ILIKE $${params.length}`); }
  if (a.year) { params.push(a.year); where.push(`EXTRACT(YEAR FROM p.paid_on) = $${params.length}`); }
  if (a.min_amount != null) { params.push(a.min_amount); where.push(`p.amount_paid >= $${params.length}`); }
  if (where.length === 0) throw new Error("Provide at least one filter: vendor, unit, account, year, or min_amount.");
  params.push(a.limit);

  const rows = await query(
    `SELECT p.payment_id, p.voucher_id, p.paid_on, p.vendor_name, u.unit_name,
            p.account_description, p.fund_name, p.amount_paid, p.doc_id, p.source_row
       FROM fact_vendor_payment p JOIN dim_spending_unit u USING (unit_id)
      WHERE ${where.join(" AND ")}
      ORDER BY p.amount_paid DESC LIMIT $${params.length}`,
    params,
  );

  return {
    hits: rows.length,
    results: rows.map((r) => ({
      payment_id: Number(r.payment_id), voucher_id: r.voucher_id,
      paid_on: r.paid_on instanceof Date ? r.paid_on.toISOString().slice(0, 10) : String(r.paid_on),
      vendor: r.vendor_name, spending_unit: r.unit_name,
      account: r.account_description, fund: r.fund_name, amount_paid: num(r.amount_paid),
    })),
    basis: BASIS,
    citations: citeRows(rows),
  };
}

export async function getTopVendors(a: {
  unit?: string; year?: number; limit: number;
}): Promise<TopVendors> {
  const where: string[] = [];
  const params: any[] = [];
  if (a.unit) { params.push(`%${a.unit}%`); where.push(`u.unit_name ILIKE $${params.length}`); }
  if (a.year) { params.push(a.year); where.push(`EXTRACT(YEAR FROM p.paid_on) = $${params.length}`); }
  params.push(a.limit);

  // Netted by default: a "top vendor" means net dollars received. Gross and
  // refunds are exposed separately so netting is visible, never silent.
  const rows = await query(
    `SELECT p.vendor_name,
            SUM(p.amount_paid)                                   AS net_paid,
            SUM(CASE WHEN p.amount_paid > 0 THEN p.amount_paid END) AS gross_paid,
            SUM(CASE WHEN p.amount_paid < 0 THEN p.amount_paid END) AS refunds,
            COUNT(*)                                             AS payment_count,
            MIN(p.doc_id) AS doc_id, MIN(p.source_row) AS source_row
       FROM fact_vendor_payment p JOIN dim_spending_unit u USING (unit_id)
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      GROUP BY p.vendor_name
      ORDER BY net_paid DESC NULLS LAST LIMIT $${params.length}`,
    params,
  );

  return {
    scope: { unit: a.unit ?? "citywide", year: a.year ?? "all years" },
    vendors: rows.map((r) => ({
      vendor: r.vendor_name, net_paid: num(r.net_paid), gross_paid: num(r.gross_paid),
      refunds: num(r.refunds) ?? 0, payment_count: Number(r.payment_count),
    })),
    basis: BASIS,
    citations: citeRows(rows),
  };
}

export async function vendorPaymentSummary(a: {
  unit?: string; year?: number; group_by: "account" | "fund" | "year" | "unit";
}): Promise<PaymentSummary> {
  const col = { account: "p.account_description", fund: "p.fund_name",
                year: "EXTRACT(YEAR FROM p.paid_on)::int", unit: "u.unit_name" }[a.group_by];
  const where: string[] = [];
  const params: any[] = [];
  if (a.unit) { params.push(`%${a.unit}%`); where.push(`u.unit_name ILIKE $${params.length}`); }
  if (a.year) { params.push(a.year); where.push(`EXTRACT(YEAR FROM p.paid_on) = $${params.length}`); }

  const rows = await query(
    `SELECT ${col} AS bucket, SUM(p.amount_paid) AS net_paid, COUNT(*) AS payment_count,
            MIN(p.doc_id) AS doc_id, MIN(p.source_row) AS source_row
       FROM fact_vendor_payment p JOIN dim_spending_unit u USING (unit_id)
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      GROUP BY bucket ORDER BY net_paid DESC NULLS LAST LIMIT 60`,
    params,
  );

  return {
    grouped_by: a.group_by,
    scope: { unit: a.unit ?? "citywide", year: a.year ?? "all years" },
    buckets: rows.map((r) => ({
      bucket: r.bucket == null ? "(unspecified)" : String(r.bucket),
      net_paid: num(r.net_paid), payment_count: Number(r.payment_count),
    })),
    basis: BASIS,
    citations: citeRows(rows),
  };
}

/**
 * Always refuses. This exists so "did department X spend its budget?" has a
 * correct destination — an unanswered question is where a model improvises a
 * join that produces a plausible, quotable, false number.
 */
export async function compareBudgetToPayments(a: {
  department: string; fiscal_year?: number;
}): Promise<BudgetVsPayments> {
  const units = await resolveUnit(a.department);
  return {
    comparable: false,
    requested: { department: a.department, fiscal_year: a.fiscal_year ?? null },
    reason:
      "There is no valid department-level budget-vs-actual between the adopted budget " +
      "and the Open Checkbook. They differ in granularity (70 spending units vs 25 budget " +
      "departments; only 9 names match exactly), scope (the checkbook excludes direct " +
      "salaries and wages — usually most of a department's budget), content (it includes " +
      "pension, debt principal and interest, which are not departmental operating spend), " +
      "and basis (cash on date paid vs appropriation by fiscal year). Joining them " +
      "produces figures that look plausible and are wrong — e.g. 'City Attorney spent " +
      "78.2% of its budget'.",
    budget_execution_available: false,
    matching_spending_units: units.map((u) => u.unit_name),
    what_you_can_ask_instead: [
      `get_top_vendors(unit: "${a.department}") — who this unit actually pays`,
      `vendor_payment_summary(unit: "${a.department}", group_by: "account") — what it pays for`,
      `vendor_payment_summary(unit: "${a.department}", group_by: "year") — payment trend over time`,
      `get_department_budget(dept: "${a.department}") — the appropriation, on its own terms`,
    ],
    basis: BASIS,
  };
}
