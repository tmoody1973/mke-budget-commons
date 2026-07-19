import type { SourceFreshness } from "@mke/budget-tools";

const fmtDate = (iso: string | null) =>
  iso
    ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "unknown";

/**
 * "Payments through June 23, 2026" — says how current the figures are, right next
 * to them. These series refresh on their own cadence (monthly, continuous), so a
 * page without this quietly presents stale numbers as current. Same instinct as a
 * source citation: the reader should be able to see what they're looking at.
 */
export function FreshnessNote({ source, noun = "Data" }: { source: SourceFreshness | null; noun?: string }) {
  if (!source?.through) return null;
  const { through, days_old, is_stale, update_cadence, records } = source;

  return (
    <div
      className={`mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border px-4 py-2.5 text-sm ${
        is_stale
          ? "border-warning-200 bg-warning-50 text-warning-700"
          : "border-default-200 bg-content1 text-default-500"
      }`}
    >
      <span className="font-medium text-foreground">
        {noun} through {fmtDate(through)}
      </span>
      <span aria-hidden>·</span>
      <span>{records.toLocaleString()} records</span>
      <span aria-hidden>·</span>
      <span>updates {update_cadence}</span>
      {is_stale && (
        <span className="font-medium">
          — {days_old} days old, which is behind this source&apos;s usual cadence. Figures may not
          reflect recent activity.
        </span>
      )}
    </div>
  );
}

/**
 * Why a series can't be compared to the budget. Rendered as a visible caveat
 * rather than a footnote, because the wrong comparison is the failure mode these
 * datasets invite — see docs/CHECKBOOK-GUARDRAIL.md.
 */
export function BasisNote({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-xl border border-default-200 bg-default-50 px-4 py-3 text-xs leading-relaxed text-default-600">
      <span className="font-semibold text-foreground">{title}</span> {children}
    </div>
  );
}
