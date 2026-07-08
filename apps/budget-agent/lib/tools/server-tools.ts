import "server-only";
import { defineTool } from "@copilotkit/runtime/v2";
import { z } from "zod";
import * as tools from "@mke/budget-tools";

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
    execute: async (args) => tools.biggestChanges(args),
  }),
  defineTool({
    name: "get_department_budget",
    description:
      "Reserved-code totals, FTE, divisions, and top expenditures for a department, with citations.",
    parameters: z.object(tools.getDepartmentBudgetShape),
    execute: async (args) => tools.getDepartmentBudget(args),
  }),
  defineTool({
    name: "budget_breakdown",
    description:
      "Where the money goes: salaries / fringe / operating / equipment / special funds as $ and % of the total, for a department or citywide. Cited.",
    parameters: z.object(tools.budgetBreakdownShape),
    execute: async (args) => tools.budgetBreakdown(args),
  }),
  defineTool({
    name: "search_line_items",
    description: "Full-text search over line descriptions, ranked and cited.",
    parameters: z.object(tools.searchLineItemsShape),
    execute: async (args) => tools.searchLineItems(args),
  }),
  defineTool({
    name: "cite",
    description:
      "Full provenance for a single budget line: document, page, and printed context.",
    parameters: z.object(tools.citeShape),
    execute: async (args) => tools.cite(args),
  }),
  defineTool({
    name: "reconciliation_status",
    description:
      "Trust report: how the extracted data reconciles to the document's printed totals, with dispositions.",
    parameters: z.object(tools.reconciliationStatusShape),
    execute: async (args) => tools.reconciliationStatus(args),
  }),
  defineTool({
    name: "glossary",
    description:
      "Plain-language explanations of budget codes, terms, footnotes, and vintages. Call with no term for the whole glossary.",
    parameters: z.object(tools.glossaryShape),
    execute: async (args) => tools.glossaryLookup(args),
  }),
  defineTool({
    name: "run_sql",
    description:
      "Escape hatch: a single read-only SELECT/WITH over the budget tables (auto-LIMITed, 5s timeout). Call describe_schema first to see tables and columns.",
    parameters: z.object(tools.runSqlShape),
    execute: async (args) => tools.runSql(args),
  }),
  defineTool({
    name: "describe_schema",
    description:
      "The budget database schema — tables, columns, and value domains — for writing run_sql queries.",
    parameters: z.object({}),
    execute: async () => tools.describeSchema(),
  }),
];
