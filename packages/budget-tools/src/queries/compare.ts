import { query } from "../db.js";
import { citations, num } from "../citation.js";
import { resolveDept, grandTotalPred, deptYear, pct, STAGE_ORDER, type Gov } from "../helpers.js";
import type { Ambiguous, CompareYears, TraceAdoption, BiggestChanges } from "../types.js";

export async function compareYears(a: { dept: string; year_a: number; year_b: number; gov: Gov }): Promise<CompareYears | Ambiguous> {
  const { dept, year_a, year_b, gov } = a;
  const cands = await resolveDept(gov, dept);
  if (cands.length === 0) throw new Error(`No department matches "${dept}".`);
  if (cands.length > 1) return { ambiguous: true, candidates: cands };
  const id = cands[0].dept_id;
  const [A, B] = [await deptYear(id, year_a, gov), await deptYear(id, year_b, gov)];
  if (A.cites.length === 0 || B.cites.length === 0)
    throw new Error(`Missing data for ${A.cites.length === 0 ? year_a : year_b} — loaded years may differ.`);
  const line = (k: string) => {
    const from = num(A.a[k]), to = num(B.a[k]);
    return { [`fy${year_a}`]: from, [`fy${year_b}`]: to,
             delta: from != null && to != null ? to - from : null, delta_pct: pct(from, to) };
  };
  return {
    department: cands[0].canonical_name,
    grand_total: line("grand"), net_salaries: line("net_salaries"),
    fringe: line("fringe"), operating: line("operating"), equipment: line("equipment"),
    citations: citations([...A.cites, ...B.cites]),
  };
}

export async function traceAdoption(a: { dept: string; fiscal_year: number; gov: Gov }): Promise<TraceAdoption | Ambiguous> {
  const { dept, fiscal_year, gov } = a;
  const cands = await resolveDept(gov, dept);
  if (cands.length === 0) throw new Error(`No department matches "${dept}".`);
  if (cands.length > 1) return { ambiguous: true, candidates: cands };
  const rows = await query(
    `SELECT amount_kind, MAX(amount) AS grand, MIN(doc_id) AS doc_id, MIN(source_page) AS source_page
       FROM fact_budget_line
      WHERE dept_id=$1 AND fiscal_year=$2 AND ${grandTotalPred()}
      GROUP BY amount_kind`, [cands[0].dept_id, fiscal_year]);
  const present = STAGE_ORDER
    .map((k) => rows.find((r) => r.amount_kind === k))
    .filter(Boolean) as any[];
  let prev: number | null = null;
  const stages = present.map((r) => {
    const g = num(r.grand);
    const step = { stage: r.amount_kind, grand_total: g,
                   change_from_prev: prev != null && g != null ? g - prev : null };
    prev = g;
    return step;
  });
  return {
    department: cands[0].canonical_name, fiscal_year, stages,
    note: stages.length <= 1 ? "Only one budget stage is loaded for this year so far." : undefined,
    citations: citations(present),
  };
}

export async function biggestChanges(a: {
  gov: Gov; year_a: number; year_b: number;
  measure: "dollars" | "percent"; direction: "up" | "down" | "both"; limit: number;
}): Promise<BiggestChanges> {
  const { gov, year_a, year_b, measure, direction, limit } = a;
  // MPS totals are SUM-over-line-items; city/county are MAX-over-printed-total.
  const yearAgg = (yr: string) =>
    gov === "mps"
      ? `SUM(f.amount) FILTER (WHERE f.line_kind='expenditure' AND f.fiscal_year=${yr})`
      : `MAX(f.amount) FILTER (WHERE ${grandTotalPred("f.")} AND f.fiscal_year=${yr})`;
  const yearPred = gov === "mps"
    ? `f.line_kind='expenditure' AND f.fiscal_year=$3`
    : `${grandTotalPred("f.")} AND f.fiscal_year=$3`;
  const rows = await query(
    `SELECT d.canonical_name AS dept,
       ${yearAgg("$2")} a,
       ${yearAgg("$3")} b,
       MIN(f.source_page) FILTER (WHERE ${yearPred}) page,
       MIN(f.doc_id)      FILTER (WHERE ${yearPred}) doc_id
     FROM fact_budget_line f JOIN dim_department d USING (dept_id)
     WHERE d.gov_id=$1 GROUP BY d.canonical_name`, [gov, year_a, year_b]);
  let items = rows
    .filter((r) => r.a != null && r.b != null)
    .map((r) => {
      const av = Number(r.a), bv = Number(r.b);
      return { department: r.dept, [`fy${year_a}`]: av, [`fy${year_b}`]: bv,
               delta: bv - av, delta_pct: Math.round(((bv - av) / av) * 1000) / 10,
               doc_id: r.doc_id, source_page: r.page };
    });
  if (direction === "up") items = items.filter((i) => i.delta > 0);
  if (direction === "down") items = items.filter((i) => i.delta < 0);
  const key = measure === "percent" ? "delta_pct" : "delta";
  items.sort((x: any, y: any) => Math.abs(y[key]) - Math.abs(x[key]));
  const top = items.slice(0, limit);
  return {
    gov, comparing: `fy${year_a} → fy${year_b}`, measure, direction,
    results: top.map(({ doc_id, source_page, ...rest }) => rest),
    citations: citations(top),
  };
}
