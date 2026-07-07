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

// --------------------------------------------------------------------------- //
server.registerTool(
  "list_departments",
  {
    title: "List departments",
    description: "Departments for a government with their adopted grand totals.",
    inputSchema: { gov: z.enum(["city", "county"]).default("city"), fiscal_year: z.number().int().default(2026) },
  },
  async ({ gov }) => {
    // MAX, not SUM: a department's summary/rollup unit already equals the sum of
    // its divisions, so MAX gives the whole-department total without double-count.
    const rows = await query(
      `SELECT d.dept_id, d.canonical_name,
              MAX(f.amount) FILTER (WHERE f.line_kind='total' AND f.account IS NULL
                                      AND f.amount_kind='adopted') AS adopted_total
         FROM dim_department d JOIN fact_budget_line f USING (dept_id)
        WHERE d.gov_id = $1
        GROUP BY 1,2 ORDER BY adopted_total DESC NULLS LAST`,
      [gov],
    );
    return ok({
      government: gov,
      departments: rows.map((r) => ({
        dept_id: r.dept_id, name: r.canonical_name, adopted_total: num(r.adopted_total),
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
      dept: z.string(), gov: z.enum(["city", "county"]).default("city"),
      fiscal_year: z.number().int().default(2026), doc_type: z.string().default("adopted"),
    },
  },
  async ({ dept, gov, doc_type }) => {
    const cands = await resolveDept(gov, dept);
    if (cands.length === 0) return fail(`No department matches "${dept}".`);
    if (cands.length > 1) return ok({ ambiguous: true, candidates: cands });
    const dept_id = cands[0].dept_id;
    const vintage = VINTAGE[doc_type] ?? "adopted";

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
      query: z.string(), gov: z.enum(["city", "county"]).optional(),
      fiscal_year: z.number().int().optional(), limit: z.number().int().max(50).default(20),
    },
  },
  async ({ query: q, gov, fiscal_year, limit }) => {
    const where = ["f.search @@ plainto_tsquery('english',$1)", "f.amount_kind='adopted'"];
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
      dept: z.string(), gov: z.enum(["city", "county"]).default("city"),
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

// Department rollup (reserved-code totals) for one fiscal year — MAX avoids
// double-counting a summary unit against its divisions.
async function deptYear(dept_id: string, year: number) {
  const [a] = await query(
    `SELECT
       MAX(amount) FILTER (WHERE account IS NULL) AS grand,
       MAX(amount) FILTER (WHERE account='006000') AS net_salaries,
       MAX(amount) FILTER (WHERE account='006100') AS fringe,
       MAX(amount) FILTER (WHERE account='006300') AS operating,
       MAX(amount) FILTER (WHERE account='006800') AS equipment
     FROM fact_budget_line WHERE dept_id=$1 AND fiscal_year=$2 AND line_kind='total'`,
    [dept_id, year],
  );
  const cites = await query(
    `SELECT DISTINCT doc_id, source_page FROM fact_budget_line
      WHERE dept_id=$1 AND fiscal_year=$2 AND line_kind='total' AND account IS NULL LIMIT 5`,
    [dept_id, year]);
  return { a, cites };
}

const pct = (from: number | null, to: number | null) =>
  from && to != null ? Math.round(((to - from) / from) * 1000) / 10 : null;

server.registerTool(
  "compare_years",
  {
    title: "Compare years",
    description: "Department reserved-code totals for two fiscal years, with $ and % deltas. Cited.",
    inputSchema: {
      dept: z.string(), year_a: z.number().int(), year_b: z.number().int(),
      gov: z.enum(["city", "county"]).default("city"),
    },
  },
  async ({ dept, year_a, year_b, gov }) => {
    const cands = await resolveDept(gov, dept);
    if (cands.length === 0) return fail(`No department matches "${dept}".`);
    if (cands.length > 1) return ok({ ambiguous: true, candidates: cands });
    const id = cands[0].dept_id;
    const [A, B] = [await deptYear(id, year_a), await deptYear(id, year_b)];
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
      gov: z.enum(["city", "county"]).default("city"),
    },
  },
  async ({ dept, fiscal_year, gov }) => {
    const cands = await resolveDept(gov, dept);
    if (cands.length === 0) return fail(`No department matches "${dept}".`);
    if (cands.length > 1) return ok({ ambiguous: true, candidates: cands });
    const rows = await query(
      `SELECT amount_kind, MAX(amount) AS grand, MIN(doc_id) AS doc_id, MIN(source_page) AS source_page
         FROM fact_budget_line
        WHERE dept_id=$1 AND fiscal_year=$2 AND line_kind='total' AND account IS NULL
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

server.registerTool(
  "budget_breakdown",
  {
    title: "Budget breakdown",
    description: "Where the money goes: salaries / fringe / operating / equipment / special funds as $ and % of the total, for a department or citywide. Cited.",
    inputSchema: {
      gov: z.enum(["city", "county"]).default("city"),
      fiscal_year: z.number().int().default(2026),
      dept: z.string().optional(),
    },
  },
  async ({ gov, fiscal_year, dept }) => {
    let where = "d.gov_id=$1 AND f.fiscal_year=$2 AND f.line_kind='total'";
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
      gov: z.enum(["city", "county"]).default("city"),
      year_a: z.number().int(), year_b: z.number().int(),
      measure: z.enum(["dollars", "percent"]).default("dollars"),
      direction: z.enum(["up", "down", "both"]).default("both"),
      limit: z.number().int().max(40).default(12),
    },
  },
  async ({ gov, year_a, year_b, measure, direction, limit }) => {
    const rows = await query(
      `SELECT d.canonical_name AS dept,
         MAX(f.amount) FILTER (WHERE f.line_kind='total' AND f.account IS NULL AND f.fiscal_year=$2) a,
         MAX(f.amount) FILTER (WHERE f.line_kind='total' AND f.account IS NULL AND f.fiscal_year=$3) b,
         MIN(f.source_page) FILTER (WHERE f.line_kind='total' AND f.account IS NULL AND f.fiscal_year=$3) page,
         MIN(f.doc_id)      FILTER (WHERE f.line_kind='total' AND f.account IS NULL AND f.fiscal_year=$3) doc_id
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
      query: z.string().optional(), gov: z.enum(["city", "county"]).default("city"),
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

// Tools that need data not yet ingested — declared so agents see the roadmap.
for (const [name, need] of [
  ["get_amendments", "the amendment (file/markup) documents"],
] as const) {
  server.registerTool(
    name,
    { title: name, description: `(Not yet available — needs ${need}.)`, inputSchema: {} },
    async () => ok({ available: false, reason: `Requires ${need}; only 2026 city adopted is loaded so far.` }),
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("mke-budget MCP server ready (stdio).");
