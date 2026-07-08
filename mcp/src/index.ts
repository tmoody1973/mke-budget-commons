import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  query, guardSelect, runSql, describeSchema, lookupGlossary, citations, num, resolveDept,
  grandTotalPred, deptYear, pct, YEAR_KIND, ROLLUP_EXCLUDE, STAGE_ORDER,
  listDepartments, getDepartmentBudget, budgetBreakdown,
  listDepartmentsShape, getDepartmentBudgetShape, budgetBreakdownShape,
} from "@mke/budget-tools";

const server = new McpServer({ name: "mke-budget", version: "0.1.0" });

const ok = (payload: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
});
const fail = (message: string) => ({
  content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
  isError: true,
});
const wrap = async (fn: () => Promise<unknown>) => {
  try { return ok(await fn()); } catch (e: any) { return fail(e.message); }
};

// --------------------------------------------------------------------------- //
server.registerTool(
  "list_departments",
  {
    title: "List departments",
    description: "Departments for a government with their adopted grand totals.",
    inputSchema: listDepartmentsShape,
  },
  async (a) => wrap(() => listDepartments(a)),
);

server.registerTool(
  "get_department_budget",
  {
    title: "Get department budget",
    description: "Reserved-code totals, FTE, divisions, and top expenditures for a department, with citations.",
    inputSchema: getDepartmentBudgetShape,
  },
  async (a) => wrap(() => getDepartmentBudget(a)),
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
    try {
      return ok(await runSql({ query: raw, limit }));
    } catch (e: any) {
      return fail(e.message);
    }
  },
);

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
    inputSchema: budgetBreakdownShape,
  },
  async (a) => wrap(() => budgetBreakdown(a)),
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

server.registerTool(
  "per_pupil_ranking",
  {
    title: "Per-pupil spending ranking (MPS)",
    description: "MPS schools ranked by per-pupil spending (budget ÷ enrollment) — the equity lens. FY2027 proposed. Cited. Optionally filter by min/max enrollment to exclude tiny specialty schools.",
    inputSchema: {
      fiscal_year: z.number().int().default(2027),
      order: z.enum(["highest", "lowest"]).default("highest"),
      min_enrollment: z.number().int().default(0),
      limit: z.number().int().max(60).default(20),
    },
  },
  async ({ fiscal_year, order, min_enrollment, limit }) => {
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
    schools.sort((a, b) => order === "highest" ? b.per_pupil! - a.per_pupil! : a.per_pupil! - b.per_pupil!);
    const top = schools.slice(0, limit);
    const ppVals = schools.map((s) => s.per_pupil!).sort((a, b) => a - b);
    return ok({
      fiscal_year: fy, order, min_enrollment, schools_ranked: schools.length,
      district_median_per_pupil: ppVals.length ? ppVals[Math.floor(ppVals.length / 2)] : null,
      results: top.map(({ doc_id, source_page, ...rest }) => rest),
      citations: citations(top),
      note: "Per pupil = school-controlled budget ÷ projected enrollment. Small specialty/"
        + "alternative schools naturally sit high (tiny denominators) — use min_enrollment to "
        + "focus on comprehensive schools. School budgets exclude central/districtwide costs.",
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
