"use client";

import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { BiggestChanges, CitationRef } from "@mke/budget-tools";
import { CitationRow } from "./CitationChip";

const UP = "#059669"; // increases
const DOWN = "#dc2626"; // decreases

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usdSigned = (n: number) => (n >= 0 ? "+" : "−") + usd(Math.abs(n));
const usdCompact = (n: number) =>
  (n < 0 ? "−" : "") +
  Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });

export function BiggestChangesCard({ data }: { data: BiggestChanges }) {
  const items = data.results ?? [];
  // Dynamic fy keys, e.g. fy2025 / fy2026 — the two non-delta numeric columns.
  const fyKeys = Object.keys(items[0] ?? {})
    .filter((k) => /^fy\d{4}$/.test(k))
    .sort();
  const [fyA, fyB] = fyKeys;

  const rows = items.map((it) => ({
    department: String(it.department),
    a: Number(it[fyA]),
    b: Number(it[fyB]),
    delta: Number(it.delta),
    delta_pct: Number(it.delta_pct),
  }));
  const chartRows = rows.slice(0, 10);
  const citations = (data.citations ?? []) as CitationRef[];

  return (
    <div className="my-2 w-full rounded-xl border border-default-200 bg-content1 p-3 shadow-sm">
      <div className="mb-2">
        <h3 className="text-sm font-semibold text-foreground">Biggest changes — {data.gov}</h3>
        <p className="text-xs text-default-500">
          {data.comparing} · by {data.measure} · <span className="text-success">▲ up</span>{" "}
          <span className="text-danger">▼ down</span>
        </p>
      </div>

      {/* Diverging bar chart of the dollar deltas */}
      <div className="w-full" style={{ height: Math.max(120, chartRows.length * 26) }} data-figure="changes-chart">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartRows} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }}>
            <XAxis type="number" tickFormatter={(v) => usdCompact(Number(v))} tick={{ fontSize: 10 }} stroke="#94a3b8" />
            <YAxis type="category" dataKey="department" width={116} tick={{ fontSize: 10 }} stroke="#94a3b8" />
            <ReferenceLine x={0} stroke="#cbd5e1" />
            <Tooltip formatter={(v: number) => usdSigned(Number(v))} contentStyle={{ fontSize: 12, borderRadius: 8 }} cursor={{ fill: "rgba(148,163,184,0.12)" }} />
            <Bar dataKey="delta" radius={2}>
              {chartRows.map((r, i) => (
                <Cell key={i} fill={r.delta >= 0 ? UP : DOWN} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Right-aligned table */}
      <div className="mt-2 max-h-64 overflow-auto">
        <table className="w-full text-xs" data-figure="changes-table">
          <thead className="sticky top-0 bg-content1">
            <tr className="border-b border-default-200 text-default-500">
              <th className="py-1 text-left font-medium">Department</th>
              <th className="py-1 text-right font-medium tabular-nums">{fyA?.replace("fy", "FY")}</th>
              <th className="py-1 text-right font-medium tabular-nums">{fyB?.replace("fy", "FY")}</th>
              <th className="py-1 text-right font-medium tabular-nums">Δ $</th>
              <th className="py-1 text-right font-medium tabular-nums">Δ %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.department} className="border-b border-default-100 last:border-0">
                <td className="py-1 pr-2 text-left">{r.department}</td>
                <td className="py-1 text-right tabular-nums text-default-600">{usd(r.a)}</td>
                <td className="py-1 text-right tabular-nums text-default-600">{usd(r.b)}</td>
                <td className={`py-1 text-right tabular-nums font-medium ${r.delta >= 0 ? "text-success" : "text-danger"}`}>{usdSigned(r.delta)}</td>
                <td className={`py-1 text-right tabular-nums ${r.delta >= 0 ? "text-success" : "text-danger"}`}>
                  {r.delta_pct >= 0 ? "+" : ""}
                  {r.delta_pct.toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <CitationRow citations={citations} />
    </div>
  );
}
