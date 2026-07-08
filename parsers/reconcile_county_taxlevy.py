"""Reconciliation for the county countywide tax-levy crosswalk — the whole-budget
document-level trust check.

Four levels, all against printed figures in the same book:
  1. Each group subtotal == the sum of its member department rows.
  2. The grand total (sum of group tax levies) == the printed Property Tax Levy.
  3. Per department, the crosswalk's Tax Levy (all funds) == that department's own
     BUDGET SUMMARY chapter Tax Levy (an independent restatement agreeing).
  4. Per department, the crosswalk's operating Expenditures/Revenue (excluding the
     Trust funds the chapters omit) == the chapter's Total Expenditures/Revenues.

A mismatch is a finding, reported with the delta. No LLM; pure arithmetic.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from parsers.county_operating import parse_book
from parsers.county_taxlevy import TRUST_FUND, Crosswalk, parse_crosswalk

EPS = 0.5
_ADOPTED = 3   # 2026 adopted column index in the chapter Row.values


@dataclass
class Check:
    name: str
    expected: Optional[float]
    actual: Optional[float]
    status: str                        # PASS | FAIL | NOT_RECONCILABLE
    disposition: str = ""

    @property
    def delta(self) -> Optional[float]:
        if self.expected is None or self.actual is None:
            return None
        return round(self.actual - self.expected, 2)


def _chapter_totals(pdf_path: Optional[str] = None) -> dict[str, dict]:
    """agency_no → adopted Total Expenditures / Total Revenues / Tax Levy."""
    depts = parse_book() if pdf_path is None else parse_book(pdf_path)
    out: dict[str, dict] = {}
    for d in depts:
        te = next((r for r in d.rows if r.section == "total_exp"), None)
        tr = next((r for r in d.rows if r.section == "total_rev"), None)
        tx = next((r for r in d.rows if r.section == "tax_levy"), None)
        out[d.agency_no] = {
            "exp": te.values[_ADOPTED] if te else None,
            "rev": tr.values[_ADOPTED] if tr else None,
            "tl": tx.values[_ADOPTED] if tx else None,
        }
    return out


def _sum(rows, attr: str, exclude_trusts: bool = False) -> float:
    total = 0.0
    for r in rows:
        if exclude_trusts and r.fund_type == TRUST_FUND:
            continue
        v = getattr(r, attr)
        if v is not None:
            total += v
    return round(total, 2)


def reconcile_taxlevy(xw: Optional[Crosswalk] = None) -> list[Check]:
    xw = xw or parse_crosswalk()
    chapters = _chapter_totals()
    checks: list[Check] = []

    def cmp(name, expected, actual, *, disposition=""):
        if expected is None or actual is None:
            checks.append(Check(name, expected, actual, "NOT_RECONCILABLE", disposition))
        elif abs(actual - expected) <= EPS:
            checks.append(Check(name, expected, actual, "PASS", disposition))
        else:
            checks.append(Check(name, expected, actual, "FAIL", disposition))

    # 1. group subtotal == sum of its member rows (tax levy is the bottom line)
    rows_by_group: dict[str, list] = {}
    for r in xw.rows:
        rows_by_group.setdefault(r.group, []).append(r)
    for sub in xw.subtotals:
        members = rows_by_group.get(sub.group, [])
        cmp(f"group '{sub.group}' subtotal == sum of members (tax levy)",
            sub.tax_levy, _sum(members, "tax_levy"))

    # 2. grand total (sum of group tax levies) == printed Property Tax Levy
    cmp("sum of group tax levies == Property Tax Levy",
        xw.property_tax_levy, round(sum(s.tax_levy or 0 for s in xw.subtotals), 2))

    # 3 & 4. per-department cross-document checks (3-digit agencies with a chapter)
    for agency, rows in xw.agencies().items():
        if len(agency) != 3:
            continue                                   # non-dept line codes feed the groups
        ch = chapters.get(agency)
        if not ch or ch["tl"] is None:
            checks.append(Check(f"agency {agency}: crosswalk vs chapter", None, None,
                                "NOT_RECONCILABLE", "no standard operating chapter (capital / property-tax)"))
            continue
        cmp(f"agency {agency}: crosswalk Tax Levy == chapter Tax Levy",
            ch["tl"], _sum(rows, "tax_levy"))
        cmp(f"agency {agency}: crosswalk operating Expenditures == chapter Total Expenditures",
            ch["exp"], _sum(rows, "expenditures", exclude_trusts=True))
        if ch["rev"] is not None:
            cmp(f"agency {agency}: crosswalk operating Revenue == chapter Total Revenues",
                ch["rev"], _sum(rows, "revenue", exclude_trusts=True))

    return checks


def summarize(checks: list[Check]) -> dict:
    return {
        "passed": [c for c in checks if c.status == "PASS"],
        "failed": [c for c in checks if c.status == "FAIL"],
        "not_reconcilable": [c for c in checks if c.status == "NOT_RECONCILABLE"],
        "total": len(checks),
    }
