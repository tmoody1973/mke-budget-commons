"""Reconciliation for the county Adopted Operating Budget — the trust layer.

The county book hands us a set of printed identities per department summary
table. We check them exactly. A mismatch is a *finding*, reported with the
delta — never a swallowed exception.

Identities (per department, per vintage column unless noted):
  1. Personnel + Operations + Debt & Depreciation + Interdepartmental Charges
     == Total Expenditures.
  2. sum(revenue rows) == Total Revenues (departments with revenues only).
  3. Total Expenditures − Total Revenues == Tax Levy.
  4. Variance == (2026 adopted − 2025 budget), per summary row (free check).
  5. sum(program-area Expenditures) == department Total Expenditures (programs
     roll up to the department).

No LLM. Pure arithmetic over the printed table values.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import yaml

from parsers.canonical import ACTUAL, ADOPTED, BUDGET
from parsers.county_operating import VINTAGES, CountyDept, Row

EPS = 0.005  # dollars/FTE are printed as integers; guard float noise only

_DISPOSITIONS_PATH = (
    Path(__file__).resolve().parent.parent / "crosswalks" / "source_inconsistencies.yml"
)

# Variance is defined as 2026 adopted − 2025 budget → column indices 3 and 2.
_ADOPTED_COL = 3
_BUDGET_COL = 2

VINTAGE_LABEL = {0: "2023 actual", 1: "2024 actual", 2: "2025 budget", 3: "2026 adopted"}


def _load_dispositions() -> list[dict]:
    if not _DISPOSITIONS_PATH.exists():
        return []
    return yaml.safe_load(_DISPOSITIONS_PATH.read_text()) or []


SOURCE_INCONSISTENCIES = _load_dispositions()


def _disposition_for(page, name, vintage, expected, actual) -> Optional[dict]:
    """A verified county source-document error matches only on exact numbers."""
    for d in SOURCE_INCONSISTENCIES:
        if (d.get("gov") == "county"
                and d.get("page_start") == page
                and d.get("check", "") in name
                and d.get("vintage") == vintage
                and expected is not None and actual is not None
                and abs(expected - d.get("printed_total", object())) <= EPS
                and abs(actual - d.get("extracted_sum", object())) <= EPS):
            return d
    return None


@dataclass
class Check:
    name: str
    vintage: str                       # human label, e.g. "2026 adopted"
    expected: Optional[float]
    actual: Optional[float]
    status: str                        # PASS | FAIL | ROUNDING | NOT_RECONCILABLE | SOURCE_INCONSISTENCY
    disposition: str = ""

    @property
    def delta(self) -> Optional[float]:
        if self.expected is None or self.actual is None:
            return None
        return round(self.actual - self.expected, 2)


def _rounding_bound(addends: int) -> float:
    """Max drift when summing N independently-rounded figures against a printed
    total that is itself rounded once: (N+1)/2. Anything larger is a real finding,
    not rounding — a genuine error lands orders of magnitude above this."""
    return (max(addends, 1) + 1) / 2 + EPS


def _col(row: Optional[Row], i: int) -> Optional[float]:
    if row is None:
        return None
    return row.values[i]


def _sum_col(rows: list[Row], i: int) -> tuple[float, int]:
    total, n = 0.0, 0
    for r in rows:
        v = r.values[i]
        if v is not None:
            total += v
            n += 1
    return round(total, 2), n


def _reconcile_program_taxlevy(prog, cmp) -> None:
    """A program-area rollup's own identity: Expenditures − Revenues == Tax Levy."""
    exp = next((r for r in prog.rows if r.section == "expenditure"), None)
    rev = next((r for r in prog.rows if r.section == "revenue"), None)
    tl = next((r for r in prog.rows if r.section == "tax_levy"), None)
    if exp is None or tl is None:
        return
    for i, label in VINTAGE_LABEL.items():
        e = exp.values[i]
        r = (rev.values[i] if rev else 0.0) or 0.0
        cmp(f"[{prog.name}] Expenditures − Revenues == Tax Levy", label,
            tl.values[i], None if e is None else round(e - r, 2), addends=2)


