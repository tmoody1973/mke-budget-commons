"use client";

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { BudgetBreakdown, BreakdownPart, CitationRef } from "@mke/budget-tools";
import { CitationRow } from "./CitationChip";

type Row = { label: string; amount: number; pct: number };

// Brand-neutral categorical palette (swap for the project's brand later).
const COLORS = ["#2563eb", "#0891b2", "#7c3aed", "#d97706", "#64748b", "#db2777", "#059669"];

const usd = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usdCompact = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });

/** Normalize the gov-specific breakdown shape into a flat list of rows. */
function toRows(data: BudgetBreakdown): Row[] {
  const part = (label: string, p?: BreakdownPart): Row | null =>
    p ? { label, amount: p.amount, pct: p.pct } : null;
  if ("breakdown" in data) {
    const b = data.breakdown as Record<string, BreakdownPart>;
    // City: salaries/fringe_benefits/operating/equipment/special_funds.
    // County: personnel/operations/debt_and_depreciation/interdepartmental_charges.
    const labels: Record<string, string> = {
      salaries: "Salaries (net wages)",
      fringe_benefits: "Fringe benefits",
      operating: "Operating",
      equipment: "Equipment",
      special_funds: "Special funds",
      personnel: "Personnel",
      operations: "Operations",
      debt_and_depreciation: "Debt & depreciation",
      interdepartmental_charges: "Interdepartmental",
    };
    return Object.entries(b)
      .map(([k, v]) => part(labels[k] ?? k, v))
      .filter((r): r is Row => r !== null);
  }
  if ("people_costs" in data) {
    // MPS: people_costs + top_objects.
    const pc = data.people_costs;
    return [
      part("Salaries", pc.salaries),
      part("Benefits", pc.benefits),
      part("Other", pc.other),
    ].filter((r): r is Row => r !== null);
  }
  return [];
}

export function BudgetBreakdownCard({ data }: { data: BudgetBreakdown }) {
  const rows = toRows(data);
  // City/MPS use `total`; county uses `total_expenditures`.
  const total =
    (data as { total?: number }).total ?? (data as { total_expenditures?: number }).total_expenditures ?? null;
  const citations = (data as { citations?: CitationRef[] }).citations ?? [];

  return (
    <div className="my-2 w-full rounded-xl border border-default-200 bg-content1 p-3 shadow-sm" data-testid="cited-card">
      <div className="mb-2">
        <h3 className="text-sm font-semibold text-foreground">Where the money goes — {data.scope}</h3>
        <p className="text-xs text-default-500">
          FY{data.fiscal_year} · total {usd(total)}
        </p>
      </div>

      {/* Chart */}
      <div className="w-full" style={{ height: Math.max(200, rows.length * 46) }} data-figure="breakdown-chart">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }}>
            <XAxis type="number" tickFormatter={(v) => usdCompact(Number(v))} tick={{ fontSize: 11 }} stroke="#94a3b8" />
            <YAxis type="category" dataKey="label" width={120} tick={{ fontSize: 11 }} stroke="#94a3b8" />
            <Tooltip
              formatter={(v) => usd(Number(v))}
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
              cursor={{ fill: "rgba(148,163,184,0.12)" }}
            />
            <Bar dataKey="amount" radius={[0, 4, 4, 0]}>
              {rows.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Right-aligned table */}
      <table className="mt-2 w-full text-sm" data-figure="breakdown-table">
        <thead>
          <tr className="border-b border-default-200 text-default-500">
            <th className="py-1 text-left font-medium">Category</th>
            <th className="py-1 text-right font-medium tabular-nums">Amount</th>
            <th className="py-1 text-right font-medium tabular-nums">Share</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.label} className="border-b border-default-100 last:border-0">
              <td className="py-1 text-left">
                <span className="mr-1.5 inline-block h-2 w-2 rounded-sm align-middle" style={{ background: COLORS[i % COLORS.length] }} />
                {r.label}
              </td>
              <td className="py-1 text-right tabular-nums text-foreground">{usd(r.amount)}</td>
              <td className="py-1 text-right tabular-nums text-default-600">{r.pct.toFixed(1)}%</td>
            </tr>
          ))}
          <tr className="font-semibold">
            <td className="py-1 text-left">Total</td>
            <td className="py-1 text-right tabular-nums">{usd(total)}</td>
            <td className="py-1 text-right tabular-nums">100%</td>
          </tr>
        </tbody>
      </table>

      <CitationRow citations={citations} />
    </div>
  );
}
