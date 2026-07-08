import { query } from "./db";

export type Gov = "city" | "county" | "mps";

/** Resolve a department name to a dept_id; returns candidates when ambiguous. */
export async function resolveDept(gov: string, name: string) {
  const rows = await query(
    `SELECT DISTINCT d.dept_id, d.canonical_name
       FROM dim_department d LEFT JOIN dept_alias a USING (dept_id)
      WHERE d.gov_id = $1
        AND (d.canonical_name ILIKE $2 OR a.printed_name ILIKE $2 OR d.dept_id ILIKE $2)`,
    [gov, `%${name}%`],
  );
  return rows as { dept_id: string; canonical_name: string }[];
}

export const VINTAGE: Record<string, string> = {
  adopted: "adopted", budget: "budget", actual: "actual",
  requested: "requested", proposed: "proposed", recommended: "recommended",
};

// A department's grand total, gov-agnostic. The city ledger prints it as an
// untyped reserved-code total (account NULL, line_kind 'total'); the county book
// prints it as the 'Total Expenditures' category row. A department only ever
// carries one of the two shapes, so this predicate is exact for both. `p` is an
// optional table-alias prefix (e.g. "f.").
export const grandTotalPred = (p = "") =>
  `((${p}line_kind='total' AND ${p}account IS NULL)` +
  ` OR (${p}line_kind='category' AND ${p}line_description='Total Expenditures'))`;

// Department rollup for one fiscal year. City/county: MAX over the printed
// department total (avoids double-counting a summary unit against its divisions).
// MPS: SUM the atomic line items (no printed per-school total exists).
export async function deptYear(dept_id: string, year: number, gov = "city") {
  if (gov === "mps") {
    const [a] = await query(
      `SELECT SUM(amount) FILTER (WHERE line_kind='expenditure') AS grand,
              SUM(units)  FILTER (WHERE line_kind='expenditure') AS fte
         FROM fact_budget_line WHERE dept_id=$1 AND fiscal_year=$2`, [dept_id, year]);
    const cites = await query(
      `SELECT DISTINCT doc_id, source_page FROM fact_budget_line
        WHERE dept_id=$1 AND fiscal_year=$2 AND line_kind='expenditure' LIMIT 5`, [dept_id, year]);
    return { a, cites };
  }
  const [a] = await query(
    `SELECT
       MAX(amount) FILTER (WHERE ${grandTotalPred()}) AS grand,
       MAX(amount) FILTER (WHERE account='006000' AND line_kind='total') AS net_salaries,
       MAX(amount) FILTER (WHERE account='006100' AND line_kind='total') AS fringe,
       MAX(amount) FILTER (WHERE account='006300' AND line_kind='total') AS operating,
       MAX(amount) FILTER (WHERE account='006800' AND line_kind='total') AS equipment
     FROM fact_budget_line WHERE dept_id=$1 AND fiscal_year=$2`,
    [dept_id, year],
  );
  const cites = await query(
    `SELECT DISTINCT doc_id, source_page FROM fact_budget_line
      WHERE dept_id=$1 AND fiscal_year=$2 AND ${grandTotalPred()} LIMIT 5`,
    [dept_id, year]);
  return { a, cites };
}

export const pct = (from: number | null, to: number | null) =>
  from && to != null ? Math.round(((to - from) / from) * 1000) / 10 : null;

export const STAGE_ORDER = ["requested", "recommended", "proposed", "adopted"];

// The authoritative amount_kind for a given fiscal year (avoids counting the
// same 2026 rows from both the adopted book and the requested book's budget col).
export const YEAR_KIND: Record<number, string> = { 2024: "actual", 2025: "budget", 2026: "adopted", 2027: "requested" };
// DPW divisions are already rolled up in the DPW-Summary unit — exclude them from
// citywide sums to avoid double-counting.
export const ROLLUP_EXCLUDE = [
  "city-dpw-administrative-services-division",
  "city-dpw-infrastructure-services-division",
  "city-dpw-operations-division",
];
