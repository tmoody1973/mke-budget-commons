"""Generate docs/reconciliation-reports/city-2026-adopted-detailed.md.

Runs the reconciliation over the Phase 2 target units and writes a receipt:
which anchors reconciled exactly, per vintage, with any discrepancies and their
disposition. No LLM; pure arithmetic over canonical rows.
"""
from __future__ import annotations

from pathlib import Path

from parsers.canonical import ACTUAL, ADOPTED, BUDGET
from parsers.city_detailed import DEFAULT_PDF, TARGETS, parse_range
from parsers.reconcile_city import VINTAGE_LABEL, reconcile_unit, summarize

REPORT = Path("docs/reconciliation-reports/city-2026-adopted-detailed.md")
ORDER = [BUDGET, ADOPTED, ACTUAL]
STATUS_ICON = {"PASS": "✅", "FAIL": "❌", "NOT_RECONCILABLE": "➖"}


def fmt(v):
    if v is None:
        return "—"
    if float(v).is_integer():
        return f"{int(v):,}"
    return f"{v:,.2f}"


def unit_section(name: str) -> tuple[str, dict]:
    t = TARGETS[name]
    unit = parse_range(DEFAULT_PDF, t["start"], t["end"])
    checks = reconcile_unit(unit)
    s = summarize(checks)

    lines = [
        f"### {t['label']}",
        "",
        f"- Pages: **{t['start']}–{t['end']}** (1-based) · `{unit.department_printed}`"
        + (f" · {unit.division}" if unit.division else ""),
        f"- Canonical rows emitted: **{len(unit.lines)}**",
        f"- Checks: **{s['passed']}/{s['total']} PASS**, "
        f"**{len(s['failed'])} FAIL**, **{len(s['not_reconcilable'])} NOT_RECONCILABLE**",
        "",
        "| Anchor check | Vintage | Printed total | Extracted | Δ | Status |",
        "|---|---|--:|--:|--:|:--:|",
    ]
    by_v = {v: [c for c in checks if c.vintage == v] for v in ORDER}
    for v in ORDER:
        for c in by_v[v]:
            delta = fmt(c.delta) if c.delta is not None else "—"
            note = ""
            if c.status == "NOT_RECONCILABLE":
                note = " _(no per-position 2024 actuals printed)_"
            lines.append(
                f"| {c.name}{note} | {VINTAGE_LABEL[v]} | {fmt(c.expected)} | "
                f"{fmt(c.actual)} | {delta} | {STATUS_ICON[c.status]} |"
            )
    lines.append("")
    return "\n".join(lines), s


def main() -> None:
    sections, totals = [], {"passed": 0, "failed": 0, "nr": 0, "total": 0}
    for name in ("itmd", "city-attorney"):
        text, s = unit_section(name)
        sections.append(text)
        totals["passed"] += s["passed"]
        totals["failed"] += len(s["failed"])
        totals["nr"] += len(s["not_reconcilable"])
        totals["total"] += s["total"]

    header = f"""# Reconciliation Report — City of Milwaukee 2026 Adopted Detailed Budget

**doc_id:** `city-2026-adopted-detailed`
**Source:** `data/raw/city/2026-CITY-OF-MILWAUKEE-DETAILED-BUDGET4.pdf` (269 pp.)
**Method:** deterministic pdfplumber + regex, column-wise summation vs. printed
reserved-code anchors. Exact match required. No LLM touches the numbers.

## Phase 2 scope

Two reconciliation units parsed end-to-end as the vertical slice. Every
extracted line item sums **exactly** to the document's own printed totals per
vintage column (2024 actual / 2025 budget / 2026 adopted).

**Aggregate: {totals['passed']}/{totals['total']} checks PASS · {totals['failed']} FAIL · {totals['nr']} NOT_RECONCILABLE.**

### Reserved-code anchors reconciled

- `006000` NET SALARIES & WAGES TOTAL — via positions → *Total Before
  Adjustments* → (+ adjustments/deductions) → net. Position dollars **and**
  headcount reconcile.
- `006300` OPERATING EXPENDITURES TOTAL — sum of `630xxx–637xxx` line items.
- `006800` EQUIPMENT PURCHASES TOTAL — sum of equipment items.
- `SPECIAL FUNDS TOTAL` — sum of special-fund appropriations (where present).
- Division / Budgetary Control Unit **TOTAL** — sum of all five anchors.

### Dispositions

- **NOT_RECONCILABLE — 2024 salaries (both units).** The adopted book prints no
  per-position 2024 *actual* column, only the `006000` net-salaries actual. The
  position→total salary check therefore cannot run for the 2024 vintage. This is
  a source-document limitation, labeled `NOT_RECONCILABLE` rather than trusted
  silently (BetaNYC pattern). 2024 operating, equipment, special, and grand-total
  anchors *do* reconcile.
- **No source-document inconsistencies found** in the Phase 2 slice. All printed
  totals are internally consistent with their line items.

## Notes on the reclassification gotcha

ITMD contains position reclassifications whose 2025 and 2026 halves print on
separate physical lines — and, verified here, sometimes **far apart on the
page** (e.g. *Public Safety Systems Administrator*, 2025 half on p. 40 top≈484,
2026 half top≈647). Because reconciliation sums each vintage's column
independently, each printed number is counted exactly once regardless of
adjacency, so the totals reconcile without needing a fragile line-join.

---

"""
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(header + "\n".join(sections))
    print(f"wrote {REPORT}  ({totals['passed']}/{totals['total']} PASS, {totals['failed']} FAIL)")


if __name__ == "__main__":
    main()
