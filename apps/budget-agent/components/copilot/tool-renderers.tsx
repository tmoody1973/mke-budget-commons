"use client";

import { useRenderTool } from "@copilotkit/react-core/v2";
import { z } from "zod";
import { BudgetBreakdownCard } from "@/components/generative/BudgetBreakdownCard";

// Inline, client-safe params schema for the renderer. It only types props.parameters
// (unused here) — importing the real shape from @mke/budget-tools would pull the
// package's barrel (db.ts → pg) into the client bundle. Renderers match by NAME.
const budgetBreakdownParams = z.object({
  gov: z.enum(["city", "county", "mps"]).optional(),
  fiscal_year: z.number().optional(),
  dept: z.string().optional(),
});

// Friendly labels for the budget tools, shown as the copilot works.
const TOOL_LABELS: Record<string, string> = {
  biggest_changes: "Finding the biggest budget changes",
  get_department_budget: "Looking up the department budget",
  budget_breakdown: "Breaking down where the money goes",
  search_line_items: "Searching budget line items",
  cite: "Fetching the source citation",
  reconciliation_status: "Checking reconciliation / findings",
  glossary: "Looking up the glossary",
  run_sql: "Running a read-only SQL query",
  describe_schema: "Reading the database schema",
};

function ToolChip({ name, status }: { name: string; status: string }) {
  const label = TOOL_LABELS[name] ?? name;
  const done = status === "complete";
  return (
    <div
      className="my-1 flex items-center gap-2 rounded-lg border border-default-200 bg-default-50 px-3 py-1.5 text-xs text-default-600"
      data-tool={name}
      data-tool-status={status}
    >
      <span aria-hidden className={done ? "text-success" : "text-default-400"}>{done ? "✓" : "⏳"}</span>
      <span>{label}</span>
      {!done && <span className="text-default-400">…</span>}
    </div>
  );
}

/**
 * CopilotKit v2 tool-call renderers.
 * - budget_breakdown → a real chart + right-aligned table card (generative UI).
 * - everything else → a status chip (wildcard fallback).
 * Mounted inside <CopilotKit>. Renders nothing itself (registration only).
 */
export function ToolRenderers() {
  // Name-scoped: render budget_breakdown results as a cited chart + table card.
  useRenderTool(
    {
      name: "budget_breakdown",
      parameters: budgetBreakdownParams,
      render: (props: any) => {
        if (props.status !== "complete") return <ToolChip name="budget_breakdown" status={props.status} />;
        // props.result is a JSON string of the tool's return value.
        let result: unknown;
        try {
          result = typeof props.result === "string" ? JSON.parse(props.result) : props.result;
        } catch {
          result = null;
        }
        // Ambiguous / error / unexpected shape → fall back to a chip.
        if (!result || typeof result !== "object" || (!("breakdown" in result) && !("people_costs" in result))) {
          return <ToolChip name="budget_breakdown" status="complete" />;
        }
        return <BudgetBreakdownCard data={result as never} />;
      },
    },
    [],
  );

  // Wildcard fallback: a status chip for every other tool call.
  useRenderTool({
    name: "*",
    render: (props: any) => <ToolChip name={props.name} status={props.status} />,
  });

  return null;
}
