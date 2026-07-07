"""Reconciliation regression guard for the county Adopted Operating Budget.

Segmenting the department chapters must keep producing a stable set of units, and
every printed dollar identity must reconcile — exactly for budget/adopted, within
the bounded prior-year-actual rounding for the actual columns. These are floors,
not targets; open findings (if any) are tracked in the reconciliation report.

No LLM. Pure arithmetic over the printed table values.
"""
from __future__ import annotations

import pytest

from parsers.county_operating import BOOK_END, BOOK_START, DEFAULT_PDF, parse_book
from parsers.reconcile_county import reconcile_dept, summarize


@pytest.fixture(scope="module")
def book():
    return parse_book(DEFAULT_PDF, BOOK_START, BOOK_END)


def test_segments_into_expected_chapter_count(book):
    assert 33 <= len(book) <= 40, f"unexpected chapter count: {len(book)}"


def test_county_board_fully_reconciles(book):
    """Agency 100 is the simplest chapter (no revenues, one program) and must stay
    green across every vintage, its program rollup, and the Variance column."""
    d = next(u for u in book if u.agency_no == "100")
    s = summarize(reconcile_dept(d))
    assert not s["failed"] and not s["not_reconcilable"], \
        f"County Board regressed: {[c.name for c in s['failed']]}"
    assert s["passed"] >= 18


def test_no_open_dollar_findings(book):
    """Every dollar identity reconciles exactly (budget/adopted) or within bounded
    prior-year-actual rounding. A FAIL on a money check is a genuine open finding."""
    for d in book:
        mf = summarize(reconcile_dept(d))["money_fail"]
        assert not mf, f"open dollar finding in {d.label}: " \
            f"{[(c.name, c.vintage, c.delta) for c in mf]}"


def test_no_unbounded_failures(book):
    """No check may FAIL outright — every discrepancy is PASS, bounded ROUNDING,
    or an explicitly labeled NOT_RECONCILABLE non-standard chapter."""
    for d in book:
        assert not summarize(reconcile_dept(d))["failed"], \
            f"unexpected FAIL in {d.label}"


def test_budget_and_adopted_are_exact(book):
    """Budget/adopted vintages get NO rounding tolerance — they must foot exactly.
    Rounding is confined to the prior-year actual columns."""
    for d in book:
        for c in reconcile_dept(d):
            if c.status == "ROUNDING":
                assert "actual" in c.vintage, \
                    f"rounding leaked into a non-actual vintage in {d.label}: {c.name} [{c.vintage}]"


def test_rounding_is_bounded(book):
    """Prior-year-actual rounding drift stays small — a real error would be orders
    of magnitude larger, not a few dollars."""
    for d in book:
        for c in reconcile_dept(d):
            if c.status == "ROUNDING":
                assert abs(c.delta) <= 20, \
                    f"suspiciously large 'rounding' in {d.label}: {c.name} Δ={c.delta}"


def test_every_line_has_provenance(book):
    for d in book:
        for ln in d.lines:
            assert ln.source_page and ln.source_page > 0
            assert ln.doc_id == "county-2026-adopted-operating"
            assert ln.gov_id == "county"


def test_fully_green_share_does_not_regress(book):
    green = sum(1 for d in book
                if not summarize(reconcile_dept(d))["failed"]
                and not summarize(reconcile_dept(d))["not_reconcilable"])
    assert green >= 33, f"fully-reconciled chapters regressed to {green}/{len(book)}"
