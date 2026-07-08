import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { query, guardSelect } from "./db.js";
import { lookupGlossary } from "./glossary.js";

const server = new McpServer({ name: "mke-budget", version: "0.1.0" });

const ok = (payload: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
});
const fail = (message: string) => ({
  content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
  isError: true,
});

/** distinct {doc_id, source_page} across result rows */
function citations(rows: any[]): { doc_id: string; source_page: number }[] {
  const seen = new Set<string>();
  const out: { doc_id: string; source_page: number }[] = [];
  for (const r of rows) {
    if (r.doc_id == null || r.source_page == null) continue;
    const k = `${r.doc_id}:${r.source_page}`;
    if (!seen.has(k)) { seen.add(k); out.push({ doc_id: r.doc_id, source_page: r.source_page }); }
  }
  return out.slice(0, 25);
}

const num = (v: any) => (v == null ? null : Number(v));

/** Resolve a department name to a dept_id; returns candidates when ambiguous. */
async function resolveDept(gov: string, name: string) {
  const rows = await query(
    `SELECT DISTINCT d.dept_id, d.canonical_name
       FROM dim_department d LEFT JOIN dept_alias a USING (dept_id)
      WHERE d.gov_id = $1
        AND (d.canonical_name ILIKE $2 OR a.printed_name ILIKE $2 OR d.dept_id ILIKE $2)`,
    [gov, `%${name}%`],
  );
  return rows as { dept_id: string; canonical_name: string }[];
}

const VINTAGE: Record<string, string> = {
  adopted: "adopted", budget: "budget", actual: "actual",
  requested: "requested", proposed: "proposed", recommended: "recommended",
};

// A department's grand total, gov-agnostic. The city ledger prints it as an
// untyped reserved-code total (account NULL, line_kind 'total'); the county book
// prints it as the 'Total Expenditures' category row. A department only ever
// carries one of the two shapes, so this predicate is exact for both. `p` is an
// optional table-alias prefix (e.g. "f.").
const grandTotalPred = (p = "") =>
  `((${p}line_kind='total' AND ${p}account IS NULL)` +
  ` OR (${p}line_kind='category' AND ${p}line_description='Total Expenditures'))`;

// --------------------------------------------------------------------------- //
server.registerTool(
  "list_departments",
  {
    title: "List departments",
    description: "Departments for a government with their adopted grand totals.",
    inputSchema: { gov: z.enum(["city", "county", "mps"]).default("city"), fiscal_year: z.number().int().optional() },
  },
  async ({ gov, fiscal_year }) => {
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
    return ok({
      government: gov,
      total_label: gov === "mps" ? `FY${fiscal_year ?? 2027}` : "adopted",
      departments: rows.map((r) => ({
        dept_id: r.dept_id, name: r.canonical_name, total: num(r.total),
      })),
    });
  },
);

server.registerTool(
  "get_department_budget",
  {
    title: "Get department budget",
    description: "Reserved-code totals, FTE, divisions, and top expenditures for a department, with citations.",
    inputSchema: {
      dept: z.string(), gov: z.enum(["city", "county", "mps"]).default("city"),
      fiscal_year: z.number().int().optional(), doc_type: z.string().default("adopted"),
    },
  },
  async ({ dept, gov, fiscal_year, doc_type }) => {
    const cands = await resolveDept(gov, dept);
    if (cands.length === 0) return fail(`No department matches "${dept}".`);
    if (cands.length > 1) return ok({ ambiguous: true, candidates: cands });
    const dept_id = cands[0].dept_id;
    const vintage = VINTAGE[doc_type] ?? "adopted";
    const fy = fiscal_year ?? (gov === "mps" ? 2027 : 2026);

    // County chapters report category rollups, not the city's reserved-code
    // ledger — a different breakdown (Personnel/Operations/Debt/Interdepartmental
    // → Total Expenditures; Total Expenditures − Total Revenues = Tax Levy).
    if (gov === "county") return ok(await countyDeptBudget(cands[0], fy));
    // MPS: a school/office is a set of line items — sum them, and break down by
    // object (Teacher, Para, Benefits, …) and fund.
    if (gov === "mps") return ok(await mpsSchoolBudget(cands[0], fy));

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

    return ok({
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
    });
  },
);

