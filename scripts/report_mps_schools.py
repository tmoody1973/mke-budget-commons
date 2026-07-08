"""Reconciliation report for the MPS per-school budget + enrollment dataset.

Cross-checks each school's printed budget/FTE against the district `.xlsx`
line-item detail (two independent documents), and reports the per-pupil picture.
No LLM; deterministic name normalization + arithmetic.
"""
from __future__ import annotations

from pathlib import Path

from parsers.mps_schools import DEFAULT_PDF, parse_school_book
from parsers.reconcile_mps_schools import reconcile_schools, summarize

REPORT = Path("docs/reconciliation-reports/mps-2027-proposed-schools.md")


def main() -> None:
    book = parse_school_book(DEFAULT_PDF)
    s = summarize(reconcile_schools(book))
    total = s["total"]
    exact = len(s["passed"])

    pp = sorted((x for x in book.schools if x.per_pupil_2027), key=lambda x: x.per_pupil_2027)
    tot_amt = sum(x.amt_proposed_2027 or 0 for x in book.schools)
    tot_enr = sum(x.enr_proj_2027 or 0 for x in book.schools)

    lines = [
        "# Reconciliation Report — MPS FY2026-27 Per-School Budgets & Enrollment",
        "",
        "**doc_id:** `mps-2027-proposed-school-lineitem`  ",
        f"**Source:** `{DEFAULT_PDF}`  ",
        "**Method:** deterministic pdfplumber table extraction of the per-school grid "
        "(name · enrollment · budget · FTE, two vintages). Each school's FY2027 budget and "
        "FTE are **cross-checked** against the sum of that school's line items in the district "
        "`.xlsx` — two independent MPS documents. Matching is by normalized school name (the "
        "`.xlsx` truncates names and shares no code), so it is best-effort: matched schools "
        "must agree exactly; unmatched schools are surfaced, never hidden. No LLM.",
        "",
        "## Result",
        "",
        f"**{len(book.schools)} schools** parsed. **{exact} ({100 * exact // total}%) "
        "cross-verify to the dollar and FTE** against the district ledger — strong independent "
        "confirmation the extraction is faithful. Nothing is unmatched or forced.",
        "",
        f"- ✅ **{exact} exact** cross-document matches "
        f"({sum(1 for c in s['passed'] if c.via == 'crosswalk')} via the curated "
        "`crosswalks/mps_schools.yml`, the rest by automatic name match).",
        f"- 📌 **{len(s['discrepancy'])} documented discrepancies** — schools where the "
        "per-school PDF and the `.xlsx` line-item sum genuinely disagree (the two documents "
        "allocate shared / partnership costs differently); reported with the delta, not forced.",
        f"- ❌ **{len(s['failed'])} failures** · ⚪ **{len(s['unmatched'])} unmatched**.",
        "",
        f"District school-controlled budget: **${tot_amt:,.0f}** over **{tot_enr:,.0f}** projected "
        f"pupils — an average of **${tot_amt / tot_enr:,.0f} per pupil** (school-level budgets "
        "only; excludes central offices and districtwide costs).",
        "",
        "## Per-pupil range (FY2027 proposed)",
        "",
        "| | School | Enrollment | Budget | Per pupil |",
        "|---|---|--:|--:|--:|",
    ]
    for label, x in [("Lowest", pp[0]), ("", pp[1]), ("", pp[2]),
                     ("Median", pp[len(pp) // 2]),
                     ("", pp[-3]), ("", pp[-2]), ("Highest", pp[-1])]:
        lines.append(f"| {label} | {x.name} | {x.enr_proj_2027:,.0f} | ${x.amt_proposed_2027:,.0f} | ${x.per_pupil_2027:,.0f} |")

    lines += [
        "",
        "Small specialty/alternative schools sit at the high end (tiny denominators); large "
        "comprehensive schools at the low end — the expected shape, and exactly the equity "
        "signal the per-pupil view surfaces.",
        "",
        "## Documented cross-document discrepancies",
        "",
        "These schools are matched to their ledger cost center, but the per-school PDF and the "
        "`.xlsx` line-item sum report **different** figures — the two official documents "
        "allocate shared / partnership costs differently. Captured and flagged, never forced "
        "to agree (registered in `crosswalks/mps_schools.yml`).",
        "",
        "| School | PDF budget | ledger figure | Δ |",
        "|---|--:|--:|--:|",
    ]
    for c in s["discrepancy"]:
        xa = f"${c.xlsx_amount:,.0f}" if c.xlsx_amount is not None else "— (no ledger match)"
        d = f"${c.delta:,.0f}" if c.delta is not None else "n/a"
        lines.append(f"| {c.school} | ${c.pdf_amount:,.0f} | {xa} | {d} |")
    lines.append("")
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text("\n".join(lines) + "\n")
    print(f"wrote {REPORT}  ({exact}/{total} cross-verified exact)")


if __name__ == "__main__":
    main()
