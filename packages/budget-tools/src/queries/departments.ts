import { query } from "../db.js";
import { citations, num } from "../citation.js";
import { resolveDept, VINTAGE, grandTotalPred, type Gov } from "../helpers.js";

export async function listDepartments(a: { gov: Gov; fiscal_year?: number }) {
  const { gov, fiscal_year } = a;
  // City/county: MAX over a printed department total (a summary unit already
  // equals the sum of its divisions). MPS: no printed per-school total exists,
  // so SUM the atomic line items — the natural, non-double-counting rollup.
  // MPS defaults to FY2027 (proposed, the headline); city/county to adopted.
  const rows = gov === "mps"
    ? await query(
        `SELECT d.dept_id, d.canonical_name,
                SUM(f.amount) FILTER (WHERE f.line_kind='expenditure'
                                        AND f.fiscal_year=$1) AS total
           FROM dim_department d JOIN fact_budget_line f USING (dept_id)
          WHERE d.gov_id='mps' GROUP BY 1,2 ORDER BY total DESC NULLS LAST`,
        [fiscal_year ?? 2027])
    : await query(
        `SELECT d.dept_id, d.canonical_name,
                MAX(f.amount) FILTER (WHERE ${grandTotalPred("f.")}
                                        AND f.amount_kind='adopted') AS total
           FROM dim_department d JOIN fact_budget_line f USING (dept_id)
          WHERE d.gov_id = $1
          GROUP BY 1,2 ORDER BY total DESC NULLS LAST`,
        [gov]);
  return {
    government: gov,
    total_label: gov === "mps" ? `FY${fiscal_year ?? 2027}` : "adopted",
    departments: rows.map((r) => ({
      dept_id: r.dept_id, name: r.canonical_name, total: num(r.total),
    })),
  };
}

export async function getDepartmentBudget(a: { dept: string; gov: Gov; fiscal_year?: number; doc_type?: string }): Promise<any> {
  const { dept, gov, fiscal_year, doc_type } = a;
  const cands = await resolveDept(gov, dept);
  if (cands.length === 0) throw new Error(`No department matches "${dept}".`);
  if (cands.length > 1) return { ambiguous: true, candidates: cands };
  const dept_id = cands[0].dept_id;
  const vintage = VINTAGE[doc_type ?? "adopted"] ?? "adopted";
  const fy = fiscal_year ?? (gov === "mps" ? 2027 : 2026);

  // County chapters report category rollups, not the city's reserved-code
  // ledger — a different breakdown (Personnel/Operations/Debt/Interdepartmental
  // → Total Expenditures; Total Expenditures − Total Revenues = Tax Levy).
  if (gov === "county") return countyDeptBudget(cands[0], fy);
  // MPS: a school/office is a set of line items — sum them, and break down by
  // object (Teacher, Para, Benefits, …) and fund.
  if (gov === "mps") return mpsSchoolBudget(cands[0], fy);

  // MAX over reserved-code totals gives the department rollup (summary unit)
  // without double-counting divisions. Provenance comes from the same rows.
  const [agg] = await query(
    `SELECT
       MAX(amount) FILTER (WHERE account='006000' AND line_kind='total') AS net_salaries,
       MAX(amount) FILTER (WHERE account='006100' AND line_kind='total') AS fringe,
       MAX(amount) FILTER (WHERE account='006300' AND line_kind='total') AS operating,
       MAX(amount) FILTER (WHERE account='006800' AND line_kind='total') AS equipment,
       MAX(amount) FILTER (WHERE account IS NULL AND line_kind='total') AS grand_total,
       MAX(units)  FILTER (WHERE line_kind='fte' AND line_description ILIKE 'O&M%') AS om,
       MAX(units)  FILTER (WHERE line_kind='fte' AND line_description ILIKE 'NON-O&M%') AS non_om
     FROM fact_budget_line WHERE dept_id=$1 AND amount_kind=$2`,
    [dept_id, vintage],
  );
  const anchors = await query(
    `SELECT account, amount, source_page, doc_id FROM fact_budget_line
      WHERE dept_id=$1 AND amount_kind=$2 AND line_kind='total'`, [dept_id, vintage]);

  const divisions = await query(
    `SELECT DISTINCT division FROM fact_budget_line
      WHERE dept_id=$1 AND division IS NOT NULL ORDER BY division`, [dept_id]);
  const top = await query(
    `SELECT line_description, account, amount, source_page, doc_id
       FROM fact_budget_line
      WHERE dept_id=$1 AND amount_kind=$2 AND line_kind='expenditure' AND amount IS NOT NULL
      ORDER BY amount DESC LIMIT 8`, [dept_id, vintage]);

  return {
    department: cands[0].canonical_name, dept_id, doc_type: vintage,
    totals: {
      net_salaries_006000: num(agg.net_salaries), fringe_006100: num(agg.fringe),
      operating_006300: num(agg.operating), equipment_006800: num(agg.equipment),
      grand_total: num(agg.grand_total),
    },
    fte: { om: num(agg.om), non_om: num(agg.non_om) },
    divisions: divisions.map((d) => d.division),
    top_expenditures: top.map((t) => ({
      description: t.line_description, account: t.account, amount: num(t.amount), page: t.source_page,
    })),
    citations: citations([...anchors, ...top]),
  };
}

