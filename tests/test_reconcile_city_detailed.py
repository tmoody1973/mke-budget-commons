"""Reconciliation suite for the city Detailed Budget (Phase 2 vertical slice).

Extracted line items must sum EXACTLY to the document's own printed
reserved-code anchors, per vintage column. A FAIL here is a finding: either a
parser bug or a source-document inconsistency to disposition — never something
to paper over. The one legitimate NOT_RECONCILABLE (2024 salaries) is asserted
explicitly so it can't silently spread.

Targets (2026 Adopted Detailed Budget, doc_id city-2026-adopted-detailed):
  - Department of Administration – ITMD division   pp. 40-42
  - City Attorney                                   pp. 47-49
"""
from __future__ import annotations

import pytest

from parsers.canonical import ACTUAL, BUDGET, ADOPTED
from parsers.city_detailed import DEFAULT_PDF, TARGETS, parse_range
from parsers.reconcile_city import reconcile_unit, summarize


@pytest.fixture(scope="module")
def units():
    out = {}
    for name in ("itmd", "city-attorney"):
        t = TARGETS[name]
        out[name] = parse_range(DEFAULT_PDF, t["start"], t["end"])
    return out


@pytest.mark.parametrize("name", ["itmd", "city-attorney"])
def test_no_reconciliation_failures(units, name):
    """Zero FAILs. If this trips, print every delta — do not swallow it."""
    checks = reconcile_unit(units[name])
    failures = [c for c in checks if c.status == "FAIL"]
    if failures:
        report = "\n".join(
            f"  FAIL [{c.vintage}] {c.name}: expected={c.expected} "
            f"actual={c.actual} delta={c.delta}"
            for c in failures
        )
        pytest.fail(f"{name}: {len(failures)} reconciliation mismatch(es):\n{report}")


@pytest.mark.parametrize("name", ["itmd", "city-attorney"])
def test_only_documented_not_reconcilable(units, name):
    """The only allowed NOT_RECONCILABLE is 2024 salaries (no per-position actuals)."""
    checks = reconcile_unit(units[name])
    nr = [c for c in checks if c.status == "NOT_RECONCILABLE"]
    assert all(c.vintage == ACTUAL and "NET SALARIES" in c.name for c in nr), (
        f"{name}: unexpected NOT_RECONCILABLE beyond the documented 2024-salary case: "
        f"{[(c.name, c.vintage) for c in nr]}"
    )


def _anchor(unit, kind, vintage, attr="amount"):
    for ln, k in zip(unit.lines, unit.kinds):
        if k == kind and ln.amount_kind == vintage:
            return getattr(ln, attr)
    return None


def test_city_attorney_printed_anchors(units):
    """Regression guard: exact printed totals for City Attorney (hand-verified)."""
    u = units["city-attorney"]
    assert _anchor(u, "salary_tba", BUDGET) == 6_468_382
    assert _anchor(u, "anchor_net_salaries", BUDGET) == 6_028_111
    assert _anchor(u, "anchor_net_salaries", BUDGET, "units") == 64
    assert _anchor(u, "anchor_operating", BUDGET) == 407_200
    assert _anchor(u, "anchor_equipment", BUDGET) == 26_000
    assert _anchor(u, "anchor_grand_total", BUDGET) == 9_173_961
    assert _anchor(u, "anchor_grand_total", ADOPTED) == 9_356_963


def test_itmd_printed_anchors(units):
    """Regression guard: ITMD, incl. special funds and reclassification joins."""
    u = units["itmd"]
    assert _anchor(u, "salary_tba", BUDGET) == 7_000_589
    assert _anchor(u, "salary_tba", BUDGET, "units") == 101
    assert _anchor(u, "anchor_net_salaries", BUDGET) == 6_004_481
    assert _anchor(u, "anchor_operating", BUDGET) == 4_157_335
    assert _anchor(u, "anchor_special", BUDGET) == 2_226_292
    assert _anchor(u, "anchor_grand_total", BUDGET) == 15_115_124
    assert _anchor(u, "anchor_grand_total", ADOPTED) == 15_321_711


@pytest.mark.parametrize("name", ["itmd", "city-attorney"])
def test_every_line_has_provenance(units, name):
    """Non-negotiable: no canonical row ships without a source_page."""
    for ln in units[name].lines:
        assert ln.source_page is not None and ln.source_page > 0
        assert ln.doc_id == "city-2026-adopted-detailed"


@pytest.mark.parametrize("name", ["itmd", "city-attorney"])
def test_reconciliation_mostly_green(units, name):
    """Sanity on the aggregate: the slice is overwhelmingly reconciled."""
    s = summarize(reconcile_unit(units[name]))
    assert len(s["failed"]) == 0
    assert s["passed"] >= 18  # 21 checks, 3 vintages; only 2024 salaries is NR
