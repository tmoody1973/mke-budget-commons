import { query, guardSelect } from "../db.js";
import { citations, num } from "../citation.js";
import { type Gov } from "../helpers.js";
import { lookupGlossary } from "../glossary.js";

export async function runSql(a: { query: string; limit?: number }): Promise<{ sql: string; row_count: number; rows: any[] }> {
  const sql = guardSelect(a.query, a.limit ?? 200); // throws on invalid input
  try {
    const rows = await query(sql);
    return { sql, row_count: rows.length, rows };
  } catch (e: any) {
    throw new Error(`Query failed: ${e.message}`);
  }
}

export async function searchLineItems(a: { query: string; gov?: Gov; fiscal_year?: number; limit: number }): Promise<any> {
  const { query: q, gov, fiscal_year, limit } = a;
  // Current-vintage per government: city/county adopt budgets; MPS proposes.
  // Without a gov filter, allow both so nothing is invisible.
  const vintagePred = gov === "mps" ? "f.amount_kind='proposed'"
    : gov ? "f.amount_kind='adopted'"
    : "f.amount_kind IN ('adopted','proposed')";
  const where = ["f.search @@ plainto_tsquery('english',$1)", vintagePred];
  const params: any[] = [q];
  if (gov) { params.push(gov); where.push(`d.gov_id=$${params.length}`); }
  if (fiscal_year) { params.push(fiscal_year); where.push(`f.doc_id IN (SELECT doc_id FROM dim_document WHERE fiscal_year=$${params.length})`); }
  params.push(limit);
  const rows = await query(
    `SELECT f.line_id, d.canonical_name AS dept, f.division, f.line_description, f.line_kind,
            f.pay_range, f.amount, f.account, f.source_page, f.doc_id,
            ts_rank(f.search, plainto_tsquery('english',$1)) AS rank
       FROM fact_budget_line f JOIN dim_department d USING (dept_id)
      WHERE ${where.join(" AND ")}
      ORDER BY rank DESC, f.amount DESC NULLS LAST LIMIT $${params.length}`,
    params,
  );
  return {
    query: q, hits: rows.length,
    results: rows.map((r) => ({
      line_id: Number(r.line_id), department: r.dept, division: r.division, description: r.line_description,
      kind: r.line_kind, pay_range: r.pay_range, amount: num(r.amount), account: r.account, page: r.source_page,
    })),
    citations: citations(rows),
  };
}

export async function cite(a: { line_id: number }): Promise<any> {
  const { line_id } = a;
  const rows = await query(
    `SELECT f.*, doc.source_url, doc.fiscal_year, doc.doc_type, dep.canonical_name AS department
       FROM fact_budget_line f
       JOIN dim_document doc USING (doc_id)
       JOIN dim_department dep USING (dept_id)
      WHERE f.line_id=$1`, [line_id]);
  if (rows.length === 0) throw new Error(`No line with id ${line_id}.`);
  const r = rows[0];
  return {
    line_id, department: r.department, division: r.division, description: r.line_description,
    account: r.account, amount: num(r.amount), amount_kind: r.amount_kind, units: num(r.units),
    pay_range: r.pay_range, flags: r.flags,
    citation: { doc_id: r.doc_id, fiscal_year: r.fiscal_year, doc_type: r.doc_type,
                source_page: r.source_page, source_url: r.source_url },
  };
}

export async function reconciliationStatus(a: { doc_id?: string }): Promise<any> {
  const { doc_id } = a;
  const p = doc_id ? [doc_id] : [];
  const w = doc_id ? "WHERE doc_id=$1" : "";
  const counts = await query(
    `SELECT status, count(*) AS n FROM reconciliation_result ${w} GROUP BY status ORDER BY n DESC`, p);
  const findings = await query(
    `SELECT scope, printed_total, extracted_total, notes, status
       FROM reconciliation_result
      WHERE status IN ('source_inconsistency','open') ${doc_id ? "AND doc_id=$1" : ""}
      ORDER BY status, scope`, p);
  return {
    doc_id: doc_id ?? "all",
    summary: Object.fromEntries(counts.map((c) => [c.status, Number(c.n)])),
    findings: findings.map((f) => {
      const printed = num(f.printed_total), extracted = num(f.extracted_total);
      return {
        scope: f.scope, status: f.status, printed_total: printed, extracted_total: extracted,
        delta: printed != null && extracted != null ? extracted - printed : null, note: f.notes,
      };
    }),
  };
}

export function glossaryLookup(a: { term?: string }) {
  return lookupGlossary(a.term);
}

export async function getAmendments(): Promise<{ available: false; reason: string }> {
  return { available: false as const, reason: "Requires the amendment (file/markup) documents; not yet ingested." };
}
