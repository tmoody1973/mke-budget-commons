"use client";

import type { CitationRef } from "@mke/budget-tools";
import { CitationRow } from "./CitationChip";

const usd = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const num = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US"));

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-default-200 bg-default-50 px-2.5 py-1.5">
      <div className="text-[11px] text-default-500">{label}</div>
      <div className="text-sm font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  );
}

/**
 * Renders a get_department_budget result. The result is parsed JSON and can be
 * one of several gov-specific shapes, or an ambiguous-match object.
 */
export function DepartmentBudgetCard({ data }: { data: any }) {
  const citations = (data?.citations ?? []) as CitationRef[];

  // Ambiguous match → let the user pick.
  if (data?.ambiguous) {
    return (
      <div className="my-2 w-full rounded-xl border border-default-200 bg-content1 p-3 shadow-sm">
        <h3 className="text-sm font-semibold text-foreground">Which department did you mean?</h3>
        <ul className="mt-1 list-inside list-disc text-xs text-default-600">
          {(data.candidates ?? []).slice(0, 10).map((c: any) => (
            <li key={c.dept_id}>{c.canonical_name}</li>
          ))}
        </ul>
      </div>
    );
  }

  const name = data?.department ?? data?.school_or_office ?? "Department";
  const subtitle =
    data?.doc_type != null
      ? `${data.doc_type} budget`
      : data?.fiscal_year != null
        ? `FY${data.fiscal_year}${data?.vintage ? ` · ${data.vintage}` : ""}`
        : "";

  // City shape: reserved-code totals.
  const t = data?.totals ?? {};
  const isCity = "net_salaries_006000" in t;
  const isCounty = "personnel_costs" in t;
  const isMps = data?.total != null && Array.isArray(data?.top_spending_by_object);

  return (
    <div className="my-2 w-full rounded-xl border border-default-200 bg-content1 p-3 shadow-sm">
      <div className="mb-2">
        <h3 className="text-sm font-semibold text-foreground">{name}</h3>
        {subtitle && <p className="text-xs capitalize text-default-500">{subtitle}</p>}
      </div>

      {isCity && (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            <Stat label="Grand total" value={usd(t.grand_total)} />
            <Stat label="Salaries (006000)" value={usd(t.net_salaries_006000)} />
            <Stat label="Fringe (006100)" value={usd(t.fringe_006100)} />
            <Stat label="Operating (006300)" value={usd(t.operating_006300)} />
            <Stat label="Equipment (006800)" value={usd(t.equipment_006800)} />
            <Stat label="FTE (O&M / non-O&M)" value={`${num(data?.fte?.om)} / ${num(data?.fte?.non_om)}`} />
          </div>
          {Array.isArray(data?.top_expenditures) && data.top_expenditures.length > 0 && (
            <table className="mt-2 w-full text-xs" data-figure="dept-top-expenditures">
              <thead>
                <tr className="border-b border-default-200 text-default-500">
                  <th className="py-1 text-left font-medium">Top expenditure</th>
                  <th className="py-1 text-right font-medium tabular-nums">Amount</th>
                  <th className="py-1 text-right font-medium">Page</th>
                </tr>
              </thead>
              <tbody>
                {data.top_expenditures.slice(0, 8).map((e: any, i: number) => (
                  <tr key={i} className="border-b border-default-100 last:border-0">
                    <td className="py-1 pr-2 text-left">{e.description}</td>
                    <td className="py-1 text-right tabular-nums text-foreground">{usd(e.amount)}</td>
                    <td className="py-1 text-right text-default-500">p.{e.page}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {isCounty && (
        <div className="grid grid-cols-2 gap-1.5">
          <Stat label="Total expenditures" value={usd(t.total_expenditures)} />
          <Stat label="Tax levy" value={usd(t.tax_levy)} />
          <Stat label="Personnel" value={usd(t.personnel_costs)} />
          <Stat label="Operations" value={usd(t.operations_costs)} />
          <Stat label="Debt & depreciation" value={usd(t.debt_and_depreciation)} />
          <Stat label="Interdepartmental" value={usd(t.interdepartmental_charges)} />
          <Stat label="Total revenues" value={usd(t.total_revenues)} />
          <Stat label="Full-time FTE" value={num(data?.fte?.full_time)} />
        </div>
      )}

      {!isCity && !isCounty && isMps && (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            <Stat label="Total" value={usd(data.total)} />
            <Stat label="FTE" value={num(data.total_fte)} />
          </div>
          {data.top_spending_by_object?.length > 0 && (
            <table className="mt-2 w-full text-xs" data-figure="dept-top-objects">
              <thead>
                <tr className="border-b border-default-200 text-default-500">
                  <th className="py-1 text-left font-medium">Object</th>
                  <th className="py-1 text-right font-medium tabular-nums">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.top_spending_by_object.slice(0, 8).map((o: any, i: number) => (
                  <tr key={i} className="border-b border-default-100 last:border-0">
                    <td className="py-1 pr-2 text-left">{o.object}</td>
                    <td className="py-1 text-right tabular-nums text-foreground">{usd(o.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      <CitationRow citations={citations} />
    </div>
  );
}
