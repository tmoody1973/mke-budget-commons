"""Regression guard for the county countywide tax-levy crosswalk.

The whole-budget document-level cross-check: group subtotals, the grand-total tie
to the printed Property Tax Levy, and per-department agreement with the BUDGET
SUMMARY chapters. No LLM.
"""
from __future__ import annotations

import pytest

from parsers.county_taxlevy import parse_crosswalk
from parsers.reconcile_county_taxlevy import reconcile_taxlevy, summarize


@pytest.fixture(scope="module")
def crosswalk():
    return parse_crosswalk()


@pytest.fixture(scope="module")
def checks(crosswalk):
    return reconcile_taxlevy(crosswalk)


def test_parses_the_crosswalk(crosswalk):
    assert len(crosswalk.rows) >= 50
    assert len(crosswalk.subtotals) >= 10
    assert crosswalk.property_tax_levy == 309_014_834


def test_grand_total_ties_to_property_tax_levy(crosswalk):
    """Every department's tax levy sums to the printed Property Tax Levy, to the dollar."""
    total = round(sum(s.tax_levy or 0 for s in crosswalk.subtotals), 2)
    assert total == crosswalk.property_tax_levy == 309_014_834


def test_no_open_findings(checks):
    s = summarize(checks)
    assert not s["failed"], f"crosswalk findings: {[(c.name, c.delta) for c in s['failed']]}"


def test_departments_cross_verify(checks):
    """Most departments' crosswalk tax levy matches their BUDGET SUMMARY chapter."""
    tl = [c for c in checks if "crosswalk Tax Levy == chapter Tax Levy" in c.name]
    assert len(tl) >= 25, f"only {len(tl)} departments cross-checked"
    assert all(c.status == "PASS" for c in tl), \
        f"tax-levy mismatch: {[c.name for c in tl if c.status != 'PASS']}"


def test_only_capital_and_property_tax_are_unreconcilable(checks):
    s = summarize(checks)
    for c in s["not_reconcilable"]:
        assert "120" in c.name or "199" in c.name, f"unexpected NOT_RECONCILABLE: {c.name}"


def test_reconciled_share_is_high(checks):
    s = summarize(checks)
    assert len(s["passed"]) / s["total"] >= 0.95, \
        f"reconciled share dropped to {len(s['passed'])}/{s['total']}"
