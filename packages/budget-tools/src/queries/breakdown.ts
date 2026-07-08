import { query } from "../db";
import { citations, num } from "../citation";
import { resolveDept, grandTotalPred, ROLLUP_EXCLUDE, type Gov } from "../helpers";
import type { Ambiguous, CityBreakdown, CountyBreakdown, MpsBreakdown } from "../types";

// County "where the money goes": the category breakdown (Personnel + Operations
// + Debt & Depreciation + Interdepartmental = Total Expenditures), per department
// or countywide. Reads category rows (line_kind='category'), so program rows and
// the non-departmental ledger chapters (no category summary) are excluded — the
// countywide figure is the sum of standard department chapters.
async function budgetBreakdownCounty(fiscal_year: number, dept?: string): Promise<CountyBreakdown | Ambiguous> {
  let where = "d.gov_id='county' AND f.fiscal_year=$1 AND f.line_kind='category'";
  const params: any[] = [fiscal_year];
  let label = "county departments";
  if (dept) {
    const cands = await resolveDept("county", dept);
    if (cands.length === 0) throw new Error(`No department matches "${dept}".`);
    if (cands.length > 1) return { ambiguous: true, candidates: cands };
    params.push(cands[0].dept_id);
    where += ` AND f.dept_id=$${params.length}`;
    label = cands[0].canonical_name;
  }
  const [r] = await query(
    `WITH per_dept AS (
       SELECT f.dept_id,
         MAX(f.amount) FILTER (WHERE f.line_description='Personnel Costs') personnel,
         MAX(f.amount) FILTER (WHERE f.line_description='Operations Costs') operations,
         MAX(f.amount) FILTER (WHERE f.line_description='Debt & Depreciation') debt,
         MAX(f.amount) FILTER (WHERE f.line_description='Interdepartmental Charges') interdept,
         MAX(f.amount) FILTER (WHERE f.line_description='Total Expenditures') total
       FROM fact_budget_line f JOIN dim_department d USING (dept_id)
       WHERE ${where} GROUP BY f.dept_id)
     SELECT SUM(personnel) personnel, SUM(operations) operations, SUM(debt) debt,
            SUM(interdept) interdept, SUM(total) total FROM per_dept`,
    params);
  const grand = num(r.total);
  if (!grand) throw new Error(`No expenditure total for ${label} in ${fiscal_year}.`);
  const part = (v: any) => { const n = num(v) ?? 0; return { amount: n, pct: Math.round((n / grand) * 1000) / 10 }; };
  const prov = await query(
    `SELECT DISTINCT f.doc_id, f.source_page FROM fact_budget_line f
       JOIN dim_department d USING (dept_id) WHERE ${where}`, params);
  return {
    scope: `county · ${label}`, fiscal_year, total_expenditures: grand,
    breakdown: {
      personnel: part(r.personnel), operations: part(r.operations),
      debt_and_depreciation: part(r.debt), interdepartmental_charges: part(r.interdept),
    },
    citations: citations(prov),
    note: "County expenditures by category (Personnel + Operations + Debt & Depreciation + "
      + "Interdepartmental = Total Expenditures). Countywide excludes the non-departmental "
      + "ledger chapters, which carry no category summary.",
  };
}

