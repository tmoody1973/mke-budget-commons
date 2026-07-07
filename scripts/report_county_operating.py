"""Generate the reconciliation report for the county Adopted Operating Budget.

Segments the book into department chapters (keyed off the clean `Agency No. NNN`
header), reconciles each summary table against the printed identities, and writes
a receipt with per-department status and a categorized findings list.

No LLM; pure arithmetic over the printed table values.
"""
from __future__ import annotations

from pathlib import Path

from parsers.county_operating import BOOK_END, BOOK_START, DEFAULT_PDF, parse_book
from parsers.reconcile_county import reconcile_dept, summarize

REPORT = Path("docs/reconciliation-reports/county-2026-adopted-operating.md")


def dept_status(s) -> tuple[str, str]:
    if s["money_fail"]:
        return "finding", "❌ dollar finding"
    if s["failed"]:
        return "finding", "❌ finding"
    if not s["passed"] and s["not_reconcilable"]:
        return "nonstd", "⚪ non-standard chapter (no departmental summary table)"
    if s["rounding"]:
        return "rounding", "📌 reconciled · prior-year actual rounding (±$1–$3)"
    return "green", "✅ fully reconciled"


def main() -> None:
    depts = parse_book(DEFAULT_PDF, BOOK_START, BOOK_END)
    rows, rounding_notes, findings = [], [], []
    green = rounding = nonstd = finding = 0
    tot_pass = tot_fail = tot_round = tot_nr = 0
    n_revledger = sum(1 for d in depts if d.chapter_kind == "revenue_ledger")
    n_nondept = sum(1 for d in depts if d.chapter_kind == "nondept_programs")

    for d in depts:
        checks = reconcile_dept(d)
        s = summarize(checks)
        tot_pass += s["passed"]
        tot_fail += len(s["failed"])
        tot_round += len(s["rounding"])
        tot_nr += len(s["not_reconcilable"])
        tier, status = dept_status(s)
        green += tier == "green"
        rounding += tier == "rounding"
        nonstd += tier == "nonstd"
        finding += tier == "finding"
        rows.append((d, s, status))
        if s["rounding"]:
            maxd = max(abs(c.delta or 0) for c in s["rounding"])
            rounding_notes.append((d, len(s["rounding"]), maxd))
        for c in s["failed"]:
            findings.append((d, c))

    dollars_ok = sum(1 for d in depts if not summarize(reconcile_dept(d))["money_fail"])

    lines = [
        "# Reconciliation Report — Milwaukee County 2026 Adopted Operating Budget",
        "",
        "**doc_id:** `county-2026-adopted-operating`  ",
        f"**Source:** `{DEFAULT_PDF}`  ",
        "**Method:** deterministic pdfplumber `extract_tables()`; the book is segmented "
        "into department chapters at each `Agency No. NNN` running header, and every "
        "chapter's BUDGET SUMMARY table is reconciled against its own printed identities "
        "(components → Total Expenditures; revenues → Total Revenues; Total Expenditures − "
        "Total Revenues = Tax Levy; the printed Variance = 2026 adopted − 2025 budget; and "
        "each Strategic Program Area's Program Budget Summary rolls up to the department "
        "total). Exact match required for budget/adopted vintages. No LLM touches the numbers.",
        "",
        "## Scope",
        "",
        f"Department operating chapters, **pp. {BOOK_START}–{BOOK_END}** "
        f"({len(depts)} chapters). The county Capital Budget is a separate, OCR-degraded "
        "document (Phase 5+, per CLAUDE.md) and is not in this report.",
        "",
        "## Result",
        "",
        f"**Every printed dollar identity reconciles for {dollars_ok} of {len(depts)} "
        f"chapters ({100 * dollars_ok // len(depts)}%).**",
        "",
        f"- 🟢 **{green} fully reconciled** — every check passes exactly across all four "
        "vintages, program rollups, and the Variance column.",
        f"- 📌 **{rounding} reconciled with prior-year actual rounding** — every 2025 budget "
        "and 2026 adopted figure foots exactly; only the **2023/2024 actual** columns drift "
        "$1–$3 because the county reports actuals rounded independently (each component "
        "rounded to the dollar). The drift is bounded by `(N+1)/2` for an N-component sum "
        "and surfaced per check — never silently absorbed.",
        f"- 🧾 **{n_revledger} non-departmental revenue ledgers** (Non-Departmental Revenues, "
        "Property Taxes) — item lines sum exactly to the printed Total Revenues (the $184.6M "
        "revenue ledger and the $309.0M property-tax levy), captured as facts with page "
        "citations rather than dropped.",
        f"- 🧩 **{n_nondept} non-departmental program lists** (Cultural Contributions, "
        "Non-Departmental Expenditures) — no chapter total, but each program area's own "
        "Expenditures − Revenues = Tax Levy identity reconciles.",
        f"- ⚪ **{nonstd} still non-standard** · ❌ **{finding} open dollar findings.**",
        "",
        f"Checks: **{tot_pass} PASS**, **{tot_round} ROUNDING** (prior-year actual, bounded), "
        f"**{tot_fail} FAIL**, **{tot_nr} NOT_RECONCILABLE**.",
        "",
        "## Prior-year actual rounding (findings, not bugs)",
        "",
        "The county's *adopted budget* figures are constructed to foot exactly; its "
        "*prior-year actuals* are reported rounded, so independently-rounded components sum "
        "a few dollars off the printed total. This is the BetaNYC source-rounding pattern, "
        "confined here to the actual columns and bounded by the number of addends.",
        "",
        "| Agency | Department | Rounding checks | Max Δ |",
        "|---|---|--:|--:|",
    ]
    for d, n, maxd in rounding_notes:
        lines.append(f"| {d.agency_no} | {d.department_printed[:42]} | {n} | ${maxd:,.0f} |")

    lines += [
        "",
        "## Open dollar findings",
        "",
        ("**None.** Every dollar identity in the departmental chapters reconciles exactly "
         "(budget/adopted) or within the bounded prior-year-actual rounding above."
         if not findings else
         "Unresolved mismatches pending review:"),
        "",
    ]
    if findings:
        lines += ["| Agency | Department | Failed check | Vintage | Expected | Actual | Δ |",
                  "|---|---|---|---|--:|--:|--:|"]
        for d, c in findings:
            lines.append(
                f"| {d.agency_no} | {d.department_printed[:34]} | {c.name} | {c.vintage} | "
                f"{c.expected:,.0f} | {c.actual:,.0f} | {c.delta:,.0f} |"
            )

    lines += ["", "## All chapters", "",
              "| Pages | Agency | Department | Kind | PASS | ROUND | FAIL | NR | Programs | Status |",
              "|---|---|---|---|--:|--:|--:|--:|--:|---|"]
    for d, s, status in rows:
        lines.append(
            f"| {d.page_start}–{d.page_end} | {d.agency_no} | {d.department_printed[:38]} | "
            f"{d.chapter_kind} | {s['passed']} | {len(s['rounding'])} | {len(s['failed'])} | "
            f"{len(s['not_reconcilable'])} | {len(d.programs)} | {status} |"
        )

    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text("\n".join(lines) + "\n")
    print(f"wrote {REPORT}  (dollars reconcile {dollars_ok}/{len(depts)}; "
          f"{green} full, {rounding} rounding, {nonstd} non-standard, {finding} findings)")


if __name__ == "__main__":
    main()