// MPS school/office budget: a set of line items (no printed per-school total),
// summed and broken down by object category and fund. FY2027 proposed default.
async function mpsSchoolBudget(cand: { dept_id: string; canonical_name: string }, fiscal_year: number) {
  const [tot] = await query(
    `SELECT SUM(amount) total, SUM(units) fte, COUNT(*) lines
       FROM fact_budget_line
      WHERE dept_id=$1 AND line_kind='expenditure' AND fiscal_year=$2`,
    [cand.dept_id, fiscal_year]);
  const byObject = await query(
    `SELECT line_description AS object, SUM(amount) amount, SUM(units) fte,
            MIN(doc_id) doc_id, MIN(source_page) source_page
       FROM fact_budget_line
      WHERE dept_id=$1 AND line_kind='expenditure' AND fiscal_year=$2
      GROUP BY line_description ORDER BY SUM(amount) DESC NULLS LAST LIMIT 12`,
    [cand.dept_id, fiscal_year]);
  const byFund = await query(
    `SELECT fund, SUM(amount) amount FROM fact_budget_line
      WHERE dept_id=$1 AND line_kind='expenditure' AND fiscal_year=$2 AND fund IS NOT NULL
      GROUP BY fund ORDER BY SUM(amount) DESC NULLS LAST`,
    [cand.dept_id, fiscal_year]);
  return {
    school_or_office: cand.canonical_name, dept_id: cand.dept_id, gov: "mps",
    fiscal_year, vintage: fiscal_year === 2027 ? "proposed" : "budget",
    total: num(tot.total), total_fte: num(tot.fte), line_count: Number(tot.lines),
    top_spending_by_object: byObject.map((r) => ({
      object: r.object, amount: num(r.amount), fte: num(r.fte), page: r.source_page,
    })),
    by_fund: byFund.map((r) => ({ fund: r.fund, amount: num(r.amount) })),
    citations: citations(byObject),
    note: "MPS schools/offices are sets of line items (no printed per-school total); "
      + "the total is their sum. Object = Nature of Expenditure (Teacher, Para, Benefits, …). "
      + "Enrollment/per-pupil is not in this dataset (see the summary document).",
  };
}

// County department budget: category rollups keyed by fiscal_year (each county
// fiscal year maps to exactly one printed column). No per-position ledger — only
// an FTE count. Provenance from the same category rows.
async function countyDeptBudget(cand: { dept_id: string; canonical_name: string }, fiscal_year: number) {
  const [agg] = await query(
    `SELECT
       MAX(amount) FILTER (WHERE line_description='Personnel Costs') AS personnel,
       MAX(amount) FILTER (WHERE line_description='Operations Costs') AS operations,
       MAX(amount) FILTER (WHERE line_description='Debt & Depreciation') AS debt,
       MAX(amount) FILTER (WHERE line_description='Interdepartmental Charges') AS interdept,
       MAX(amount) FILTER (WHERE line_description='Total Expenditures') AS total_expenditures,
       MAX(amount) FILTER (WHERE line_description='Total Revenues') AS total_revenues,
       MAX(amount) FILTER (WHERE line_description='Tax Levy') AS tax_levy,
       MAX(units)  FILTER (WHERE line_kind='fte' AND line_description ILIKE 'Full Time Pos%') AS fte
     FROM fact_budget_line
      WHERE dept_id=$1 AND fiscal_year=$2 AND line_kind IN ('category','fte')`,
    [cand.dept_id, fiscal_year]);
  const anchors = await query(
    `SELECT line_description, amount, source_page, doc_id FROM fact_budget_line
      WHERE dept_id=$1 AND fiscal_year=$2 AND line_kind='category'`, [cand.dept_id, fiscal_year]);
  const programs = await query(
    `SELECT DISTINCT division FROM fact_budget_line
      WHERE dept_id=$1 AND line_kind='program' AND division IS NOT NULL ORDER BY division`,
    [cand.dept_id]);
  return {
    department: cand.canonical_name, dept_id: cand.dept_id, gov: "county", fiscal_year,
    totals: {
      personnel_costs: num(agg.personnel), operations_costs: num(agg.operations),
      debt_and_depreciation: num(agg.debt), interdepartmental_charges: num(agg.interdept),
      total_expenditures: num(agg.total_expenditures),
      total_revenues: num(agg.total_revenues), tax_levy: num(agg.tax_levy),
    },
    fte: { full_time: num(agg.fte) },
    strategic_program_areas: programs.map((p) => p.division),
    citations: citations(anchors),
    note: "County departments report category rollups (no per-position ledger). "
      + "Personnel + Operations + Debt & Depreciation + Interdepartmental = Total Expenditures; "
      + "Total Expenditures − Total Revenues = Tax Levy.",
  };
}