server.registerTool(
  "search_line_items",
  {
    title: "Search line items",
    description: "Full-text search over line descriptions, ranked and cited.",
    inputSchema: {
      query: z.string(), gov: z.enum(["city", "county", "mps"]).optional(),
      fiscal_year: z.number().int().optional(), limit: z.number().int().max(50).default(20),
    },
  },
  async ({ query: q, gov, fiscal_year, limit }) => {
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
    return ok({
      query: q, hits: rows.length,
      results: rows.map((r) => ({
        line_id: Number(r.line_id), department: r.dept, division: r.division, description: r.line_description,
        kind: r.line_kind, pay_range: r.pay_range, amount: num(r.amount), account: r.account, page: r.source_page,
      })),
      citations: citations(rows),
    });
  },
);

server.registerTool(
  "get_positions",
  {
    title: "Get positions",
    description: "Position lines for a department: titles, pay ranges, FTE, footnote flags — cited.",
    inputSchema: {
      dept: z.string(), gov: z.enum(["city", "county", "mps"]).default("city"),
      fiscal_year: z.number().int().default(2026),
    },
  },
  async ({ dept, gov }) => {
    const cands = await resolveDept(gov, dept);
    if (cands.length === 0) return fail(`No department matches "${dept}".`);
    if (cands.length > 1) return ok({ ambiguous: true, candidates: cands });
    const rows = await query(
      `SELECT line_description, pay_range, units, flags, amount, division, source_page, doc_id
         FROM fact_budget_line
        WHERE dept_id=$1 AND line_kind='position' AND amount_kind='adopted'
        ORDER BY amount DESC NULLS LAST LIMIT 100`, [cands[0].dept_id]);
    const total_fte = rows.reduce((s, r) => s + Number(r.units ?? 0), 0);
    return ok({
      department: cands[0].canonical_name, position_rows: rows.length, total_units: total_fte,
      positions: rows.map((r) => ({
        title: r.line_description, pay_range: r.pay_range, units: num(r.units),
        salary: num(r.amount), division: r.division, flags: r.flags, page: r.source_page,
      })),
      citations: citations(rows),
    });
  },
);

server.registerTool(
  "cite",
  {
    title: "Cite a line",
    description: "Full provenance for a single budget line: document, page, and printed context.",
    inputSchema: { line_id: z.number().int() },
  },
  async ({ line_id }) => {
    const rows = await query(
      `SELECT f.*, doc.source_url, doc.fiscal_year, doc.doc_type, dep.canonical_name AS department
         FROM fact_budget_line f
         JOIN dim_document doc USING (doc_id)
         JOIN dim_department dep USING (dept_id)
        WHERE f.line_id=$1`, [line_id]);
    if (rows.length === 0) return fail(`No line with id ${line_id}.`);
    const r = rows[0];
    return ok({
      line_id, department: r.department, division: r.division, description: r.line_description,
      account: r.account, amount: num(r.amount), amount_kind: r.amount_kind, units: num(r.units),
      pay_range: r.pay_range, flags: r.flags,
      citation: { doc_id: r.doc_id, fiscal_year: r.fiscal_year, doc_type: r.doc_type,
                  source_page: r.source_page, source_url: r.source_url },
    });
  },
);

server.registerTool(
  "reconciliation_status",
  {
    title: "Reconciliation status",
    description: "Trust report: how the extracted data reconciles to the document's printed totals, with dispositions.",
    inputSchema: { doc_id: z.string().optional() },
  },
  async ({ doc_id }) => {
    const p = doc_id ? [doc_id] : [];
    const w = doc_id ? "WHERE doc_id=$1" : "";
    const counts = await query(
      `SELECT status, count(*) AS n FROM reconciliation_result ${w} GROUP BY status ORDER BY n DESC`, p);
    const findings = await query(
      `SELECT scope, printed_total, extracted_total, notes, status
         FROM reconciliation_result
        WHERE status IN ('source_inconsistency','open') ${doc_id ? "AND doc_id=$1" : ""}
        ORDER BY status, scope`, p);
    return ok({
      doc_id: doc_id ?? "all",
      summary: Object.fromEntries(counts.map((c) => [c.status, Number(c.n)])),
      findings: findings.map((f) => {
        const printed = num(f.printed_total), extracted = num(f.extracted_total);
        return {
          scope: f.scope, status: f.status, printed_total: printed, extracted_total: extracted,
          delta: printed != null && extracted != null ? extracted - printed : null, note: f.notes,
        };
      }),
    });
  },
);

server.registerTool(
  "run_sql",
  {
    title: "Run read-only SQL",
    description: "Escape hatch: a single read-only SELECT/WITH over the budget tables (auto-LIMITed, 5s timeout).",
    inputSchema: { query: z.string(), limit: z.number().int().max(1000).default(200) },
  },
  async ({ query: raw, limit }) => {
    let sql: string;
    try { sql = guardSelect(raw, limit); } catch (e: any) { return fail(e.message); }
    try {
      const rows = await query(sql);
      return ok({ sql, row_count: rows.length, rows });
    } catch (e: any) {
      return fail(`Query failed: ${e.message}`);
    }
  },
);

