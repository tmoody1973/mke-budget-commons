"""Generate the whole-book reconciliation report for the city Detailed Budget.

Segments the departmental ledger (pp.1-180) into reconciliation units, reconciles
each against its printed anchors, and writes a receipt with per-unit status and a
categorized findings list. Citywide fund / capital / special-purpose sections
(pp.181+) are a different doc species and out of P0 scope.

No LLM; pure arithmetic over canonical rows.
"""
from __future__ import annotations

from pathlib import Path

from parsers.city_detailed import BOOK_END, BOOK_START, DEFAULT_PDF, parse_book
from parsers.reconcile_city import reconcile_unit, summarize

REPORT = Path("docs/reconciliation-reports/city-2026-adopted-detailed-book.md")


def money_category(money_fail) -> str:
    maxd = max(abs(c.delta or 0) for c in money_fail)
    if maxd <= 1:
        return "$1 source-rounding"
    if maxd < 100_000:
        return "small-money"
    return "structural"


def unit_status(s) -> tuple[str, str]:
    if not s["failed"]:
        if s["source_inconsistency"]:
            return "srcinc", "📌 reconciled · source-doc $1 error flagged"
        return "green", "✅ fully reconciled"
    if not s["money_fail"]:
        return "money", "🟡 money-reconciled (headcount/subtotal off)"
    return "finding", "❌ dollar finding"


def main() -> None:
    units = parse_book(DEFAULT_PDF, BOOK_START, BOOK_END)
    rows, money_findings, src_findings = [], [], []
    green = money = finding = srcinc = 0
    tot_pass = tot_fail = tot_nr = 0

    for u in units:
        checks = reconcile_unit(u)
        s = summarize(checks)
        tot_pass += s["passed"]
        tot_fail += len(s["failed"])
        tot_nr += len(s["not_reconcilable"])
        tier, status = unit_status(s)
        green += tier == "green"
        money += tier == "money"
        finding += tier == "finding"
        srcinc += tier == "srcinc"
        rows.append((u, s, status))
        if tier == "finding":
            money_findings.append((u, s, money_category(s["money_fail"])))
        for c in s["source_inconsistency"]:
            src_findings.append((u, c))

    cats = {}
    for _, _, c in money_findings:
        cats[c] = cats.get(c, 0) + 1
    dollars_ok = green + money + srcinc

    lines = [
        "# Reconciliation Report — City of Milwaukee 2026 Adopted Detailed Budget (whole book)",
        "",
        "**doc_id:** `city-2026-adopted-detailed`  ",
        f"**Source:** `data/raw/city/2026-CITY-OF-MILWAUKEE-DETAILED-BUDGET4.pdf`  ",
        "**Method:** deterministic pdfplumber + regex; the book is segmented into "
        "reconciliation units at each printed division/control-unit total, and every "
        "unit's line items are summed per vintage column against its printed "
        "reserved-code anchors. Exact match required. No LLM touches the numbers.",
        "",
        "## Scope",
        "",
        f"Departmental line-item ledger, **pp. {BOOK_START}–{BOOK_END}**. The citywide "
        "fund, special-purpose, and capital sections (pp. 181–269 — General City "
        "Purposes, Provision for Retirement, Transportation/Parking Funds, Water & "
        "Sewer enterprise funds, Capital Improvements) are a different document species "
        "and out of P0 scope per CLAUDE.md.",
        "",
        "## Result",
        "",
        f"**Every dollar anchor reconciles exactly for {dollars_ok} of {len(units)} units "
        f"({100 * dollars_ok // len(units)}%).**",
        "",
        f"- 🟢 **{green} fully reconciled** — every check passes, including position headcount.",
        f"- 🟡 **{money} money-reconciled** — every printed dollar total (NET salaries, "
        "operating, equipment, special funds, grand total) reconciles exactly; only the "
        "position *count* / positions-vs-Total-Before-Adjustments subtotal is off, because "
        "a position whose pay range wraps to the next line lands in the salary-adjustment "
        "bucket. The money is fully captured.",
        f"- 📌 **{srcinc} reconciled with a flagged source-document error** — the extracted "
        "line items are exact, but the document's own printed total is off by $1 (below).",
        f"- ❌ **{finding} dollar findings** — a printed dollar total does not match; listed below.",
        "",
        f"Checks: **{tot_pass} PASS**, **{tot_fail} FAIL**, **{tot_nr} NOT_RECONCILABLE** "
        "(2024 salaries have no per-position actuals; summary rollup pages itemize their "
        "components on the division detail pages).",
        "",
        "### Dollar findings by size",
        "",
        "| Category | Units | Meaning |",
        "|---|--:|---|",
        f"| structural | {cats.get('structural', 0)} | Fire Department's multi-bureau "
        "decision-unit layout — needs a dedicated parse branch |",
        f"| small-money | {cats.get('small-money', 0)} | one line item off by $1K–$140K — line-level review |",
        f"| $1 source-rounding | {cats.get('$1 source-rounding', 0)} | off by exactly $1 — "
        "candidate source-document inconsistency (BetaNYC pattern), pending confirmation |",
        "",
        "## Source-document inconsistencies (findings, not bugs)",
        "",
        "Verified arithmetic errors **inside the official PDF**: the document's own "
        "printed line items sum to a different figure than its printed total. Confirmed "
        "by summing the printed items by hand; extraction is exact. Registered in "
        "`crosswalks/source_inconsistencies.yml` — the disposition only holds while the "
        "exact numbers match, so a future parser change re-surfaces it.",
        "",
        "| Pages | Unit | Check | Vintage | Printed total | Items sum | Δ |",
        "|---|---|---|---|--:|--:|--:|",
    ]
    for u, c in src_findings:
        lines.append(
            f"| {u.page_start}–{u.page_end} | {u.label[:38]} | {c.name} | {c.vintage} | "
            f"{c.expected:,.0f} | {c.actual:,.0f} | {c.delta:,.0f} |"
        )
    lines += [
        "",
        "## Open dollar findings",
        "",
        ("**None.** Every dollar discrepancy in the ledger is either reconciled or a "
         "documented source-document error above."
         if not money_findings else
         "Unresolved mismatches pending line-level review:"),
        "",
        "| Pages | Unit | Size | Failed dollar check | Vintage | Printed | Extracted | Δ |",
        "|---|---|---|---|---|--:|--:|--:|",
    ]
    for u, s, cat in money_findings:
        for c in s["money_fail"]:
            lines.append(
                f"| {u.page_start}–{u.page_end} | {u.label[:40]} | {cat} | {c.name} | "
                f"{c.vintage} | {c.expected:,.0f} | {c.actual:,.0f} | {c.delta:,.0f} |"
            )
    lines += ["", "## All units", "",
              "| Pages | Unit | PASS | FAIL | NR | Status |",
              "|---|---|--:|--:|--:|---|"]
    for u, s, status in rows:
        lines.append(
            f"| {u.page_start}–{u.page_end} | {u.label[:46]} | {s['passed']} | "
            f"{len(s['failed'])} | {len(s['not_reconcilable'])} | {status} |"
        )

    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text("\n".join(lines) + "\n")
    print(f"wrote {REPORT}  (dollars reconcile {dollars_ok}/{len(units)}; "
          f"{green} full, {money} money-only, {finding} findings)")


if __name__ == "__main__":
    main()
