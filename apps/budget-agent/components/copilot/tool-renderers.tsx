"use client";

import { useRenderTool } from "@copilotkit/react-core/v2";
import { z } from "zod";
import { BudgetBreakdownCard } from "@/components/generative/BudgetBreakdownCard";
import { BiggestChangesCard } from "@/components/generative/BiggestChangesCard";
import { DepartmentBudgetCard } from "@/components/generative/DepartmentBudgetCard";
import { ContextCard } from "@/components/generative/ContextCard";

// Friendly labels for the budget tools, shown as the copilot works.
const TOOL_LABELS: Record<string, string> = {
  biggest_changes: "Finding the biggest budget changes",
  get_department_budget: "Looking up the department budget",
  budget_breakdown: "Breaking down where the money goes",
  search_line_items: "Searching budget line items",
  cite: "Fetching the source citation",
  reconciliation_status: "Checking reconciliation / findings",
  compare_years: "Comparing two fiscal years",
  per_pupil_ranking: "Ranking schools by per-pupil spending",
  explain: "Reading Wisconsin Policy Forum context",
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

// A failed lookup: a friendly note, never a stack trace and never a number.
function ToolError({ name }: { name: string }) {
  const label = TOOL_LABELS[name] ?? name;
  return (
    <div
      className="my-1 flex items-center gap-2 rounded-lg border border-warning-200 bg-warning-50 px-3 py-1.5 text-xs text-warning-700"
      data-tool={name}
      data-tool-status="error"
    >
      <span aria-hidden>⚠️</span>
      <span>Couldn&apos;t complete: {label.toLowerCase()}. No data was returned.</span>
    </div>
  );
}

// props.result is a JSON string of the tool's return value.
function parseResult(props: any): any {
  if (props.status !== "complete") return undefined;
  try {
    return typeof props.result === "string" ? JSON.parse(props.result) : props.result;
  } catch {
    return null;
  }
}

// The server wraps failed lookups as { error: "..." } (see lib/tools/server-tools.ts).
const isToolError = (r: any): boolean => !!r && typeof r === "object" && typeof r.error === "string";

// Inline, client-safe param schemas (typing only). Importing the real shapes from
// @mke/budget-tools would pull its barrel (db.ts → pg) into the client bundle.
const anyParams = z.object({}).passthrough();

/**
 * CopilotKit v2 tool-call renderers. Name-scoped renderers turn tool results into
 * cited chart/table/stat cards; the wildcard shows a status chip for the rest.
 * Mounted inside <CopilotKit>; renders nothing itself (registration only).
 */
export function ToolRenderers() {
  useRenderTool(
    {
      name: "budget_breakdown",
      parameters: anyParams,
      render: (props: any) => {
        const r = parseResult(props);
        if (props.status !== "complete") return <ToolChip name="budget_breakdown" status={props.status} />;
        if (isToolError(r)) return <ToolError name="budget_breakdown" />;
        if (!r || typeof r !== "object" || (!("breakdown" in r) && !("people_costs" in r))) {
          return <ToolChip name="budget_breakdown" status="complete" />;
        }
        return <BudgetBreakdownCard data={r as never} />;
      },
    },
    [],
  );

  useRenderTool(
    {
      name: "biggest_changes",
      parameters: anyParams,
      render: (props: any) => {
        const r = parseResult(props);
        if (props.status !== "complete") return <ToolChip name="biggest_changes" status={props.status} />;
        if (isToolError(r)) return <ToolError name="biggest_changes" />;
        // Empty results → a chip, never an empty (uncited) chart.
        if (!r || !Array.isArray(r.results) || r.results.length === 0)
          return <ToolChip name="biggest_changes" status="complete" />;
        return <BiggestChangesCard data={r as never} />;
      },
    },
    [],
  );

  useRenderTool(
    {
      name: "get_department_budget",
      parameters: anyParams,
      render: (props: any) => {
        const r = parseResult(props);
        if (props.status !== "complete") return <ToolChip name="get_department_budget" status={props.status} />;
        if (isToolError(r)) return <ToolError name="get_department_budget" />;
        if (!r || typeof r !== "object") return <ToolChip name="get_department_budget" status="complete" />;
        return <DepartmentBudgetCard data={r} />;
      },
    },
    [],
  );

  useRenderTool(
    {
      name: "explain",
      parameters: anyParams,
      render: (props: any) => {
        const r = parseResult(props);
        if (props.status !== "complete") return <ToolChip name="explain" status={props.status} />;
        if (isToolError(r)) return <ToolError name="explain" />;
        if (!r || !Array.isArray(r.passages) || r.passages.length === 0)
          return <ToolChip name="explain" status="complete" />;
        return <ContextCard data={r as never} />;
      },
    },
    [],
  );

  // Wildcard fallback: a status chip for every other tool call (or an error note).
  useRenderTool({
    name: "*",
    render: (props: any) =>
      isToolError(parseResult(props)) ? (
        <ToolError name={props.name} />
      ) : (
        <ToolChip name={props.name} status={props.status} />
      ),
  });

  return null;
}
