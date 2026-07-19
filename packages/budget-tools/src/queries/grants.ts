// Federal grants (USAspending) — obligations to Milwaukee County recipients.
//
// Two guardrails ride on every response:
//   1. `basis.amount_basis = "federal_obligation"` with comparable_to_budget:false
//      — federal FY, obligations, grants only; not city budget revenue.
//   2. No tool sums award_lifetime_* across rows. Those columns repeat the whole
//      award's value on every transaction, and summing them overstates FY2024 by
//      10.7x ($7.1B vs a true $666M). The operation simply isn't offered.
// See docs/FEDERAL-GRANTS-DESIGN.md.

import { query } from "../db";
import { num } from "../citation";
import type { GrantBasis, GrantResults, TopRecipients, GrantSummary } from "../types";

export const GRANT_BASIS: GrantBasis = {
  amount_basis: "federal_obligation",
  fiscal_year_basis: "federal (Oct 1 – Sep 30)",
  covers: ["block, formula and project grants", "cooperative agreements"],
  excludes: ["federal contracts", "loans", "direct payments", "sub-awards"],
  comparable_to_budget: false,
  note:
    "Federal grant obligations to recipients located in Milwaukee County — money committed " +
    "in that federal fiscal year. NOT city/county budget revenue: different fiscal calendar, " +
    "obligations rather than receipts, and grants only. Most recipients are nonprofits and " +
    "universities, not government departments. See docs/FEDERAL-GRANTS-DESIGN.md.",
};

