type Recon = { summary?: Record<string, number>; findings?: unknown[] };

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-default-200 bg-content1 px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-default-400">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">{value}</div>
      <div className="text-xs text-default-500">{sub}</div>
    </div>
  );
}

/** Trust signal row: total, reconciliation coverage, and finding count. */
export function TrustBar({
  recon,
  breakdownTotal,
  govLabel,
  yearB,
}: {
  recon: Recon;
  breakdownTotal: number | null;
  govLabel: string;
  yearB: number;
}) {
  const summary = recon?.summary ?? {};
  // Status keys: pass (reconciled) · not_reconcilable (no printed total to check)
  // · source_inconsistency (documented PDF discrepancies) · open · info.
  const pass = Number(summary.pass ?? 0);
  const sourceInconsistency = Number(summary.source_inconsistency ?? 0);
  const totalChecks = Object.values(summary).reduce((a, b) => a + Number(b), 0);
  const pct = totalChecks ? Math.round((pass / totalChecks) * 100) : null;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="trust-bar">
      <Stat
        label="Budget total"
        value={breakdownTotal != null ? usd(breakdownTotal) : "—"}
        sub={`${govLabel} · FY${yearB} adopted`}
      />
      <Stat
        label="Reconciliation"
        value={pct != null ? `${pct}% reconciled` : "—"}
        sub={totalChecks ? `${pass.toLocaleString()} of ${totalChecks.toLocaleString()} checks pass` : "no checks loaded"}
      />
      <Stat
        label="Findings"
        value={String(sourceInconsistency)}
        sub={sourceInconsistency ? "documented source discrepancies (story leads)" : "none"}
      />
    </div>
  );
}
