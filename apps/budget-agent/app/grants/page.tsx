import { getTopGrantRecipients, grantSummary, dataFreshness } from "@mke/budget-tools";
import { RankedBars, RankedTable, type RankedRow } from "@/components/spending/RankedBars";
import { FreshnessNote, BasisNote } from "@/components/dashboard/FreshnessNote";

export const dynamic = "force-dynamic";

const YEARS = [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018] as const;

export default async function Grants({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { year: yearParam } = await searchParams;
  const parsed = Number(yearParam);
  const fiscal_year = (YEARS as readonly number[]).includes(parsed) ? parsed : undefined;

  const settled = await Promise.allSettled([
    getTopGrantRecipients({ fiscal_year, limit: 15 }),
    grantSummary({ group_by: "agency", fiscal_year }),
    grantSummary({ group_by: "program", fiscal_year }),
    grantSummary({ group_by: "year" }),
    dataFreshness(),
  ]);
  const val = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === "fulfilled" ? r.value : null);
  const recipients = val(settled[0]);
  const byAgency = val(settled[1]);
  const byProgram = val(settled[2]);
  const byYear = val(settled[3]);
  const fresh = val(settled[4]);
  const failed = settled.some((r) => r.status === "rejected");

  const recipientRows: RankedRow[] =
    recipients?.recipients.map((r) => ({
      label: r.recipient,
      value: r.net_obligated ?? 0,
      detail:
        `${r.award_count.toLocaleString()} award${r.award_count === 1 ? "" : "s"}` +
        (r.deobligations ? " · includes deobligations" : ""),
    })) ?? [];

  const bucketRows = (b: typeof byAgency, n: number): RankedRow[] =>
    b?.buckets.slice(0, n).map((x) => ({
      label: x.bucket,
      value: x.net_obligated ?? 0,
      detail: `${x.recipient_count.toLocaleString()} recipients`,
    })) ?? [];

  // Year trend reads better ascending — it's a time series, not a ranking.
  const yearRows: RankedRow[] =
    byYear?.buckets
      .slice()
      .sort((a, b) => Number(a.bucket) - Number(b.bucket))
      .map((x) => ({
        label: `FY${x.bucket}`,
        value: x.net_obligated ?? 0,
        detail: `${x.recipient_count.toLocaleString()} recipients`,
      })) ?? [];

  return (
    <main className="w-full px-4 py-5 sm:px-6 lg:px-8">
      <div className="mb-4">
        <h1 className="text-xl font-bold tracking-tight text-foreground">
          Federal grants · Milwaukee County
        </h1>
        <p className="text-sm text-default-500">
          Where federal money lands — 13,465 awards, FY2018–2026 · ask the copilot to dig deeper →
        </p>
      </div>

      <nav className="mb-4 flex flex-wrap gap-2" aria-label="Filter by federal fiscal year">
        <YearChip label="All years" href="/grants" active={fiscal_year === undefined} />
        {YEARS.map((y) => (
          <YearChip key={y} label={`FY${y}`} href={`/grants?year=${y}`} active={fiscal_year === y} />
        ))}
      </nav>

      <FreshnessNote source={fresh?.sources.find((s) => s.source === "federal_grants") ?? null} noun="Awards" />

      {failed && (
        <div className="mb-4 rounded-xl border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-700">
          Some grant data couldn&apos;t be loaded. What&apos;s shown is limited to what loaded — nothing is estimated.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section className="rounded-2xl border border-default-200 bg-content1 p-4 xl:col-span-2">
          <h2 className="mb-1 text-base font-semibold text-foreground">
            Top recipients {fiscal_year ? `· FY${fiscal_year}` : "· FY2018–2026"}
          </h2>
          <p className="mb-3 text-xs text-default-500">
            Net federal obligations. Most recipients are nonprofits, hospitals and universities —
            not government departments.
          </p>
          <RankedBars rows={recipientRows} valueLabel="Obligated" />
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-default-500 hover:text-foreground">
              Show as a table
            </summary>
            <div className="mt-2">
              <RankedTable rows={recipientRows} valueHeader="Obligated" />
            </div>
          </details>
        </section>

        <section className="rounded-2xl border border-default-200 bg-content1 p-4">
          <h2 className="mb-1 text-base font-semibold text-foreground">Which federal agencies fund Milwaukee</h2>
          <p className="mb-3 text-xs text-default-500">By awarding agency.</p>
          <RankedBars rows={bucketRows(byAgency, 12)} valueLabel="Obligated" height={320} />
        </section>

        <section className="rounded-2xl border border-default-200 bg-content1 p-4">
          <h2 className="mb-1 text-base font-semibold text-foreground">Which programs</h2>
          <p className="mb-3 text-xs text-default-500">By federal assistance program (CFDA).</p>
          <RankedBars rows={bucketRows(byProgram, 12)} valueLabel="Obligated" height={320} />
        </section>

        <section className="rounded-2xl border border-default-200 bg-content1 p-4 xl:col-span-2">
          <h2 className="mb-1 text-base font-semibold text-foreground">Federal money over time</h2>
          <p className="mb-3 text-xs text-default-500">
            Obligations by federal fiscal year. FY2026 is partial — the year is still running.
          </p>
          <RankedBars rows={yearRows} valueLabel="Obligated" height={300} />
        </section>
      </div>

      <BasisNote title="These are federal obligations — not city or county budget revenue.">
        &quot;Obligated&quot; means money legally committed in that federal fiscal year (October
        through September), which is not the same as money received, nor the same as the federal
        revenue lines in a city budget. This covers grants and cooperative agreements only — not
        federal contracts, loans, or direct payments — and counts awards by where the{" "}
        <em>recipient</em> is located, which is not the same as where the money is spent. Multi-year
        awards are counted by what was committed each year, never by their full lifetime value.
      </BasisNote>

      <p className="mt-6 text-center text-xs text-default-400">
        Source: USAspending.gov bulk extracts, reconciled to $5,150,848,674.55 across nine federal fiscal years.
      </p>
    </main>
  );
}

function YearChip({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <a
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "border-primary bg-primary text-white"
          : "border-default-200 bg-content1 text-default-600 hover:border-default-300 hover:text-foreground"
      }`}
    >
      {label}
    </a>
  );
}
