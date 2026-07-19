"use client";

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const POSITIVE = "#0369a1";
const NEGATIVE = "#dc2626"; // net-negative: refunds/deobligations exceeded payments

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usdCompact = (n: number) =>
  (n < 0 ? "−" : "") +
  Math.abs(n).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  });

export type RankedRow = {
  label: string;
  value: number;
  /** Optional second line under the tooltip, e.g. "412 payments · 1 refund". */
  detail?: string;
};

/**
 * Horizontal ranked bars. Used for top vendors, top grant recipients, and
 * spending-by-category — the same shape answers all three, so they read as one
 * system rather than three bespoke charts.
 */
export function RankedBars({
  rows,
  valueLabel,
  height = 380,
}: {
  rows: RankedRow[];
  valueLabel: string;
  height?: number;
}) {
  if (rows.length === 0) {
    return <p className="p-3 text-sm text-default-500">No data for this selection.</p>;
  }

  const data = rows.map((r) => ({
    ...r,
    short: r.label.length > 34 ? `${r.label.slice(0, 33)}…` : r.label,
  }));

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
          <XAxis
            type="number"
            tickFormatter={usdCompact}
            tick={{ fontSize: 11 }}
            stroke="currentColor"
            className="text-default-400"
          />
          <YAxis
            type="category"
            dataKey="short"
            width={190}
            tick={{ fontSize: 11 }}
            stroke="currentColor"
            className="text-default-500"
          />
          <Tooltip
            cursor={{ fillOpacity: 0.06 }}
            formatter={(v) => [usd(Number(v ?? 0)), valueLabel]}
            labelFormatter={(_l, p) => {
              const row = p?.[0]?.payload as (RankedRow & { short: string }) | undefined;
              return row ? `${row.label}${row.detail ? ` — ${row.detail}` : ""}` : "";
            }}
            contentStyle={{ fontSize: 12, borderRadius: 10 }}
          />
          <Bar dataKey="value" radius={[0, 4, 4, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.value < 0 ? NEGATIVE : POSITIVE} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Compact table for the same data — the numbers, exactly, next to the chart. */
export function RankedTable({ rows, valueHeader }: { rows: RankedRow[]; valueHeader: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-default-200 text-left text-xs uppercase tracking-wide text-default-400">
            <th className="py-2 pr-3 font-medium">#</th>
            <th className="py-2 pr-3 font-medium">Name</th>
            <th className="py-2 pr-3 text-right font-medium">{valueHeader}</th>
            <th className="py-2 font-medium">Detail</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.label}-${i}`} className="border-b border-default-100 last:border-0">
              <td className="py-2 pr-3 tabular-nums text-default-400">{i + 1}</td>
              <td className="py-2 pr-3 text-foreground">{r.label}</td>
              <td
                className={`py-2 pr-3 text-right tabular-nums ${
                  r.value < 0 ? "text-danger" : "text-foreground"
                }`}
              >
                {usd(r.value)}
              </td>
              <td className="py-2 text-xs text-default-500">{r.detail ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