// MPS "where the money goes": by object category (Nature of Expenditure), plus a
// people-costs rollup (salaries + benefits), district-wide or for one school/office.
async function budgetBreakdownMps(fiscal_year: number, dept?: string): Promise<MpsBreakdown | Ambiguous> {
  let where = "d.gov_id='mps' AND f.line_kind='expenditure' AND f.fiscal_year=$1";
  const params: any[] = [fiscal_year];
  let label = "district-wide";
  if (dept) {
    const cands = await resolveDept("mps", dept);
    if (cands.length === 0) throw new Error(`No MPS school/office matches "${dept}".`);
    if (cands.length > 1) return { ambiguous: true, candidates: cands };
    params.push(cands[0].dept_id);
    where += ` AND f.dept_id=$${params.length}`;
    label = cands[0].canonical_name;
  }
  const [t] = await query(
    `SELECT SUM(f.amount) total,
            SUM(f.amount) FILTER (WHERE f.line_description ~* 'TEACHER|PARA|SALAR|ASST|AIDE|SUBSTITUTE|CLERK|SECRETARY|PRINCIPAL') salaries,
            SUM(f.amount) FILTER (WHERE f.line_description ~* 'BENEFIT|OPEB|RETIRE|INSURANCE|FICA|PENSION') benefits
       FROM fact_budget_line f JOIN dim_department d USING (dept_id) WHERE ${where}`, params);
  const grand = num(t.total);
  if (!grand) throw new Error(`No MPS expenditures for ${label} in FY${fiscal_year}.`);
  const objects = await query(
    `SELECT f.line_description object, SUM(f.amount) amount
       FROM fact_budget_line f JOIN dim_department d USING (dept_id) WHERE ${where}
      GROUP BY f.line_description ORDER BY SUM(f.amount) DESC NULLS LAST LIMIT 12`, params);
  const part = (v: any) => { const n = num(v) ?? 0; return { amount: n, pct: Math.round((n / grand) * 1000) / 10 }; };
  const sal = num(t.salaries) ?? 0, ben = num(t.benefits) ?? 0;
  const prov = await query(
    `SELECT DISTINCT f.doc_id, f.source_page FROM fact_budget_line f
       JOIN dim_department d USING (dept_id) WHERE ${where}`, params);
  return {
    scope: `mps · ${label}`, fiscal_year, total: grand,
    people_costs: { salaries: part(sal), benefits: part(ben), other: part(grand - sal - ben) },
    top_objects: objects.map((r) => ({ object: r.object, ...part(r.amount) })),
    citations: citations(prov),
    note: "People costs are approximated from object-category names (salaries + benefits). "
      + "Top objects are the largest Nature-of-Expenditure categories.",
  };
}

export async function budgetBreakdown(a: { gov: Gov; fiscal_year?: number; dept?: string }): Promise<CityBreakdown | CountyBreakdown | MpsBreakdown | Ambiguous> {
  const { gov, dept } = a;
  const fy = a.fiscal_year ?? (gov === "mps" ? 2027 : 2026);
  if (gov === "county") return budgetBreakdownCounty(fy, dept);
  if (gov === "mps") return budgetBreakdownMps(fy, dept);

  let where = "d.gov_id=$1 AND f.fiscal_year=$2 AND f.line_kind='total'";
  const fiscal_year = fy;
  const params: any[] = [gov, fiscal_year];
  let label = `${gov} citywide`;
  if (dept) {
    const cands = await resolveDept(gov, dept);
    if (cands.length === 0) throw new Error(`No department matches "${dept}".`);
    if (cands.length > 1) return { ambiguous: true, candidates: cands };
    params.push(cands[0].dept_id);
    where += ` AND f.dept_id=$${params.length}`;
    label = cands[0].canonical_name;
  } else {
    where += ` AND f.dept_id <> ALL($${params.length + 1})`;
    params.push(ROLLUP_EXCLUDE);
  }
  // per-department MAX (rollup) then sum across departments for citywide
  const [r] = await query(
    `WITH per_dept AS (
       SELECT f.dept_id,
         MAX(f.amount) FILTER (WHERE f.account IS NULL) AS grand,
         MAX(f.amount) FILTER (WHERE f.account='006000') AS sal,
         MAX(f.amount) FILTER (WHERE f.account='006100') AS fringe,
         MAX(f.amount) FILTER (WHERE f.account='006300') AS operating,
         MAX(f.amount) FILTER (WHERE f.account='006800') AS equipment
       FROM fact_budget_line f JOIN dim_department d USING (dept_id)
       WHERE ${where} GROUP BY f.dept_id)
     SELECT SUM(grand) grand, SUM(sal) sal, SUM(fringe) fringe,
            SUM(operating) operating, SUM(equipment) equipment FROM per_dept`,
    params,
  );
  const grand = num(r.grand);
  if (!grand) throw new Error(`No budget total for ${label} in ${fiscal_year}.`);
  const part = (v: any) => { const n = num(v) ?? 0; return { amount: n, pct: Math.round((n / grand) * 1000) / 10 }; };
  const sal = num(r.sal) ?? 0, fr = num(r.fringe) ?? 0, op = num(r.operating) ?? 0, eq = num(r.equipment) ?? 0;
  const prov = await query(
    `SELECT DISTINCT f.doc_id, f.source_page FROM fact_budget_line f
       JOIN dim_department d USING (dept_id) WHERE ${where}`, params);
  return {
    scope: label, fiscal_year, total: grand,
    breakdown: {
      salaries: part(sal), fringe_benefits: part(fr), operating: part(op),
      equipment: part(eq), special_funds: part(grand - sal - fr - op - eq),
    },
    citations: citations(prov),
    note: "People costs = salaries + fringe. Special funds are grant/enterprise appropriations outside the four reserved categories.",
  };
}
