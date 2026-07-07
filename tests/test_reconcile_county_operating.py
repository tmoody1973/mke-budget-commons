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
    assert green == len(book), f"fully-reconciled chapters regressed to {green}/{len(book)}"


def test_no_chapter_is_unreconciled(book):
    """Every chapter — including the non-departmental ledgers — reconciles against
    some printed identity. Nothing is silently dropped or left NOT_RECONCILABLE."""
    for d in book:
        s = summarize(reconcile_dept(d))
        assert not s["not_reconcilable"], \
            f"{d.label} left NOT_RECONCILABLE: {[c.disposition for c in s['not_reconcilable']]}"


def test_chapter_kinds(book):
    from collections import Counter
    kinds = Counter(d.chapter_kind for d in book)
    assert kinds["revenue_ledger"] == 2, f"expected 2 revenue ledgers, got {kinds['revenue_ledger']}"
    assert kinds["nondept_programs"] == 2, f"expected 2 non-dept program lists, got {kinds['nondept_programs']}"
    assert kinds["standard"] >= 30, f"standard departments regressed to {kinds['standard']}"


def test_revenue_ledger_reconciles(book):
    """Non-Departmental Revenues: the revenue item lines sum exactly to the
    printed Total Revenues in the adopted column, and are captured as facts."""
    d = next(u for u in book if u.department_printed.startswith("Non - Departmental Revenues"))
    assert d.chapter_kind == "revenue_ledger"
    checks = reconcile_dept(d)
    adopted = [c for c in checks
               if c.name == "revenue items == Total Revenues" and c.vintage == "2026 adopted"]
    assert adopted and adopted[0].status == "PASS", "2026 revenue ledger must reconcile exactly"
    assert adopted[0].expected == 184640761, "printed Total Revenues = 184,640,761"
    # the biggest line item is captured with provenance
    sales = [ln for ln in d.lines if "Sales Tax" in ln.line_description and ln.fiscal_year == 2026]
    assert sales and sales[0].amount == 108924164 and sales[0].source_page > 0


def test_no_phantom_program_names(book):
    """Requiring a Strategic Program Area heading removes the '(program on pN)'
    fallback that used to mis-capture stray non-departmental tables."""
    for d in book:
        for p in d.programs:
            assert not p.name.startswith("(program on"), f"phantom program in {d.label}: {p.name}"
