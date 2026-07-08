import { biggestChanges, budgetBreakdown, reconciliationStatus } from "@mke/budget-tools";
import { BiggestChangesCard } from "@/components/generative/BiggestChangesCard";
import { BudgetBreakdownCard } from "@/components/generative/BudgetBreakdownCard";
import { TrustBar } from "@/components/dashboard/TrustBar";
import type { Gov } from "@/components/shell/nav-items";

// The dashboard is a server component: it queries @mke/budget-tools directly
// (server-only, read-only, cited) and passes plain JSON results to the client cards.
export const dynamic = "force-dynamic";

const YEARS: Record<Gov, [number, number]> = {
  city: [2025, 2026],
  county: [2025, 2026],
  mps: [2026, 2027],
};

const GOV_LABEL: Record<Gov, string> = {
  city: "City of Milwaukee",
  county: "Milwaukee County",
  mps: "Milwaukee Public Schools",
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ gov?: string }>;
}) {
  const { gov: govParam } = await searchParams;
  const gov: Gov = govParam === "county" || govParam === "mps" ? govParam : "city";
  const [yearA, yearB] = YEARS[gov];

  const [changes, breakdown, recon] = await Promise.all([
    biggestChanges({ gov, year_a: yearA, year_b: yearB, measure: "dollars", direction: "both", limit: 12 }),
    budgetBreakdown({ gov, fiscal_year: yearB }),
    reconciliationStatus({}),
  ]);

  const breakdownTotal =
    "total" in breakdown
      ? breakdown.total
      : "total_expenditures" in breakdown
        ? (breakdown as { total_expenditures: number }).total_expenditures
        : null;

  return (
    <main className="w-full px-4 py-5 sm:px-6 lg:px-8">
      <div className="mb-4">
        <h1 className="text-xl font-bold tracking-tight text-foreground">{GOV_LABEL[gov]} · Budget</h1>
        <p className="text-sm text-default-500">Reconciled, cited budget data · ask the copilot to dig deeper →</p>
      </div>

      <TrustBar recon={recon} breakdownTotal={breakdownTotal} govLabel={gov} yearB={yearB} />

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section className="rounded-2xl border border-default-200 bg-content1 p-4">
          <h2 className="mb-2 text-base font-semibold text-foreground">
            Biggest changes · FY{yearA} → FY{yearB}
          </h2>
          {"results" in changes ? (
            <BiggestChangesCard data={changes} />
          ) : (
            <p className="p-3 text-sm text-default-500">No comparison data for {gov}.</p>
          )}
        </section>

        <section className="rounded-2xl border border-default-200 bg-content1 p-4">
          <h2 className="mb-2 text-base font-semibold text-foreground">Where the money goes · FY{yearB}</h2>
          {"breakdown" in breakdown || "people_costs" in breakdown ? (
            <BudgetBreakdownCard data={breakdown} />
          ) : (
            <p className="p-3 text-sm text-default-500">No breakdown available for {gov}.</p>
          )}
        </section>
      </div>

      <p className="mt-6 text-center text-xs text-default-400">
        Every figure is sourced to a document page. The copilot never computes numbers — it reads the reconciled data.
      </p>
    </main>
  );
}
