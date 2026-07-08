import { query } from "../db.js";
import { citations, num } from "../citation.js";
import { resolveDept, pct } from "../helpers.js";

export async function compareSchools(a: { school_a: string; school_b: string; fiscal_year: number }): Promise<any> {
  const { school_a, school_b, fiscal_year } = a;
  const fy = fiscal_year === 2026 ? 2026 : 2027;
  const side = async (name: string) => {
    const c = await resolveDept("mps", name);
    if (c.length === 0) return { query: name, error: `No MPS school/office matches "${name}".` };
    if (c.length > 1) return { query: name, ambiguous: c.map((x) => x.canonical_name).slice(0, 8) };
    const [t] = await query(
      `SELECT SUM(amount) total, SUM(units) fte, COUNT(*) lines FROM fact_budget_line
        WHERE dept_id=$1 AND line_kind='expenditure' AND fiscal_year=$2`, [c[0].dept_id, fy]);
    const top = await query(
      `SELECT line_description object, SUM(amount) amount FROM fact_budget_line
        WHERE dept_id=$1 AND line_kind='expenditure' AND fiscal_year=$2
        GROUP BY line_description ORDER BY SUM(amount) DESC NULLS LAST LIMIT 5`, [c[0].dept_id, fy]);
    return {
      name: c[0].canonical_name, total: num(t.total), fte: num(t.fte), line_count: Number(t.lines),
      top_objects: top.map((r) => ({ object: r.object, amount: num(r.amount) })),
    };
  };
  const [a1, b1] = [await side(school_a), await side(school_b)];
  const delta = ((a1 as any).total != null && (b1 as any).total != null)
    ? { total: (b1 as any).total - (a1 as any).total, pct: pct((a1 as any).total, (b1 as any).total) }
    : null;
  return { fiscal_year: fy, a: a1, b: b1, delta,
    note: "MPS school totals are the sum of their line items; enrollment/per-pupil is not in this dataset." };
}

export async function mpsFundSummary(a: { fiscal_year: number }): Promise<any> {
  const { fiscal_year } = a;
  const fy = fiscal_year === 2026 ? 2026 : 2027;
  const funds = await query(
    `SELECT f.fund, SUM(f.amount) amount FROM fact_budget_line f JOIN dim_department d USING (dept_id)
      WHERE d.gov_id='mps' AND f.fund IS NOT NULL AND f.line_kind='expenditure' AND f.fiscal_year=$1
      GROUP BY f.fund ORDER BY SUM(f.amount) DESC NULLS LAST`, [fy]);
  const [tot] = await query(
    `SELECT
       SUM(amount) FILTER (WHERE f.line_kind='expenditure') exp,
       SUM(amount) FILTER (WHERE f.line_kind='revenue') rev,
       SUM(units)  FILTER (WHERE f.line_kind='expenditure') fte
     FROM fact_budget_line f JOIN dim_department d USING (dept_id)
    WHERE d.gov_id='mps' AND f.fiscal_year=$1`, [fy]);
  const exp = num(tot.exp), rev = num(tot.rev);
  return {
    government: "mps", fiscal_year: fy, vintage: fy === 2027 ? "proposed" : "budget",
    total_expenditures: exp, total_revenue: rev, total_fte: num(tot.fte),
    surplus_or_fund_balance_use: (exp != null && rev != null) ? Math.round((rev - exp) * 100) / 100 : null,
    by_fund: funds.map((r) => ({ fund: r.fund, amount: num(r.amount) })),
    note: "Fund = account-code segment 2. Revenue over expenditure is a planned surplus / use of fund balance. "
      + "Excludes the Recreation Extension rows that sit outside the printed grand total.",
  };
}

export async function perPupilRanking(a: {
  fiscal_year: number; order: "highest" | "lowest"; min_enrollment: number; limit: number;
}): Promise<any> {
  const { fiscal_year, order, min_enrollment, limit } = a;
  const fy = fiscal_year === 2026 ? 2026 : 2027;
  const rows = await query(
    `SELECT school_name school, enrollment, budget, fte, per_pupil, doc_id, source_page
       FROM fact_school WHERE fiscal_year=$1 AND per_pupil IS NOT NULL`, [fy]);
  const schools = rows
    .map((r) => ({
      school: r.school, enrollment: num(r.enrollment), budget: num(r.budget),
      fte: num(r.fte), per_pupil: num(r.per_pupil),
      doc_id: r.doc_id, source_page: r.source_page,
    }))
    .filter((s) => s.per_pupil != null && (s.enrollment ?? 0) >= min_enrollment);
  schools.sort((x, y) => order === "highest" ? y.per_pupil! - x.per_pupil! : x.per_pupil! - y.per_pupil!);
  const top = schools.slice(0, limit);
  const ppVals = schools.map((s) => s.per_pupil!).sort((x, y) => x - y);
  return {
    fiscal_year: fy, order, min_enrollment, schools_ranked: schools.length,
    district_median_per_pupil: ppVals.length ? ppVals[Math.floor(ppVals.length / 2)] : null,
    results: top.map(({ doc_id, source_page, ...rest }) => rest),
    citations: citations(top),
    note: "Per pupil = school-controlled budget ÷ projected enrollment. Small specialty/"
      + "alternative schools naturally sit high (tiny denominators) — use min_enrollment to "
      + "focus on comprehensive schools. School budgets exclude central/districtwide costs.",
  };
}
