"""Whole-book (Phase 3) regression guard for the city Detailed Budget.

Segmenting pp.1-180 must keep producing a stable set of reconciliation units,
and the reconciled share must not regress. This is a floor, not the target —
the remaining findings are tracked in the book reconciliation report.
"""
from __future__ import annotations

import pytest

from parsers.city_detailed import BOOK_END, BOOK_START, DEFAULT_PDF, parse_book
from parsers.reconcile_city import reconcile_unit, summarize


@pytest.fixture(scope="module")
def book():
    return parse_book(DEFAULT_PDF, BOOK_START, BOOK_END)


def test_segments_into_expected_unit_count(book):
    assert 58 <= len(book) <= 66, f"unexpected unit count: {len(book)}"


def test_reconciled_share_does_not_regress(book):
    green = sum(1 for u in book if not summarize(reconcile_unit(u))["failed"])
    assert green >= 53, f"fully-reconciled units regressed to {green}/{len(book)}"


def test_dollar_reconciliation_does_not_regress(book):
    """Units where every printed DOLLAR anchor reconciles (headcount aside), incl.
    verified source-document errors — only genuine open findings count against this."""
    dollars_ok = sum(
        1 for u in book if not summarize(reconcile_unit(u))["money_fail"]
    )
    assert dollars_ok >= 60, f"dollar-reconciled units regressed to {dollars_ok}/{len(book)}"


def test_no_open_dollar_findings(book):
    """Every dollar discrepancy is reconciled or a documented source-document error."""
    for u in book:
        mf = summarize(reconcile_unit(u))["money_fail"]
        assert not mf, f"open dollar finding at pp{u.page_start}-{u.page_end}: {[c.name for c in mf]}"


def test_known_good_units_reconcile_in_book(book):
    """City Attorney and ITMD must stay green when found by whole-book segmentation."""
    def find(substr):
        return [u for u in book if substr.lower() in u.label.lower()]

    for name in ("City Attorney", "Information And Technology Management"):
        matches = find(name)
        assert matches, f"unit not found in book segmentation: {name!r}"
        u = matches[0]
        assert not summarize(reconcile_unit(u))["failed"], f"{name} regressed in book"


def test_every_book_line_has_provenance(book):
    for u in book:
        for ln in u.lines:
            assert ln.source_page and ln.source_page > 0
