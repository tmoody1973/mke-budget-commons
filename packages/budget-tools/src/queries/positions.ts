import { query } from "../db.js";
import { citations, num } from "../citation.js";
import { resolveDept, YEAR_KIND, type Gov } from "../helpers.js";
import type { Ambiguous, Positions, FindPositions } from "../types.js";

export async function getPositions(a: { dept: string; gov: Gov; fiscal_year?: number }): Promise<Positions | Ambiguous> {
  const { dept, gov } = a;
  const cands = await resolveDept(gov, dept);
  if (cands.length === 0) throw new Error(`No department matches "${dept}".`);
  if (cands.length > 1) return { ambiguous: true, candidates: cands };
  const rows = await query(
    `SELECT line_description, pay_range, units, flags, amount, division, source_page, doc_id
       FROM fact_budget_line
      WHERE dept_id=$1 AND line_kind='position' AND amount_kind='adopted'
      ORDER BY amount DESC NULLS LAST LIMIT 100`, [cands[0].dept_id]);
  const total_fte = rows.reduce((s, r) => s + Number(r.units ?? 0), 0);
  return {
    department: cands[0].canonical_name, position_rows: rows.length, total_units: total_fte,
    positions: rows.map((r) => ({
      title: r.line_description, pay_range: r.pay_range, units: num(r.units),
      salary: num(r.amount), division: r.division, flags: r.flags, page: r.source_page,
    })),
    citations: citations(rows),
  };
}

export async function findPositions(a: {
  query?: string; gov: Gov; fiscal_year: number;
  min_salary?: number; flag?: string; limit: number;
}): Promise<FindPositions> {
  const { query: q, gov, fiscal_year, min_salary, flag, limit } = a;
  const kind = YEAR_KIND[fiscal_year] ?? "adopted";
  const where = ["f.line_kind='position'", "d.gov_id=$1", "f.fiscal_year=$2", "f.amount_kind=$3",
    // exclude wrapped-position continuation rows whose title is only footnote codes
    "(f.line_description ~ ' ' OR f.line_description ~ '[a-z]')"];
  const params: any[] = [gov, fiscal_year, kind];
  if (q) { params.push(q); where.push(`f.search @@ plainto_tsquery('english',$${params.length})`); }
  // A position line can budget several incumbents; per-position salary is amount/units.
  if (min_salary != null) { params.push(min_salary); where.push(`f.amount / NULLIF(f.units,0) >= $${params.length}`); }
  if (flag) { params.push(flag); where.push(`$${params.length} = ANY(f.flags)`); }
  params.push(limit);
  const rows = await query(
    `SELECT f.line_id, d.canonical_name AS dept, f.division, f.line_description, f.pay_range,
            f.amount, f.units, f.flags, f.source_page, f.doc_id,
            f.amount / NULLIF(f.units,0) AS per_position
       FROM fact_budget_line f JOIN dim_department d USING (dept_id)
      WHERE ${where.join(" AND ")}
      ORDER BY per_position DESC NULLS LAST LIMIT $${params.length}`, params);
  return {
    fiscal_year, matched: rows.length,
    positions: rows.map((r) => ({
      line_id: Number(r.line_id), title: r.line_description, department: r.dept, division: r.division,
      pay_range: r.pay_range, salary_per_position: num(r.per_position), count: num(r.units),
      budgeted_total: num(r.amount), flags: r.flags, page: r.source_page,
    })),
    citations: citations(rows),
  };
}