def reconcile_dept(dept: CountyDept) -> list[Check]:
    checks: list[Check] = []
    page = dept.summary_page or dept.page_start

    def cmp(name, vintage, expected, actual, *, addends=1, disposition=""):
        if expected is None or actual is None:
            checks.append(Check(name, vintage, expected, actual, "NOT_RECONCILABLE", disposition))
            return
        if abs(actual - expected) <= EPS:
            checks.append(Check(name, vintage, expected, actual, "PASS", disposition))
            return
        # Prior-year ACTUALS are reported rounded; independently-rounded components
        # drift a few dollars from the printed total. Bounded, actual-only, and
        # surfaced distinctly — never silently absorbed. Budget/adopted are exact.
        if "actual" in vintage and abs(actual - expected) <= _rounding_bound(addends):
            checks.append(Check(name, vintage, expected, actual, "ROUNDING",
                               f"prior-year actual rounding (±{_rounding_bound(addends):.1f})"))
            return
        disp = _disposition_for(page, name, vintage, expected, actual)
        if disp:
            checks.append(Check(name, vintage, expected, actual, "SOURCE_INCONSISTENCY", disp["note"]))
        else:
            checks.append(Check(name, vintage, expected, actual, "FAIL", disposition))

    exp_rows = dept.rows_in("expenditure")
    rev_rows = dept.rows_in("revenue")
    total_exp = next(iter(dept.rows_in("total_exp")), None)
    total_rev = next(iter(dept.rows_in("total_rev")), None)
    tax_levy = next(iter(dept.rows_in("tax_levy")), None)

    def variance_checks():
        # The printed Variance column = 2026 adopted − 2025 budget, per row.
        for r in dept.rows:
            if r.section == "personnel":
                continue
            a, b = r.values[_ADOPTED_COL], r.values[_BUDGET_COL]
            if r.variance is None or a is None or b is None:
                continue
            cmp(f"variance[{r.name}] == 2026 adopted − 2025 budget", "variance",
                r.variance, round(a - b, 2))

    # Non-departmental revenue ledger (Non-Departmental Revenues, Property Taxes):
    # the only printed identity is that the revenue items sum to Total Revenues.
    if dept.chapter_kind == "revenue_ledger":
        for i, label in VINTAGE_LABEL.items():
            rsum, rn = _sum_col(rev_rows, i)
            cmp("revenue items == Total Revenues", label,
                _col(total_rev, i), rsum if rn else None, addends=rn)
        variance_checks()
        return checks

    # Non-departmental program list (Cultural Contributions, Non-Departmental
    # Expenditures): no chapter total, but each program area's own
    # Expenditures − Revenues == Tax Levy identity is checkable.
    if dept.chapter_kind == "nondept_programs":
        for prog in dept.programs:
            _reconcile_program_taxlevy(prog, cmp)
        if not checks:
            checks.append(Check("has reconcilable total", "-", None, None,
                                "NOT_RECONCILABLE", "program list with no chapter total"))
        return checks

    if total_exp is None or tax_levy is None:
        # Non-standard chapter with nothing to reconcile against — labeled, never
        # silently trusted.
        checks.append(Check("has BUDGET SUMMARY table", "-", None, None,
                            "NOT_RECONCILABLE", "no standard summary table on this chapter"))
        return checks

    for i, label in VINTAGE_LABEL.items():
        # 1. expenditure components sum to Total Expenditures
        esum, en = _sum_col(exp_rows, i)
        cmp("expenditure components == Total Expenditures", label,
            _col(total_exp, i), esum if en else None, addends=en)

        # 2. revenue components sum to Total Revenues (revenue departments only)
        if rev_rows:
            rsum, rn = _sum_col(rev_rows, i)
            cmp("revenue components == Total Revenues", label,
                _col(total_rev, i), rsum if rn else None, addends=rn)

        # 3. Total Expenditures − Total Revenues == Tax Levy
        te = _col(total_exp, i)
        tr = _col(total_rev, i) or 0.0
        cmp("Total Expenditures − Total Revenues == Tax Levy", label,
            _col(tax_levy, i), None if te is None else round(te - tr, 2), addends=2)

    # 4. Variance column == (2026 adopted − 2025 budget), per summary row
    variance_checks()

    # 5. Program-area Expenditures roll up to the department Total Expenditures
    if dept.programs:
        for i, label in VINTAGE_LABEL.items():
            prog_exp = [pr for prog in dept.programs for pr in prog.rows
                        if pr.section == "expenditure"]
            psum, pn = _sum_col(prog_exp, i)
            cmp("program Expenditures == department Total Expenditures", label,
                _col(total_exp, i), psum if pn else None, addends=pn)

    return checks


def is_money_check(name: str) -> bool:
    """Dollar-critical checks (as opposed to headcount/variance structural ones)."""
    return (
        "Total Expenditures" in name
        or "Total Revenues" in name
        or "Tax Levy" in name
    )


def summarize(checks: list[Check]) -> dict:
    passed = sum(1 for c in checks if c.status == "PASS")
    failed = [c for c in checks if c.status == "FAIL"]
    rounding = [c for c in checks if c.status == "ROUNDING"]
    nr = [c for c in checks if c.status == "NOT_RECONCILABLE"]
    source_inc = [c for c in checks if c.status == "SOURCE_INCONSISTENCY"]
    money_fail = [c for c in failed if is_money_check(c.name)]
    return {
        "passed": passed, "failed": failed, "rounding": rounding,
        "not_reconcilable": nr, "source_inconsistency": source_inc,
        "money_fail": money_fail, "total": len(checks),
    }
