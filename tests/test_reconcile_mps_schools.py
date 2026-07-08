"""Regression guard for the MPS per-school budget + enrollment dataset.

The per-school PDF must parse cleanly, compute per-pupil, and cross-verify to the
district ledger for the large majority of schools (matched → exact). Provenance
on every row. No LLM.
"""
from __future__ import annotations

import pytest

from parsers.mps_schools import DEFAULT_PDF, parse_school_book
from parsers.reconcile_mps_schools import reconcile_schools, summarize


@pytest.fixture(scope="module")
def book():
    return parse_school_book(DEFAULT_PDF)


def test_parses_all_schools(book):
    assert 120 <= len(book.schools) <= 160, f"unexpected school count: {len(book.schools)}"


def test_enrollment_total_is_plausible(book):
    enr = sum(s.enr_proj_2027 or 0 for s in book.schools)
    assert 45_000 <= enr <= 65_000, f"district enrollment {enr} outside plausible MPS range"


def test_per_pupil_is_computed(book):
    with_pp = [s for s in book.schools if s.per_pupil_2027]
    assert len(with_pp) >= 120
    # a known school reconciles exactly against the ledger, so its per-pupil is trustworthy
    alcott = next((s for s in book.schools if s.name.upper().startswith("ALCOTT")), None)
    assert alcott and alcott.amt_proposed_2027 == 4_490_929 and alcott.enr_proj_2027 == 342


def test_matched_schools_cross_verify_exactly(book):
    """The crosswalk + automatic matching must cross-verify the large majority of
    schools to the dollar and FTE. Remaining schools are documented discrepancies
    (the two documents genuinely disagree), never silent failures."""
    s = summarize(reconcile_schools(book))
    assert len(s["passed"]) >= 120, f"cross-verified schools regressed to {len(s['passed'])}"
    assert not s["failed"], f"unexpected FAIL (bad crosswalk mapping?): {[c.school for c in s['failed']]}"
    assert not s["unmatched"], f"unexpected UNMATCHED: {[c.school for c in s['unmatched']]}"


def test_crosswalk_mappings_reconcile(book):
    """Every curated crosswalk mapping must still reconcile exactly — a wrong
    name→code mapping would show up here as a FAIL, so the crosswalk is self-checking."""
    s = summarize(reconcile_schools(book))
    xw = [c for c in s["passed"] if c.via == "crosswalk"]
    assert len(xw) >= 25, f"crosswalk-verified schools regressed to {len(xw)}"


def test_nothing_silently_dropped(book):
    """Every school is accounted for: exact, documented-discrepancy, reported-fail,
    or surfaced-unmatched."""
    s = summarize(reconcile_schools(book))
    assert (len(s["passed"]) + len(s["discrepancy"]) + len(s["failed"])
            + len(s["unmatched"]) == len(book.schools))


def test_every_line_has_provenance(book):
    for l in book.lines:
        assert l.source_page and l.source_page > 0
        assert l.doc_id == "mps-2027-proposed-school-lineitem"
        assert l.gov_id == "mps"
        assert l.department_printed
