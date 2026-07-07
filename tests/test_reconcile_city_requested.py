"""Regression guard for the 2027 Requested Budget (the diff document).

It rides the same pipeline as the Adopted book via REQUESTED_LAYOUT; this pins
the segmentation and the reconciled share so a change to the shared parser can't
silently degrade the requested doc.
"""
from __future__ import annotations

import pytest

from parsers.city_detailed import REQUESTED_LAYOUT, parse_book
from parsers.reconcile_city import REQUESTED_VINTAGES, reconcile_unit, summarize


@pytest.fixture(scope="module")
def book():
    lo, hi = REQUESTED_LAYOUT.book_pages
    return parse_book(REQUESTED_LAYOUT.default_pdf, lo, hi, REQUESTED_LAYOUT)


def test_segments_into_expected_unit_count(book):
    assert 55 <= len(book) <= 63, f"unexpected unit count: {len(book)}"


def test_dollar_reconciliation_does_not_regress(book):
    dollars_ok = sum(
        1 for u in book if not summarize(reconcile_unit(u, REQUESTED_VINTAGES))["money_fail"]
    )
    assert dollars_ok >= 48, f"requested dollar-reconciled units regressed to {dollars_ok}/{len(book)}"


def test_four_vintages_present(book):
    kinds = {ln.amount_kind for u in book for ln in u.lines}
    assert {"actual", "budget", "requested"} <= kinds, kinds


def test_every_line_has_provenance(book):
    for u in book:
        for ln in u.lines:
            assert ln.source_page and ln.source_page > 0
            assert ln.doc_id == "city-2027-requested-detailed"
