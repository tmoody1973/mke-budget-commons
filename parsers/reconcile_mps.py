"""Reconciliation for the MPS line-item budget — the trust layer.

The `.xlsx` carries its own printed grand-total rows (null-account memo rows at
the bottom of each sheet). We sum the individually-extracted line items and check
them against those printed totals, exactly. A mismatch is a *finding*, reported
with the delta — never a swallowed exception.

Identities (per vintage — FY2026 budget, FY2027 proposed):
  1. sum(expenditure line items) == printed net grand total.
  2. sum(expenditure FTE) == the net grand-total row's FTE.
  3. printed gross − eliminations == printed net (internal consistency).
  4. sum(revenue line items) == printed revenue grand total.
  5. printed revenue total − expenditure total == the surplus / fund-balance
     reconciling item (informational, surfaced, not a failure).

No LLM. Pure arithmetic over the extracted rows and printed totals.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from parsers.canonical import BUDGET, PROPOSED
from parsers.mps_lineitem import MpsBook

EPS_DOLLARS = 0.005    # expenditures are whole dollars
EPS_CENTS = 0.01       # revenue is to the cent
EPS_FTE = 0.05         # FTE totals carry float noise (~1e-9)

VINTAGE_LABEL = {2026: "FY2026 budget", 2027: "FY2027 proposed"}


@dataclass
class Check:
    name: str
    vintage: str
    expected: Optional[float]
    actual: Optional[float]
    status: str                        # PASS | FAIL | NOT_RECONCILABLE | INFO
    disposition: str = ""

    @property
    def delta(self) -> Optional[float]:
        if self.expected is None or self.actual is None:
            return None
        return round(self.actual - self.expected, 2)


def _sum(lines, fy: int, attr: str = "amount") -> float:
    return round(sum(getattr(l, attr) or 0 for l in lines if l.fiscal_year == fy), 2)


def reconcile_book(book: MpsBook) -> list[Check]:
    checks: list[Check] = []

    def cmp(name, vintage, expected, actual, eps, *, money=True, disposition=""):
        if expected is None or actual is None:
            checks.append(Check(name, vintage, expected, actual, "NOT_RECONCILABLE", disposition))
            return
        status = "PASS" if abs(actual - expected) <= eps else "FAIL"
        checks.append(Check(name, vintage, expected, actual, status, disposition))

    for fy, label in VINTAGE_LABEL.items():
        totals = book.exp_totals.get(fy)
        # 1. expenditure line items == printed net grand total
        cmp("expenditure line items == printed grand total", label,
            totals.net if totals else None, _sum(book.exp_lines, fy), EPS_DOLLARS)
        # 2. expenditure FTE == printed grand-total FTE
        cmp("expenditure FTE == printed grand-total FTE", label,
            totals.net_fte if totals else None, _sum(book.exp_lines, fy, "units"), EPS_FTE)
        # 3. printed gross − eliminations == printed net
        if totals and totals.gross is not None and totals.eliminations is not None:
            cmp("printed gross − eliminations == net", label,
                totals.net, round(totals.gross - totals.eliminations, 2), EPS_DOLLARS)
        # 4. revenue line items == printed revenue total
        cmp("revenue line items == printed revenue total", label,
            book.rev_totals.get(fy), _sum(book.rev_lines, fy), EPS_CENTS)
        # 5. revenue − expenditure == surplus / fund-balance (informational)
        rev_t, exp_t = book.rev_totals.get(fy), (totals.net if totals else None)
        if rev_t is not None and exp_t is not None:
            checks.append(Check(
                "revenue − expenditure (surplus / fund-balance use)", label,
                None, round(rev_t - exp_t, 2), "INFO",
                "planned revenue-over-expenditure; not a reconciliation failure"))

    # Excluded phrase-labeled rows outside the printed total — surfaced, never dropped.
    for e in book.excluded:
        checks.append(Check(
            f"excluded (outside printed total): {e.label}", "-",
            None, e.fy26 if e.fy27 in (None, 0) else e.fy27, "NOT_RECONCILABLE",
            "phrase-labeled row (e.g. Recreation Extension Fund) outside the printed grand total"))

    return checks


def is_money_check(name: str) -> bool:
    return "line items ==" in name or "gross − eliminations" in name


def summarize(checks: list[Check]) -> dict:
    passed = sum(1 for c in checks if c.status == "PASS")
    failed = [c for c in checks if c.status == "FAIL"]
    nr = [c for c in checks if c.status == "NOT_RECONCILABLE"]
    info = [c for c in checks if c.status == "INFO"]
    money_fail = [c for c in failed if is_money_check(c.name)]
    return {
        "passed": passed, "failed": failed, "not_reconcilable": nr,
        "info": info, "money_fail": money_fail, "total": len(checks),
    }
