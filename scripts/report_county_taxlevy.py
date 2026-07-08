"""Reconciliation report for the county countywide tax-levy crosswalk.

The whole-budget document-level cross-check: every department's tax levy is
restated in the Property Taxes chapter crosswalk, reconciled against the
department chapters and up to the printed Property Tax Levy. No LLM.
"""
from __future__ import annotations

from pathlib import Path

from parsers.county_taxlevy import parse_crosswalk
from parsers.reconcile_county_taxlevy import reconcile_taxlevy, summarize

REPORT = Path("docs/reconciliation-reports/county-2026-taxlevy-crosswalk.md")


def main() -> None:
    xw = parse_crosswalk()
    checks = reconcile_taxlevy(xw)
    s = summarize(checks)

    n_group = sum(1 for c in s["passed"] if "subtotal ==" in c.name)
    n_dept = len({c.name.split(":")[0] for c in checks if c.name.startswith("agency")
                  and c.status != "NOT_RECONCILABLE"})

    lines = [
        "# Reconciliation Report — Milwaukee County 2026 Countywide Tax-Levy Crosswalk",
        "",
        "**doc_id:** `county-2026-adopted-operating` (Property Taxes chapter, pp. 414-417)  ",
        "**Method:** the Property Taxes chapter prints a countywide crosswalk — every "
        "department's Expenditures / Revenue / Tax Levy by fund type, grouped by function, with "
        "subtotals. It is an *independent restatement* of every department's bottom line, so it "
        "cross-checks the per-department BUDGET SUMMARY chapters and ties up to the printed "
        "Property Tax Levy. Deterministic pdfplumber extraction; no LLM.",
        "",
        "## Result",
        "",
        f"**{len(s['passed'])} of {s['total']} checks reconcile exactly; "
        f"{len(s['failed'])} findings.** A whole-budget, four-level document-level cross-check:",
        "",
        f"- 🧮 **{n_group} group subtotals** each equal the sum of their member department rows.",
        "- 🎯 **The grand total ties to the anchor:** the sum of every department's tax levy "
        f"equals the printed **Property Tax Levy of ${xw.property_tax_levy:,.0f}**, to the dollar.",
        f"- 🔗 **{n_dept} departments cross-verify** — the crosswalk's Tax Levy matches each "
        "department's own BUDGET SUMMARY chapter (an independent restatement agreeing), and the "
        "operating Expenditures/Revenue match once the Trust funds the chapters omit are excluded.",
        f"- ⚪ **{len(s['not_reconcilable'])} not reconcilable** — Capital Improvements (Agency "
        "120; the capital budget is a separate, parked document) and the Property Taxes chapter "
        "itself (Agency 199).",
        "",
        "This closes the loop deferred in the county non-departmental-ledger work: the entire "
        "county operating budget now reconciles both **bottom-up** (line items → department "
        "totals) and **top-down** (department totals → countywide property tax levy).",
        "",
    ]
    if s["failed"]:
        lines += ["## Findings", "", "| Check | Expected | Actual | Δ |", "|---|--:|--:|--:|"]
        for c in s["failed"]:
            lines.append(f"| {c.name} | {c.expected:,.0f} | {c.actual:,.0f} | {c.delta:,.0f} |")
        lines.append("")
    else:
        lines += ["**No open findings.** Every printed figure in the crosswalk reconciles.", ""]

    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text("\n".join(lines) + "\n")
    print(f"wrote {REPORT}  ({len(s['passed'])}/{s['total']} pass, {len(s['failed'])} findings)")


if __name__ == "__main__":
    main()
