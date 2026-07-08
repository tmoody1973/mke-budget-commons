import "server-only";
import { defineTool } from "@copilotkit/runtime/v2";
import { z } from "zod";
import * as tools from "@mke/budget-tools";

/**
 * Run a query function, converting any thrown error into a structured, friendly
 * result the model can relay — never a raw pg/stack trace, and never a number.
 * The trust wall holds: an error result carries no figures to fabricate from.
 */
async function safe<T>(label: string, fn: () => T | Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (err) {
    // Log the real detail server-side; hand the model only a clean sentence.
    console.error(`[budget-tool:${label}]`, err);
    return {
      error: `I couldn't complete the "${label}" lookup against the loaded budget data. Tell the user plainly that this lookup failed — do not invent or estimate any numbers.`,
    };
  }
}

/**
 * CopilotKit v2 backend tools. Each wraps a deterministic, read-only, cited
 * @mke/budget-tools query function (the single source of truth shared with the
 * MCP server). Descriptions are copied verbatim from the MCP tool registrations.
 * The model never computes numbers — it only chooses and orders these tools and
 * narrates their cited results. Runs server-side only (Neon creds stay here).
 */
export const serverTools = [
  defineTool({
    name: "biggest_changes",
    description:
      "The departments whose budgets changed the most between two fiscal years — the story-finder. Ranked by $ or %, with citations.",
    parameters: z.object(tools.biggestChangesShape),
    execute: async (args) => safe("biggest_changes", () => tools.biggestChanges(args)),
  }),
  defineTool({
    name: "get_department_budget",
    description:
      "Reserved-code totals, FTE, divisions, and top expenditures for a department, with citations.",
    parameters: z.object(tools.getDepartmentBudgetShape),
    execute: async (args) => safe("get_department_budget", () => tools.getDepartmentBudget(args)),
  }),
  defineTool({
    name: "budget_breakdown",
    description:
      "Where the money goes: salaries / fringe / operating / equipment / special funds as $ and % of the total, for a department or citywide. Cited.",
    parameters: z.object(tools.budgetBreakdownShape),
    execute: async (args) => safe("budget_breakdown", () => tools.budgetBreakdown(args)),
  }),
  defineTool({
    name: "search_line_items",
    description: "Full-text search over line descriptions, ranked and cited.",
    parameters: z.object(tools.searchLineItemsShape),
    execute: async (args) => safe("search_line_items", () => tools.searchLineItems(args)),
  }),
  defineTool({
    name: "cite",
    description:
      "Full provenance for a single budget line: document, page, and printed context.",
    parameters: z.object(tools.citeShape),
    execute: async (args) => safe("cite", () => tools.cite(args)),
  }),
  defineTool({
    name: "reconciliation_status",
    description:
      "Trust report: how the extracted data reconciles to the document's printed totals, with dispositions.",
    parameters: z.object(tools.reconciliationStatusShape),
    execute: async (args) => safe("reconciliation_status", () => tools.reconciliationStatus(args)),
  }),
  defineTool({
    name: "glossary",
    description:
      "Plain-language explanations of budget codes, terms, footnotes, and vintages. Call with no term for the whole glossary.",
    parameters: z.object(tools.glossaryShape),
    execute: async (args) => safe("glossary", () => tools.glossaryLookup(args)),
  }),
  defineTool({
    name: "compare_years",
    description:
      "Department reserved-code totals for two fiscal years, with $ and % deltas. Cited.",
    parameters: z.object(tools.compareYearsShape),
    execute: async (args) => safe("compare_years", () => tools.compareYears(args)),
  }),
  defineTool({
    name: "per_pupil_ranking",
    description:
      "MPS schools ranked by per-pupil spending (budget ÷ enrollment) — the equity lens. FY2027 proposed. Cited. Optionally filter by min/max enrollment to exclude tiny specialty schools.",
    parameters: z.object(tools.perPupilRankingShape),
    execute: async (args) => safe("per_pupil_ranking", () => tools.perPupilRanking(args)),
  }),
  defineTool({
    name: "run_sql",
    description:
      "Escape hatch: a single read-only SELECT/WITH over the budget tables (auto-LIMITed, 5s timeout). Call describe_schema first to see tables and columns.",
    parameters: z.object(tools.runSqlShape),
    execute: async (args) => safe("run_sql", () => tools.runSql(args)),
  }),
  defineTool({
    name: "describe_schema",
    description:
      "The budget database schema — tables, columns, and value domains — for writing run_sql queries.",
    parameters: z.object({}),
    execute: async () => safe("describe_schema", () => tools.describeSchema()),
  }),
];
