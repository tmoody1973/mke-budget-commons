"""Reconciliation for the city Detailed Budget — the trust layer.

Sums extracted line items per vintage column and compares them to the
document's own printed reserved-code anchors. Exact match required. A mismatch
is a *finding*, not a swallowed exception: it is reported with the delta.

Design notes (verified against the 2026 Adopted book):
- Salaries reconcile as  sum(position $) + sum(adjustments/deductions $) == 006000
  NET SALARIES. This holds for detailed departments (positions → Total Before
  Adjustments → net) AND for summary departments (no positions, a single
  "All Other Salaries & Wages" line).
- Equipment reconciles via the printed *subtotals* (Additional + Replacement),
  which are present even when individual items are not itemized.
- A printed total with nothing itemized under it (e.g. a summary page's SPECIAL
  FUNDS TOTAL, whose items live on the detail pages) is NOT_RECONCILABLE, never
  a FAIL.
- 2024 salaries are NOT_RECONCILABLE: the book prints no per-position actuals.

No LLM. Pure arithmetic over canonical BudgetLine rows.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import yaml

from parsers.canonical import ACTUAL, ADOPTED, BUDGET, PROPOSED, REQUESTED
from parsers.city_detailed import ParsedUnit

EPS = 0.005  # dollars are integers; guard float noise only

_DISPOSITIONS_PATH = Path(__file__).resolve().parent.parent / "crosswalks" / "source_inconsistencies.yml"


def _load_dispositions() -> list[dict]:
    if not _DISPOSITIONS_PATH.exists():
        return []
    return yaml.safe_load(_DISPOSITIONS_PATH.read_text()) or []


SOURCE_INCONSISTENCIES = _load_dispositions()


def _disposition_for(page_start, name, vintage, expected, actual) -> Optional[dict]:
    """A verified source-document error only matches when the exact numbers hold."""
    for d in SOURCE_INCONSISTENCIES:
        if (d.get("page_start") == page_start and d.get("check", "") in name
                and d.get("vintage") == vintage
                and expected is not None and actual is not None
                and abs(expected - d.get("printed_total", object())) <= EPS
                and abs(actual - d.get("extracted_sum", object())) <= EPS):
            return d
    return None

VINTAGE_LABEL = {ACTUAL: "2024 actual", BUDGET: "2025 budget", ADOPTED: "2026 adopted"}
ALL_VINTAGES = [ACTUAL, BUDGET, ADOPTED]
# Requested-book vintages actually populated (2025 actual / 2026 budget / 2027
# requested). PROPOSED is blank in this edition — captured if present, not reconciled.
REQUESTED_VINTAGES = [ACTUAL, BUDGET, REQUESTED]


@dataclass
class Check:
    name: str
    vintage: str
    expected: Optional[float]
    actual: Optional[float]
    status: str                       # PASS | FAIL | NOT_RECONCILABLE
    disposition: str = ""

    @property
    def delta(self) -> Optional[float]:
        if self.expected is None or self.actual is None:
            return None
        return round(self.actual - self.expected, 2)


def _sum(unit: ParsedUnit, kinds, vintage: str, attr: str = "amount") -> tuple[float, int]:
    if isinstance(kinds, str):
        kinds = (kinds,)
    total, n = 0.0, 0
    for ln, k in zip(unit.lines, unit.kinds):
        if k in kinds and ln.amount_kind == vintage:
            v = getattr(ln, attr)
            if v is not None:
                total += v
                n += 1
    return round(total, 2), n


def _anchor(unit: ParsedUnit, kind: str, vintage: str, attr: str = "amount") -> Optional[float]:
    for ln, k in zip(unit.lines, unit.kinds):
        if k == kind and ln.amount_kind == vintage:
            return getattr(ln, attr)
    return None


def reconcile_unit(unit: ParsedUnit, vintages: Optional[list] = None,
                   actual_kind: str = ACTUAL) -> list[Check]:
    checks: list[Check] = []
    vintages = vintages if vintages is not None else ALL_VINTAGES

    page_start = unit.page_start

    def cmp(name, vintage, expected, actual, *, disposition=""):
        if expected is None or actual is None:
            checks.append(Check(name, vintage, expected, actual, "NOT_RECONCILABLE", disposition))
            return
        if abs(actual - expected) <= EPS:
            checks.append(Check(name, vintage, expected, actual, "PASS", disposition))
            return
        # A FAIL that matches a verified arithmetic error in the source PDF is a
        # documented finding, not a parser defect.
        disp = _disposition_for(page_start, name, vintage, expected, actual)
        if disp:
            checks.append(Check(name, vintage, expected, actual, "SOURCE_INCONSISTENCY", disp["note"]))
        else:
            checks.append(Check(name, vintage, expected, actual, "FAIL", disposition))

    def nr(name, vintage, expected, actual, disposition):
        checks.append(Check(name, vintage, expected, actual, "NOT_RECONCILABLE", disposition))

    def itemized(name, vintage, item_sum, item_n, anchor, disposition):
        """Reconcile a summed item set against a printed total, honestly."""
        if item_n == 0 and (anchor in (None, 0)):
            checks.append(Check(name, vintage, 0.0, 0.0, "PASS"))
        elif item_n == 0 and anchor:
            nr(name, vintage, anchor, 0.0, disposition)
        else:
            cmp(name, vintage, anchor, item_sum)

    for v in vintages:
        # ---------------- Salaries ----------------
        net = _anchor(unit, "anchor_net_salaries", v)
        net_units = _anchor(unit, "anchor_net_salaries", v, "units")
        pos_d, pos_n = _sum(unit, "position", v)
        pos_u, _ = _sum(unit, "position", v, "units")
        adj, adj_n = _sum(unit, ("salary_adjustment", "salary_deduction"), v)
        tba = _anchor(unit, "salary_tba", v)
        tba_u = _anchor(unit, "salary_tba", v, "units")

        if v == actual_kind:
            nr("position$ + adjustments == NET SALARIES (006000)", v, net, None,
               "prior-year actuals have no per-position detail")
        elif net is not None and pos_n == 0 and adj_n == 0:
            # Department SUMMARY page: prints only the rolled-up NET SALARIES with
            # no positions or components. The components reconcile on the division
            # detail pages, so there is nothing to sum here.
            nr("position$ + adjustments == NET SALARIES (006000)", v, net, None,
               "summary page: salaries not itemized (detail on division pages)")
        elif net is not None:
            cmp("position$ + adjustments == NET SALARIES (006000)", v, net, round(pos_d + adj, 2))
            if net_units is not None:
                cmp("position units == NET SALARIES units (006000)", v, net_units, pos_u)
            if tba is not None:
                cmp("positions == Total Before Adjustments ($)", v, tba, pos_d)
                if tba_u is not None:
                    cmp("positions == Total Before Adjustments (units)", v, tba_u, pos_u)

        # ---------------- Operating (006300) ----------------
        op_sum, op_n = _sum(unit, "expenditure", v)
        op_anchor = _anchor(unit, "anchor_operating", v)
        itemized("operating items == 006300", v, op_sum, op_n, op_anchor,
                 "operating total not itemized on this page")

        # ---------------- Equipment (006800) via subtotals ----------------
        sub_sum, sub_n = _sum(unit, "subtotal", v)
        item_sum, item_n = _sum(unit, "equipment_item", v)
        eq_sum, eq_n = (sub_sum, sub_n) if sub_n > 0 else (item_sum, item_n)
        eq_anchor = _anchor(unit, "anchor_equipment", v)
        itemized("equipment subtotals == 006800", v, eq_sum, eq_n, eq_anchor,
                 "equipment total not itemized on this page")

        # ---------------- Special funds ----------------
        sp_sum, sp_n = _sum(unit, "special_item", v)
        sp_anchor = _anchor(unit, "anchor_special", v)
        itemized("special items == SPECIAL FUNDS TOTAL", v, sp_sum, sp_n, sp_anchor,
                 "special funds not itemized on this page (detail on division pages)")

        # ---------------- Grand total = sum of printed anchors ----------------
        net_anchor = _anchor(unit, "anchor_net_salaries", v)
        fringe = _anchor(unit, "anchor_fringe", v)
        grand = _anchor(unit, "anchor_grand_total", v)
        parts0 = [p if p is not None else 0.0
                  for p in (net_anchor, fringe, op_anchor, eq_anchor, sp_anchor)]
        if grand is not None and net_anchor is not None and fringe is not None:
            cmp("006000+006100+006300+006800+special == unit total", v, grand, round(sum(parts0), 2))
        elif grand is not None:
            # summary rollup: a sub-anchor (typically fringe) isn't printed here
            nr("006000+006100+006300+006800+special == unit total", v, grand, None,
               "summary page: sub-anchors not all itemized (detail on division pages)")
        else:
            nr("006000+006100+006300+006800+special == unit total", v, grand, None,
               "no printed unit total on this page")

    return checks


# A "money-critical" check ties a summed line set to a printed DOLLAR total. The
# position-count checks and the positions-vs-Total-Before-Adjustments subtotal are
# structural: they can fail on wrapped-pay-range positions (whose salary lands in
# the adjustment bucket) while every dollar anchor — including NET SALARIES — still
# reconciles exactly. Those units are money-reconciled, just not headcount-clean.
def is_money_check(name: str) -> bool:
    return (
        "== NET SALARIES (006000)" in name  # position$ + adjustments == net (dollars)
        or "006300" in name
        or "006800" in name
        or "SPECIAL FUNDS TOTAL" in name
        or "unit total" in name
    )


def summarize(checks: list[Check]) -> dict:
    passed = sum(1 for c in checks if c.status == "PASS")
    failed = [c for c in checks if c.status == "FAIL"]
    nr = [c for c in checks if c.status == "NOT_RECONCILABLE"]
    source_inc = [c for c in checks if c.status == "SOURCE_INCONSISTENCY"]
    money_fail = [c for c in failed if is_money_check(c.name)]
    return {
        "passed": passed, "failed": failed, "not_reconcilable": nr,
        "source_inconsistency": source_inc, "money_fail": money_fail,
        "total": len(checks),
    }
