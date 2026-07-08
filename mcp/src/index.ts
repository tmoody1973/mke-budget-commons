import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  query, guardSelect, runSql, describeSchema, lookupGlossary, citations, num, resolveDept, pct,
  listDepartments, getDepartmentBudget, budgetBreakdown,
  compareYears, traceAdoption, biggestChanges, getPositions, findPositions,
  listDepartmentsShape, getDepartmentBudgetShape, budgetBreakdownShape,
  compareYearsShape, traceAdoptionShape, biggestChangesShape, getPositionsShape, findPositionsShape,
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
    inputSchema: getPositionsShape,
  },
  async (a) => wrap(() => getPositions(a)),
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
    inputSchema: compareYearsShape,
  },
  async (a) => wrap(() => compareYears(a)),
);

server.registerTool(
  "trace_adoption",
  {
    title: "Trace adoption",
    description: "A department's budget through the stages present for a fiscal year (requested → proposed/recommended → adopted), with stage deltas.",
    inputSchema: traceAdoptionShape,
  },
  async (a) => wrap(() => traceAdoption(a)),
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
    inputSchema: biggestChangesShape,
  },
  async (a) => wrap(() => biggestChanges(a)),
);

server.registerTool(
  "find_positions",
  {
    title: "Find positions",
    description: "Search city positions by title, minimum salary, or footnote flag (e.g. grant-funded). 'Who earns over $150K', 'grant-funded positions'. Cited.",
    inputSchema: findPositionsShape,
  },
  async (a) => wrap(() => findPositions(a)),
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