const cites = (rows: any[]) => {
  const seen = new Set<string>();
  const out: { fiscal_year: number; source_row: number; award_key: string }[] = [];
  for (const r of rows) {
    if (r.fiscal_year == null || r.source_row == null) continue;
    const k = `${r.fiscal_year}:${r.source_row}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push({ fiscal_year: Number(r.fiscal_year), source_row: r.source_row, award_key: r.award_key });
    }
  }
  return out.slice(0, 25);
};

export async function searchGrants(a: {
  recipient?: string; agency?: string; program?: string;
  fiscal_year?: number; min_amount?: number; limit: number;
}): Promise<GrantResults> {
  const where: string[] = [];
  const params: any[] = [];
  if (a.recipient) { params.push(`%${a.recipient}%`); where.push(`recipient_name ILIKE $${params.length}`); }
  if (a.agency) { params.push(`%${a.agency}%`); where.push(`awarding_agency ILIKE $${params.length}`); }
  if (a.program) { params.push(`%${a.program}%`); where.push(`(cfda_title ILIKE $${params.length} OR cfda_number = trim(both '%' from $${params.length}))`); }
  if (a.fiscal_year) { params.push(a.fiscal_year); where.push(`fiscal_year = $${params.length}`); }
  if (a.min_amount != null) { params.push(a.min_amount); where.push(`obligated >= $${params.length}`); }
  if (where.length === 0) {
    throw new Error("Provide at least one filter: recipient, agency, program, fiscal_year, or min_amount.");
  }
  params.push(a.limit);

  const rows = await query(
    `SELECT grant_txn_id, fiscal_year, award_key, award_id, action_date, obligated,
            recipient_name, awarding_agency, awarding_sub_agency, cfda_number, cfda_title,
            description, source_row
       FROM fact_federal_grant
      WHERE ${where.join(" AND ")}
      ORDER BY obligated DESC LIMIT $${params.length}`,
    params,
  );

  return {
    hits: rows.length,
    results: rows.map((r) => ({
      grant_txn_id: Number(r.grant_txn_id), fiscal_year: Number(r.fiscal_year),
      award_id: r.award_id,
      action_date: r.action_date instanceof Date ? r.action_date.toISOString().slice(0, 10) : String(r.action_date),
      obligated: num(r.obligated), recipient: r.recipient_name,
      agency: r.awarding_agency, sub_agency: r.awarding_sub_agency,
      program: r.cfda_title, cfda_number: r.cfda_number,
      description: r.description ? String(r.description).slice(0, 300) : null,
    })),
    basis: GRANT_BASIS,
    citations: cites(rows),
  };
}

export async function getTopGrantRecipients(a: {
  fiscal_year?: number; agency?: string; limit: number;
}): Promise<TopRecipients> {
  const where: string[] = [];
  const params: any[] = [];
  if (a.fiscal_year) { params.push(a.fiscal_year); where.push(`fiscal_year = $${params.length}`); }
  if (a.agency) { params.push(`%${a.agency}%`); where.push(`awarding_agency ILIKE $${params.length}`); }
  params.push(a.limit);

  // Only `obligated` is summed. award_lifetime_* is deliberately absent — see the
  // module header; summing it across rows inflates totals ~10x.
  const rows = await query(
    `SELECT recipient_name,
            SUM(obligated)                                   AS net_obligated,
            SUM(CASE WHEN obligated > 0 THEN obligated END)  AS gross_obligated,
            SUM(CASE WHEN obligated < 0 THEN obligated END)  AS deobligations,
            COUNT(*)                                         AS transaction_count,
            COUNT(DISTINCT award_key)                        AS award_count,
            (ARRAY_AGG(fiscal_year ORDER BY grant_txn_id))[1] AS fiscal_year,
            (ARRAY_AGG(source_row  ORDER BY grant_txn_id))[1] AS source_row,
            (ARRAY_AGG(award_key   ORDER BY grant_txn_id))[1] AS award_key
       FROM fact_federal_grant
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      GROUP BY recipient_name
      ORDER BY net_obligated DESC NULLS LAST LIMIT $${params.length}`,
    params,
  );

  return {
    scope: { fiscal_year: a.fiscal_year ?? "all years", agency: a.agency ?? "all agencies" },
    recipients: rows.map((r) => ({
      recipient: r.recipient_name, net_obligated: num(r.net_obligated),
      gross_obligated: num(r.gross_obligated), deobligations: num(r.deobligations) ?? 0,
      transaction_count: Number(r.transaction_count), award_count: Number(r.award_count),
    })),
    basis: GRANT_BASIS,
    citations: cites(rows),
  };
}

export async function grantSummary(a: {
  group_by: "year" | "agency" | "program" | "recipient";
  fiscal_year?: number; recipient?: string;
}): Promise<GrantSummary> {
  const col = { year: "fiscal_year::text", agency: "awarding_agency",
                program: "cfda_title", recipient: "recipient_name" }[a.group_by];
  const where: string[] = [];
  const params: any[] = [];
  if (a.fiscal_year) { params.push(a.fiscal_year); where.push(`fiscal_year = $${params.length}`); }
  if (a.recipient) { params.push(`%${a.recipient}%`); where.push(`recipient_name ILIKE $${params.length}`); }

  const rows = await query(
    `SELECT ${col} AS bucket, SUM(obligated) AS net_obligated, COUNT(*) AS transaction_count,
            COUNT(DISTINCT recipient_name) AS recipient_count,
            (ARRAY_AGG(fiscal_year ORDER BY grant_txn_id))[1] AS fiscal_year,
            (ARRAY_AGG(source_row  ORDER BY grant_txn_id))[1] AS source_row,
            (ARRAY_AGG(award_key   ORDER BY grant_txn_id))[1] AS award_key
       FROM fact_federal_grant
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      GROUP BY bucket
      ORDER BY ${a.group_by === "year" ? "bucket ASC" : "net_obligated DESC NULLS LAST"} LIMIT 60`,
    params,
  );

  return {
    grouped_by: a.group_by,
    scope: { fiscal_year: a.fiscal_year ?? "all years", recipient: a.recipient ?? "all recipients" },
    buckets: rows.map((r) => ({
      bucket: r.bucket == null ? "(unspecified)" : String(r.bucket),
      net_obligated: num(r.net_obligated), transaction_count: Number(r.transaction_count),
      recipient_count: Number(r.recipient_count),
    })),
    basis: GRANT_BASIS,
    citations: cites(rows),
  };
}
