// How current is each series?
//
// Vendor payments refresh monthly and grants continuously, so a page that shows
// them without saying "through <date>" will quietly present stale figures as
// current. This makes staleness visible rather than silent — the same instinct
// as citing a source page: the reader should be able to see what they're looking at.

import { query } from "../db";
import type { Freshness, SourceFreshness } from "../types";

const ONE_DAY = 86_400_000;

const iso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? null : String(v).slice(0, 10);

const daysSince = (d: string | null): number | null =>
  d == null ? null : Math.floor((Date.now() - Date.parse(d)) / ONE_DAY);

/**
 * Latest record date and volume per series. `stale_after_days` is the point past
 * which the figure is probably behind its source, given that source's own cadence
 * — not an error, just the threshold where a reader deserves a warning.
 */
export async function dataFreshness(): Promise<Freshness> {
  const [payments, grants, docs] = await Promise.all([
    query<{ latest: Date | null; n: string }>(
      "SELECT MAX(paid_on) AS latest, COUNT(*) AS n FROM fact_vendor_payment",
    ).catch(() => []),
    query<{ latest: Date | null; n: string }>(
      "SELECT MAX(action_date) AS latest, COUNT(*) AS n FROM fact_federal_grant",
    ).catch(() => []),
    query<{ latest: Date | null; n: string }>(
      "SELECT MAX(retrieved_on) AS latest, COUNT(*) AS n FROM dim_document",
    ).catch(() => []),
  ]);

  const build = (
    key: SourceFreshness["source"],
    label: string,
    cadence: string,
    staleAfter: number,
    rows: { latest: Date | null; n: string }[],
  ): SourceFreshness => {
    const latest = iso(rows[0]?.latest ?? null);
    const age = daysSince(latest);
    return {
      source: key,
      label,
      through: latest,
      records: Number(rows[0]?.n ?? 0),
      days_old: age,
      update_cadence: cadence,
      stale_after_days: staleAfter,
      is_stale: age != null && age > staleAfter,
    };
  };

  return {
    sources: [
      // Checkbook publishes monthly; ~45 days allows for a late posting before flagging.
      build("vendor_payments", "Vendor payments", "monthly", 45, payments),
      // USAspending updates continuously, but grant activity is lumpy — a quiet
      // fortnight is normal, a quiet two months is not.
      build("federal_grants", "Federal grants", "continuous", 60, grants),
      // Budget documents are annual; freshness here is when WE retrieved them.
      build("budget_documents", "Budget documents", "annual", 400, docs),
    ],
    checked_at: new Date().toISOString().slice(0, 10),
  };
}
