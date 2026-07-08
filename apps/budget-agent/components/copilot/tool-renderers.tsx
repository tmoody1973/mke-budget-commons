"use client";

import { useRenderTool } from "@copilotkit/react-core/v2";

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

/**
 * Registers CopilotKit v2 tool-call renderers so the copilot's tool use is
 * visible in the chat. Wildcard renderer = a status chip for every tool call.
 * Mounted inside <CopilotKit>. Renders nothing itself (registration only).
 */
export function ToolRenderers() {
  useRenderTool({
    name: "*",
    render: (props: { name: string; status: string; result?: unknown }) => {
      const { name, status } = props;
      const label = TOOL_LABELS[name] ?? name;
      const done = status === "complete";
      return (
        <div
          className="my-1 flex items-center gap-2 rounded-lg border border-default-200 bg-default-50 px-3 py-1.5 text-xs text-default-600"
          data-tool={name}
          data-tool-status={status}
        >
          <span aria-hidden className={done ? "text-success" : "text-default-400"}>
            {done ? "✓" : "⏳"}
          </span>
          <span>{label}</span>
          {!done && <span className="text-default-400">…</span>}
        </div>
      );
    },
  });

  return null;
}
