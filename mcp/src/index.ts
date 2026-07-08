import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  listDepartments, getDepartmentBudget, budgetBreakdown,
  compareYears, traceAdoption, biggestChanges, getPositions, findPositions,
  searchLineItems, cite, reconciliationStatus, glossaryLookup, runSql,
  compareSchools, mpsFundSummary, perPupilRanking, getAmendments, explain,
  listDepartmentsShape, getDepartmentBudgetShape, budgetBreakdownShape,
  compareYearsShape, traceAdoptionShape, biggestChangesShape, getPositionsShape, findPositionsShape,
  searchLineItemsShape, citeShape, reconciliationStatusShape, glossaryShape, runSqlShape,
  compareSchoolsShape, mpsFundSummaryShape, perPupilRankingShape, explainShape,
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
    inputSchema: searchLineItemsShape,
  },
  async (a) => wrap(() => searchLineItems(a)),
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
    inputSchema: citeShape,
  },
  async (a) => wrap(() => cite(a)),
);

server.registerTool(
  "reconciliation_status",
  {
    title: "Reconciliation status",
    description: "Trust report: how the extracted data reconciles to the document's printed totals, with dispositions.",
    inputSchema: reconciliationStatusShape,
  },
  async (a) => wrap(() => reconciliationStatus(a)),
);

server.registerTool(
  "run_sql",
  {
    title: "Run read-only SQL",
    description: "Escape hatch: a single read-only SELECT/WITH over the budget tables (auto-LIMITed, 5s timeout).",
    inputSchema: runSqlShape,
  },
  async (a) => wrap(() => runSql(a)),
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
    inputSchema: glossaryShape,
  },
  async (a) => wrap(async () => glossaryLookup(a)),
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
    inputSchema: compareSchoolsShape,
  },
  async (a) => wrap(() => compareSchools(a)),
);

server.registerTool(
  "mps_fund_summary",
  {
    title: "MPS fund summary",
    description: "MPS district-wide money by fund, total expenditures, total revenue, and the planned surplus / use of fund balance — the fiscal-health view. FY2027 proposed by default.",
    inputSchema: mpsFundSummaryShape,
  },
  async (a) => wrap(() => mpsFundSummary(a)),
);

server.registerTool(
  "per_pupil_ranking",
  {
    title: "Per-pupil spending ranking (MPS)",
    description: "MPS schools ranked by per-pupil spending (budget ÷ enrollment) — the equity lens. FY2027 proposed. Cited. Optionally filter by min/max enrollment to exclude tiny specialty schools.",
    inputSchema: perPupilRankingShape,
  },
  async (a) => wrap(() => perPupilRanking(a)),
);

server.registerTool(
  "explain",
  {
    title: "Explain (Wisconsin Policy Forum context)",
    description:
      "Semantic search over Wisconsin Policy Forum budget-brief commentary — qualitative wisdom, context, and framing to attribute (brief + page). SECONDARY source: never a source of figures; every dollar/FTE/% must still come from a reconciled budget tool.",
    inputSchema: explainShape,
  },
  async (a) => wrap(() => explain(a)),
);

server.registerTool(
  "get_amendments",
  { title: "get_amendments", description: "(Not yet available — needs the amendment (file/markup) documents.)", inputSchema: {} },
  async () => wrap(() => getAmendments()),
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("mke-budget MCP server ready (stdio).");
