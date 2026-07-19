import { getTopVendors, vendorPaymentSummary, dataFreshness } from "@mke/budget-tools";
import { RankedBars, RankedTable, type RankedRow } from "@/components/spending/RankedBars";
import { FreshnessNote, BasisNote } from "@/components/dashboard/FreshnessNote";

// Server component: queries @mke/budget-tools directly (server-only, read-only)
// and hands plain JSON to the client charts, matching the dashboard's pattern.
export const dynamic = "force-dynamic";

const YEARS = [2026, 2025, 2024, 2023, 2022] as const;

export default async function Spending({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { year: yearParam } = await searchParams;
  const parsed = Number(yearParam);
  const year = (YEARS as readonly number[]).includes(parsed) ? parsed : undefined;

  // Degrade per-panel: a query failure yields an empty state, never a 500 and
  // never a fabricated figure.
  const settled = await Promise.allSettled([
    getTopVendors({ year, limit: 15 }),
    vendorPaymentSummary({ year, group_by: "account" }),
    vendorPaymentSummary({ year, group_by: "unit" }),
    dataFreshness(),
  ]);
  const val = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === "fulfilled" ? r.value : null);
  const vendors = val(settled[0]);
  const byAccount = val(settled[1]);
  const byUnit = val(settled[2]);
  const fresh = val(settled[3]);
  const failed = settled.some((r) => r.status === "rejected");

  const vendorRows: RankedRow[] =
    vendors?.vendors.map((v) => ({
      label: v.vendor,
      value: v.net_paid ?? 0,
      detail:
        `${v.payment_count.toLocaleString()} payment${v.payment_count === 1 ? "" : "s"}` +
        (v.refunds ? ` · ${Math.round(Math.abs(v.refunds)).toLocaleString()} in refunds` : ""),
    })) ?? [];

  const bucketRows = (b: typeof byAccount, n: number): RankedRow[] =>
    b?.buckets.slice(0, n).map((x) => ({
      label: x.bucket,
      value: x.net_paid ?? 0,
      detail: `${x.payment_count.toLocaleString()} payments`,
    })) ?? [];

  const total = vendors?.vendors.reduce((s, v) => s + (v.net_paid ?? 0), 0) ?? 0;

  return (
    <main className="w-full px-4 py-5 sm:px-6 lg:px-8">
      <div className="mb-4">
        <h1 className="text-xl font-bold tracking-tight text-foreground">
          City of Milwaukee · Vendor spending
        </h1>
        <p className="text-sm text-default-500">
          Who the city actually pays — 404,120 payments, 2022–2026 · ask the copilot to dig deeper →
        </p>
      </div>

      <nav className="mb-4 flex flex-wrap gap-2" aria-label="Filter by year">
        <YearChip label="All years" href="/spending" active={year === undefined} />
        {YEARS.map((y) => (
          <YearChip key={y} label={String(y)} href={`/spending?year=${y}`} active={year === y} />
        ))}
      </nav>

      <FreshnessNote source={fresh?.sources.find((s) => s.source === "vendor_payments") ?? null} noun="Payments" />

      {failed && (
        <div className="mb-4 rounded-xl border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-700">
          Some spending data couldn&apos;t be loaded. What&apos;s shown is limited to what loaded — nothing is estimated.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section className="rounded-2xl border border-default-200 bg-content1 p-4 xl:col-span-2">
          <h2 className="mb-1 text-base font-semibold text-foreground">
            Top vendors {year ? `· ${year}` : "· 2022–2026"}
          </h2>
          <p className="mb-3 text-xs text-default-500">
            Net of refunds and reversals. {total > 0 && `Top 15 shown, totalling ${usd(total)}.`}
          </p>
          <RankedBars rows={vendorRows} valueLabel="Net paid" />
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-default-500 hover:text-foreground">
              Show as a table
            </summary>
            <div className="mt-2">
              <RankedTable rows={vendorRows} valueHeader="Net paid" />
            </div>
          </details>
        </section>

        <section className="rounded-2xl border border-default-200 bg-content1 p-4">
          <h2 className="mb-1 text-base font-semibold text-foreground">What it&apos;s spent on</h2>
          <p className="mb-3 text-xs text-default-500">By account category.</p>
          <RankedBars rows={bucketRows(byAccount, 12)} valueLabel="Net paid" height={320} />
        </section>

        <section className="rounded-2xl border border-default-200 bg-content1 p-4">
          <h2 className="mb-1 text-base font-semibold text-foreground">Which units spend it</h2>
          <p className="mb-3 text-xs text-default-500">By spending unit (city divisions).</p>
          <RankedBars rows={bucketRows(byUnit, 12)} valueLabel="Net paid" height={320} />
        </section>
      </div>

      <BasisNote title="This is cash paid to vendors — not the budget.">
        These figures are actual disbursements, and they are <strong>not</strong> a measure of whether
        a department spent its budget. They exclude direct salaries and wages (usually most of a
        department&apos;s budget), include pension and debt payments that aren&apos;t departmental
        operating spend, and are counted on the date paid rather than by appropriation year. The
        checkbook also tracks 70 spending units against the budget&apos;s 25 departments. Comparing
        the two produces numbers that look right and aren&apos;t.
      </BasisNote>

      <p className="mt-6 text-center text-xs text-default-400">
        Source: City of Milwaukee Open Checkbook, reconciled to the published total of $4,937,976,866.16.
      </p>
    </main>
  );
}

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function YearChip({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <a
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-default-200 bg-content1 text-default-600 hover:border-default-300 hover:text-foreground"
      }`}
    >
      {label}
    </a>
  );
}
