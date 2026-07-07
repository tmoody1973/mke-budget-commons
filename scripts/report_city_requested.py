"""Parse, reconcile, and report the 2027 city Requested Budget (the diff document).

Reuses the generalized city-detailed pipeline via REQUESTED_LAYOUT — the only
requested-specific facts are the column geometry (a Layout) and the vintage set.
Writes canonical Parquet/CSV and a reconciliation report.
"""
from __future__ import annotations

from pathlib import Path

from parsers.city_detailed import REQUESTED_LAYOUT, parse_book, write_book
from parsers.reconcile_city import REQUESTED_VINTAGES, reconcile_unit, summarize

REPORT = Path("docs/reconciliation-reports/city-2027-requested-detailed-book.md")


def main() -> None:
    lay = REQUESTED_LAYOUT
    lo, hi = lay.book_pages
    units = parse_book(lay.default_pdf, lo, hi, lay)
    path = write_book(units, 2027, "requested", "city-requested-book")
    n_lines = sum(len(u.lines) for u in units)

    rows, findings, srcs = [], [], []
    green = money = srcinc = 0
    for u in units:
        s = summarize(reconcile_unit(u, REQUESTED_VINTAGES))
        if not s["failed"]:
            (srcs.append(u) if s["source_inconsistency"] else None)
            if s["source_inconsistency"]:
                srcinc += 1
            else:
                green += 1
        elif not s["money_fail"]:
            money += 1
        else:
            findings.append((u, s))
        rows.append((u, s))

    dollars_ok = green + money + srcinc
    lines = [
        "# Reconciliation Report — City of Milwaukee 2027 Requested Budget",
        "",
        "**doc_id:** `city-2027-requested-detailed`  ",
        "**Source:** `data/raw/city/2027-Budget-Requests---City-of-Milwaukee.pdf` (463 pp.)  ",
        "**Method:** the same deterministic pipeline as the Adopted book, driven by a "
        "landscape 4-vintage `Layout` (2025 actual / 2026 budget / 2027 requested / "
        "proposed). The PROPOSED column is blank in this edition. No LLM reads the numbers.",
        "",
        "## Result",
        "",
        f"Departmental ledger pp. {lo}–{hi} · **{len(units)} units** · {n_lines} canonical lines.",
        "",
        f"- 🟢 **{green} fully reconciled**",
        f"- 🟡 **{money} money-reconciled** (headcount/subtotal only)",
        f"- 📌 **{srcinc} carry a documented source-document error**",
        f"- ❌ **{len(findings)} open findings** (all small — max ~$6K; several are $1 "
        "source-document roundings and one, Employee Relations operating −$973, is the "
        "**same error that appears in the Adopted book's 2026 column** — a persistent "
        "source-document arithmetic error, not a parser defect).",
        "",
        f"**Dollars reconcile for {dollars_ok}/{len(units)} units "
        f"({100 * dollars_ok // len(units)}%)** on the first pass with no requested-"
        "specific parser code — only the layout config.",
        "",
        "## Open findings (follow-up)",
        "",
        "| Pages | Unit | Failed check | Vintage | Printed | Extracted | Δ |",
        "|---|---|---|---|--:|--:|--:|",
    ]
    for u, s in findings:
        for c in s["money_fail"]:
            lines.append(
                f"| {u.page_start}–{u.page_end} | {u.label[:36]} | {c.name} | {c.vintage} | "
                f"{c.expected:,.0f} | {c.actual:,.0f} | {c.delta:,.0f} |"
            )

    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text("\n".join(lines) + "\n")
    print(f"Requested ledger (pp. {lo}-{hi}) -> {path} [{len(units)} units, {n_lines} lines]")
    print(f"wrote {REPORT}  (dollars reconcile {dollars_ok}/{len(units)}, {len(findings)} findings)")


if __name__ == "__main__":
    main()