// Department rollup for one fiscal year. City/county: MAX over the printed
// department total (avoids double-counting a summary unit against its divisions).
// MPS: SUM the atomic line items (no printed per-school total exists).
async function deptYear(dept_id: string, year: number, gov = "city") {
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

const pct = (from: number | null, to: number | null) =>
  from && to != null ? Math.round(((to - from) / from) * 1000) / 10 : null;

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

server.registerTool(
  "compare_years",
  {
    title: "Compare years",
    description: "Department reserved-code totals for two fiscal years, with $ and % deltas. Cited.",
    inputSchema: {
      dept: z.string(), year_a: z.number().int(), year_b: z.number().int(),
      gov: z.enum(["city", "county", "mps"]).default("city"),
    },
  },
  async ({ dept, year_a, year_b, gov }) => {
    const cands = await resolveDept(gov, dept);
    if (cands.length === 0) return fail(`No department matches "${dept}".`);
    if (cands.length > 1) return ok({ ambiguous: true, candidates: cands });
    const id = cands[0].dept_id;
    const [A, B] = [await deptYear(id, year_a, gov), await deptYear(id, year_b, gov)];
    if (A.cites.length === 0 || B.cites.length === 0)
      return fail(`Missing data for ${A.cites.length === 0 ? year_a : year_b} — loaded years may differ.`);
    const line = (k: string) => {
      const from = num(A.a[k]), to = num(B.a[k]);
      return { [`fy${year_a}`]: from, [`fy${year_b}`]: to,
               delta: from != null && to != null ? to - from : null, delta_pct: pct(from, to) };
    };
    return ok({
      department: cands[0].canonical_name,
      grand_total: line("grand"), net_salaries: line("net_salaries"),
      fringe: line("fringe"), operating: line("operating"), equipment: line("equipment"),
      citations: citations([...A.cites, ...B.cites]),
    });
  },
);

const STAGE_ORDER = ["requested", "recommended", "proposed", "adopted"];

server.registerTool(
  "trace_adoption",
  {
    title: "Trace adoption",
    description: "A department's budget through the stages present for a fiscal year (requested → proposed/recommended → adopted), with stage deltas.",
    inputSchema: {
      dept: z.string(), fiscal_year: z.number().int(),
      gov: z.enum(["city", "county", "mps"]).default("city"),
    },
  },
  async ({ dept, fiscal_year, gov }) => {
    const cands = await resolveDept(gov, dept);
    if (cands.length === 0) return fail(`No department matches "${dept}".`);
    if (cands.length > 1) return ok({ ambiguous: true, candidates: cands });
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
    return ok({
      department: cands[0].canonical_name, fiscal_year, stages,
      note: stages.length <= 1 ? "Only one budget stage is loaded for this year so far." : undefined,
      citations: citations(present),
    });
  },
);

// The authoritative amount_kind for a given fiscal year (avoids counting the
// same 2026 rows from both the adopted book and the requested book's budget col).
const YEAR_KIND: Record<number, string> = { 2024: "actual", 2025: "budget", 2026: "adopted", 2027: "requested" };
// DPW divisions are already rolled up in the DPW-Summary unit — exclude them from
// citywide sums to avoid double-counting.
const ROLLUP_EXCLUDE = [
  "city-dpw-administrative-services-division",
  "city-dpw-infrastructure-services-division",
  "city-dpw-operations-division",
];

server.registerTool(
  "glossary",
  {
    title: "Glossary",
    description: "Plain-language explanations of budget codes, terms, footnotes, and vintages. Call with no term for the whole glossary.",
    inputSchema: { term: z.string().optional() },
  },
  async ({ term }) => ok(lookupGlossary(term)),
);

// County "where the money goes": the category breakdown (Personnel + Operations
// + Debt & Depreciation + Interdepartmental = Total Expenditures), per department
// or countywide. Reads category rows (line_kind='category'), so program rows and
// the non-departmental ledger chapters (no category summary) are excluded — the
// countywide figure is the sum of standard department chapters.
async function budgetBreakdownCounty(fiscal_year: number, dept?: string) {
  let where = "d.gov_id='county' AND f.fiscal_year=$1 AND f.line_kind='category'";
  const params: any[] = [fiscal_year];
  let label = "county departments";
  if (dept) {
    const cands = await resolveDept("county", dept);
    if (cands.length === 0) return fail(`No department matches "${dept}".`);
    if (cands.length > 1) return ok({ ambiguous: true, candidates: cands });
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
  if (!grand) return fail(`No expenditure total for ${label} in ${fiscal_year}.`);
  const part = (v: any) => { const n = num(v) ?? 0; return { amount: n, pct: Math.round((n / grand) * 1000) / 10 }; };
  return ok({
    scope: `county · ${label}`, fiscal_year, total_expenditures: grand,
    breakdown: {
      personnel: part(r.personnel), operations: part(r.operations),
      debt_and_depreciation: part(r.debt), interdepartmental_charges: part(r.interdept),
    },
    note: "County expenditures by category (Personnel + Operations + Debt & Depreciation + "
      + "Interdepartmental = Total Expenditures). Countywide excludes the non-departmental "
      + "ledger chapters, which carry no category summary.",
  });
}

// MPS "where the money goes": by object category (Nature of Expenditure), plus a
// people-costs rollup (salaries + benefits), district-wide or for one school/office.
async function budgetBreakdownMps(fiscal_year: number, dept?: string) {
  let where = "d.gov_id='mps' AND f.line_kind='expenditure' AND f.fiscal_year=$1";
  const params: any[] = [fiscal_year];
  let label = "district-wide";
  if (dept) {
    const cands = await resolveDept("mps", dept);
    if (cands.length === 0) return fail(`No MPS school/office matches "${dept}".`);
    if (cands.length > 1) return ok({ ambiguous: true, candidates: cands });
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
  if (!grand) return fail(`No MPS expenditures for ${label} in FY${fiscal_year}.`);
  const objects = await query(
    `SELECT f.line_description object, SUM(f.amount) amount
       FROM fact_budget_line f JOIN dim_department d USING (dept_id) WHERE ${where}
      GROUP BY f.line_description ORDER BY SUM(f.amount) DESC NULLS LAST LIMIT 12`, params);
  const part = (v: any) => { const n = num(v) ?? 0; return { amount: n, pct: Math.round((n / grand) * 1000) / 10 }; };
  const sal = num(t.salaries) ?? 0, ben = num(t.benefits) ?? 0;
  return ok({
    scope: `mps · ${label}`, fiscal_year, total: grand,
    people_costs: { salaries: part(sal), benefits: part(ben), other: part(grand - sal - ben) },
    top_objects: objects.map((r) => ({ object: r.object, ...part(r.amount) })),
    note: "People costs are approximated from object-category names (salaries + benefits). "
      + "Top objects are the largest Nature-of-Expenditure categories.",
  });
}

server.registerTool(
  "budget_breakdown",
  {
    title: "Budget breakdown",
    description: "Where the money goes: salaries / fringe / operating / equipment / special funds as $ and % of the total, for a department or citywide. Cited.",
    inputSchema: {
      gov: z.enum(["city", "county", "mps"]).default("city"),
      fiscal_year: z.number().int().optional(),
      dept: z.string().optional(),
    },
  },
  async ({ gov, fiscal_year, dept }) => {
    const fy = fiscal_year ?? (gov === "mps" ? 2027 : 2026);
    if (gov === "county") return budgetBreakdownCounty(fy, dept);
    if (gov === "mps") return budgetBreakdownMps(fy, dept);

    let where = "d.gov_id=$1 AND f.fiscal_year=$2 AND f.line_kind='total'";
    fiscal_year = fy;
    const params: any[] = [gov, fiscal_year];
    let label = `${gov} citywide`;
    if (dept) {
      const cands = await resolveDept(gov, dept);
      if (cands.length === 0) return fail(`No department matches "${dept}".`);
      if (cands.length > 1) return ok({ ambiguous: true, candidates: cands });
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
    if (!grand) return fail(`No budget total for ${label} in ${fiscal_year}.`);
    const part = (v: any) => { const n = num(v) ?? 0; return { amount: n, pct: Math.round((n / grand) * 1000) / 10 }; };
    const sal = num(r.sal) ?? 0, fr = num(r.fringe) ?? 0, op = num(r.operating) ?? 0, eq = num(r.equipment) ?? 0;
    return ok({
      scope: label, fiscal_year, total: grand,
      breakdown: {
        salaries: part(sal), fringe_benefits: part(fr), operating: part(op),
        equipment: part(eq), special_funds: part(grand - sal - fr - op - eq),
      },
      note: "People costs = salaries + fringe. Special funds are grant/enterprise appropriations outside the four reserved categories.",
    });
  },
);

server.registerTool(
  "biggest_changes",
  {
    title: "Biggest changes between years",
    description: "The departments whose budgets changed the most between two fiscal years — the story-finder. Ranked by $ or %, with citations.",
    inputSchema: {
      gov: z.enum(["city", "county", "mps"]).default("city"),
      year_a: z.number().int(), year_b: z.number().int(),
      measure: z.enum(["dollars", "percent"]).default("dollars"),
      direction: z.enum(["up", "down", "both"]).default("both"),
      limit: z.number().int().max(40).default(12),
    },
  },
  async ({ gov, year_a, year_b, measure, direction, limit }) => {
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
        const a = Number(r.a), b = Number(r.b);
        return { department: r.dept, [`fy${year_a}`]: a, [`fy${year_b}`]: b,
                 delta: b - a, delta_pct: Math.round(((b - a) / a) * 1000) / 10,
                 doc_id: r.doc_id, source_page: r.page };
      });
    if (direction === "up") items = items.filter((i) => i.delta > 0);
    if (direction === "down") items = items.filter((i) => i.delta < 0);
    const key = measure === "percent" ? "delta_pct" : "delta";
    items.sort((x: any, y: any) => Math.abs(y[key]) - Math.abs(x[key]));
    const top = items.slice(0, limit);
    return ok({
      gov, comparing: `fy${year_a} → fy${year_b}`, measure, direction,
      results: top.map(({ doc_id, source_page, ...rest }) => rest),
      citations: citations(top),
    });
  },
);

server.registerTool(
  "find_positions",
  {
    title: "Find positions",
    description: "Search city positions by title, minimum salary, or footnote flag (e.g. grant-funded). 'Who earns over $150K', 'grant-funded positions'. Cited.",
    inputSchema: {
      query: z.string().optional(), gov: z.enum(["city", "county", "mps"]).default("city"),
      fiscal_year: z.number().int().default(2026),
      min_salary: z.number().optional(), flag: z.string().optional(),
      limit: z.number().int().max(50).default(25),
    },
  },
  async ({ query: q, gov, fiscal_year, min_salary, flag, limit }) => {
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
    return ok({
      fiscal_year, matched: rows.length,
      positions: rows.map((r) => ({
        line_id: Number(r.line_id), title: r.line_description, department: r.dept, division: r.division,
        pay_range: r.pay_range, salary_per_position: num(r.per_position), count: num(r.units),
        budgeted_total: num(r.amount), flags: r.flags, page: r.source_page,
      })),
      citations: citations(rows),
    });
  },
);

// --- MPS-specific tools (parents/students, journalists) --------------------- //

server.registerTool(
  "compare_schools",
  {
    title: "Compare schools (MPS)",
    description: "Side-by-side FY2027 proposed budget, staffing (FTE), and object breakdown for two MPS schools or offices — the school-choice / equity lens. Cited.",
    inputSchema: { school_a: z.string(), school_b: z.string(), fiscal_year: z.number().int().default(2027) },
  },
  async ({ school_a, school_b, fiscal_year }) => {
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
    const [a, b] = [await side(school_a), await side(school_b)];
    const delta = (a.total != null && b.total != null) ? { total: b.total - a.total, pct: pct(a.total, b.total) } : null;
    return ok({ fiscal_year: fy, a, b, delta,
      note: "MPS school totals are the sum of their line items; enrollment/per-pupil is not in this dataset." });
  },
);

server.registerTool(
  "mps_fund_summary",
  {
    title: "MPS fund summary",
    description: "MPS district-wide money by fund, total expenditures, total revenue, and the planned surplus / use of fund balance — the fiscal-health view. FY2027 proposed by default.",
    inputSchema: { fiscal_year: z.number().int().default(2027) },
  },
  async ({ fiscal_year }) => {
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
    return ok({
      government: "mps", fiscal_year: fy, vintage: fy === 2027 ? "proposed" : "budget",
      total_expenditures: exp, total_revenue: rev, total_fte: num(tot.fte),
      surplus_or_fund_balance_use: (exp != null && rev != null) ? Math.round((rev - exp) * 100) / 100 : null,
      by_fund: funds.map((r) => ({ fund: r.fund, amount: num(r.amount) })),
      note: "Fund = account-code segment 2. Revenue over expenditure is a planned surplus / use of fund balance. "
        + "Excludes the Recreation Extension rows that sit outside the printed grand total.",
    });
  },
);

// Tools that need data not yet ingested — declared so agents see the roadmap.
for (const [name, need] of [
  ["get_amendments", "the amendment (file/markup) documents"],
] as const) {
  server.registerTool(
    name,
    { title: name, description: `(Not yet available — needs ${need}.)`, inputSchema: {} },
    async () => ok({ available: false, reason: `Requires ${need}; not yet ingested.` }),
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("mke-budget MCP server ready (stdio).");
