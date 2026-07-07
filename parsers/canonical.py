"""Canonical schema contract for MKE Budget Commons.

Both the city (ledger) and county (narrative-table) parsers normalize INTO
this shape. Shared normalization, never shared parsing code.

A BudgetLine is the atomic fact. Every one carries provenance (source_doc,
source_page) — a line without a source_page must never be emitted.
"""
from __future__ import annotations
from dataclasses import dataclass, field, asdict
from typing import Optional
import pandas as pd

# amount_kind values — one document can emit several (the adopted city book
# carries actual + budget + adopted vintages side by side)
ACTUAL = "actual"
BUDGET = "budget"
REQUESTED = "requested"
PROPOSED = "proposed"
ADOPTED = "adopted"
RECOMMENDED = "recommended"

# line_kind values
POSITION = "position"        # a staff line with a pay range (city)
EXPENDITURE = "expenditure"  # a coded operating line (city ledger, MPS xlsx)
REVENUE = "revenue"          # a revenue line by source (MPS)
CATEGORY = "category"        # a summary category (county Budget Summary row)
PROGRAM = "program"          # a program-area summary (county)
SUBTOTAL = "subtotal"
TOTAL = "total"
FTE = "fte"                  # position-count / FTE lines


@dataclass
class BudgetLine:
    # provenance — REQUIRED
    doc_id: str                       # e.g. 'city-2026-adopted-detailed'
    source_page: int                  # 1-based page in the source PDF

    # identity
    gov_id: str                       # 'city' | 'county'
    fiscal_year: int
    doc_type: str                     # adopted|proposed|requested|recommended
    department_printed: str           # dept name exactly as printed this year
    line_description: str
    line_kind: str

    # value
    amount: Optional[float] = None
    amount_kind: str = ADOPTED        # which vintage this amount is
    units: Optional[float] = None     # FTE / position count where present

    # structure (nullable)
    division: Optional[str] = None
    fund: Optional[str] = None
    org: Optional[str] = None
    sbcl: Optional[str] = None
    account: Optional[str] = None     # city reserved-code anchors live here
    pay_range: Optional[str] = None
    flags: list[str] = field(default_factory=list)  # raw footnote codes

    def __post_init__(self):
        if self.source_page is None:
            raise ValueError(f"BudgetLine without source_page is forbidden: {self.line_description!r}")


def lines_to_frame(lines: list[BudgetLine]) -> pd.DataFrame:
    """Normalize a list of BudgetLine into the canonical DataFrame."""
    rows = [asdict(l) for l in lines]
    df = pd.DataFrame(rows)
    # flags -> pipe-joined string for CSV friendliness; Parquet keeps the list
    return df


CANONICAL_COLUMNS = [
    "doc_id", "gov_id", "fiscal_year", "doc_type",
    "department_printed", "division", "fund", "org", "sbcl", "account",
    "line_description", "line_kind", "pay_range",
    "amount", "amount_kind", "units", "flags",
    "source_page",
]
