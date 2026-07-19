import "server-only";
import { defineTool } from "@copilotkit/runtime/v2";
import { z } from "zod";
import * as tools from "@mke/budget-tools";

// WPF semantic retrieval (`explain`). Embedding is now an OpenAI API call, so this
// runs anywhere — it is no longer gated by "can the native model load here". The
// flag is just an explicit on/off; it needs OPENAI_API_KEY to be set alongside it.
// When it's off, `explain` is still registered but fails fast (see below) — never
// absent, because an absent tool the prompt still advertises is what hung the chat.
const WPF_EXPLAIN_ENABLED = process.env.WPF_EXPLAIN_ENABLED === "true";

/** Whether WPF retrieval actually works here. The system prompt reads this so it can
 *  never advertise a capability the tool layer doesn't have (see route.ts). */
export const wpfExplainAvailable = WPF_EXPLAIN_ENABLED;

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
  // `explain` is ALWAYS registered, even where WPF retrieval is off. It used to be
  // omitted entirely when disabled — but the system prompt still told the model to
  // call it, so the model called a tool the runtime couldn't resolve. CopilotKit
  // then forwarded that unresolvable call to the client as a client-side tool; the
  // client only has a *renderer* for `explain` (no handler), so the call never
  // returned and the whole turn hung with no answer. Registering a stub that fails
  // fast makes that hang structurally impossible: the call always resolves.
  defineTool({
    name: "explain",
    description: WPF_EXPLAIN_ENABLED
      ? "Wisconsin Policy Forum context: semantic search over the WPF budget briefs for qualitative wisdom, history, and framing — to ATTRIBUTE (brief + page), never as a source of numbers. Call this for why / what-does-this-mean / give-me-context questions. Every $/FTE/% must still come from a reconciled budget tool."
      : "UNAVAILABLE in this deployment — do not call. Wisconsin Policy Forum retrieval is disabled here; use your own absorbed WPF background knowledge in prose (attributed) instead.",
    parameters: z.object(tools.explainShape),
    execute: async (args) =>
      WPF_EXPLAIN_ENABLED
        ? safe("explain", () => tools.explain(args))
        : {
            error:
              "Wisconsin Policy Forum retrieval is not available in this deployment. Do not call `explain` again. Keep going: use your own WPF background knowledge for framing (attributed in prose, no figures), and source every $/FTE/% from a reconciled budget tool as usual.",
          },
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

  // --- Vendor payments (City Open Checkbook) ------------------------------ //
  // Cash disbursements — a SEPARATE series from the budget. Every result carries
  // comparable_to_budget: false, and compare_budget_to_payments exists to absorb
  // "did they spend their budget?" rather than letting the model improvise a
  // join. Descriptions mirror the MCP registrations. See docs/CHECKBOOK-GUARDRAIL.md.
  defineTool({
    name: "get_top_vendors",
    description:
      "Largest vendors by net dollars the City actually PAID, citywide or for one spending unit (2022–2026). Refunds are netted; gross and refunds reported separately. This is cash spending, NOT budget — never compare these figures to budget amounts.",
    parameters: z.object(tools.getTopVendorsShape),
    execute: async (args) => safe("get_top_vendors", () => tools.getTopVendors(args)),
  }),
  defineTool({
    name: "search_vendor_payments",
    description:
      "Find individual City payments by vendor, spending unit, account, year, or minimum amount — each cited to its source row. Answers 'who does the city pay?' and 'how much did we pay X?'. Cash spending, NOT budget.",
    parameters: z.object(tools.searchVendorPaymentsShape),
    execute: async (args) => safe("search_vendor_payments", () => tools.searchVendorPayments(args)),
  }),
  defineTool({
    name: "vendor_payment_summary",
    description:
      "Aggregate actual payments by account category, fund, year, or spending unit — what a unit pays for, and how that shifts year over year. Cash spending, NOT budget.",
    parameters: z.object(tools.vendorPaymentSummaryShape),
    execute: async (args) => safe("vendor_payment_summary", () => tools.vendorPaymentSummary(args)),
  }),
  defineTool({
    name: "compare_budget_to_payments",
    description:
      "Call this whenever asked whether a department 'spent its budget', or to compare budgeted vs actual spending. It ALWAYS returns comparable: false and explains why no valid department-level budget-vs-actual exists between these sources, then lists what CAN be answered. Do NOT construct this comparison yourself from other tools — joining budget and payment figures produces plausible, quotable, false numbers.",
    parameters: z.object(tools.compareBudgetToPaymentsShape),
    execute: async (args) => safe("compare_budget_to_payments", () => tools.compareBudgetToPayments(args)),
  }),
];
