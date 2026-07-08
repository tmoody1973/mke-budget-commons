"""Reconciliation regression guard for the MPS FY2026-27 Proposed Budget (.xlsx).

Every printed grand total must reconcile exactly against the summed line items,
for both vintages. The $21M Recreation Extension rows (outside the printed total)
must stay excluded and surfaced. Provenance on every row. No LLM.
"""
from __future__ import annotations

import pytest

from parsers.mps_lineitem import DEFAULT_XLSX, parse_workbook
from parsers.reconcile_mps import reconcile_book, summarize


@pytest.fixture(scope="module")
def book():
    return parse_workbook(DEFAULT_XLSX)


def test_expenditures_reconcile_to_published_total(book):
    """FY2027 expenditures sum to the published $1,600,555,548 (the '$1,600.6M') total."""
    assert book.exp_totals[2027].net == 1_600_555_548
    total = round(sum(l.amount or 0 for l in book.exp_lines if l.fiscal_year == 2027), 2)
    assert total == 1_600_555_548, f"FY27 expenditures sum to {total}, not the printed total"


def test_all_money_checks_pass(book):
    s = summarize(reconcile_book(book))
    assert not s["money_fail"], f"MPS money findings: {[(c.name, c.vintage, c.delta) for c in s['money_fail']]}"
    assert not s["failed"], f"unexpected FAIL: {[c.name for c in s['failed']]}"
    assert s["passed"] >= 8


def test_printed_totals_are_internally_consistent(book):
    """gross − eliminations == net for each vintage — the spreadsheet's own totals close."""
    for fy in (2026, 2027):
        t = book.exp_totals[fy]
        assert round(t.gross - t.eliminations, 2) == t.net


def test_revenue_reconciles_both_vintages(book):
    for fy in (2026, 2027):
        total = round(sum(l.amount or 0 for l in book.rev_lines if l.fiscal_year == fy), 2)
        assert abs(total - book.rev_totals[fy]) <= 0.01, f"FY{fy} revenue off by {total - book.rev_totals[fy]}"


def test_recreation_rows_are_excluded_not_dropped(book):
    """The $21M Recreation Extension revenue (no account code, outside the printed
    total) must be captured as a documented exclusion, not silently dropped or
    silently summed in."""
    assert len(book.excluded) == 2
    assert round(sum(e.fy26 or 0 for e in book.excluded), 2) == 21_000_000
    # and it is NOT in the reconciled revenue lines
    assert all("MKE Rec" not in (l.account or "") for l in book.rev_lines)


def test_two_vintages_present(book):
    kinds = {(l.amount_kind, l.fiscal_year) for l in book.lines}
    assert ("budget", 2026) in kinds and ("proposed", 2027) in kinds


def test_every_line_has_provenance(book):
    for l in book.lines:
        assert l.source_page and l.source_page > 0    # spreadsheet row
        assert l.doc_id == "mps-2027-proposed-lineitem"
        assert l.gov_id == "mps"
        assert l.department_printed


def test_schools_and_funds_present(book):
    depts = {l.department_printed for l in book.exp_lines}
    funds = {l.fund for l in book.exp_lines if l.fund}
    assert len(depts) >= 200, f"expected many schools/depts, got {len(depts)}"
    assert len(funds) >= 8, f"expected the fund set, got {funds}"
