"""Milwaukee County countywide tax-levy crosswalk parser (L1).

The Property Taxes chapter (Agency 199, pp.414-417) prints a **countywide
crosswalk**: every department's Expenditures / Revenue / Tax Levy by fund type,
grouped by function, with group subtotals — plus the printed Property Tax Levy.

This is an *independent restatement* of every department's bottom line, so it
cross-checks the per-department BUDGET SUMMARY chapters we already parse, and its
grand total ties to the printed Property Tax Levy. Deterministic pdfplumber table
extraction; NO LLM.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

import pdfplumber

DEFAULT_PDF = "data/raw/county/2026-Adopted-Operating-Budget-.pdf"
DOC_ID = "county-2026-adopted-operating"
CROSSWALK_PAGES = range(414, 418)   # pp.414-417
TRUST_FUND = "Trusts"               # fund type the operating chapters exclude


def _num(cell) -> Optional[float]:
    """Parse a crosswalk cell; parenthesised negatives, commas. None if blank."""
    if cell in (None, "None", ""):
        return None
    s = str(cell).replace(",", "").replace("\n", " ").strip()
    neg = s.startswith("(") and s.endswith(")")
    s = s.strip("()").strip()
    if s in ("", "-"):
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    return -v if neg else v


@dataclass
class DeptRow:
    agency: str                 # 3-digit chapter agency, or 4-digit non-dept line code
    fund_type: str
    name: str
    expenditures: Optional[float]
    revenue: Optional[float]
    tax_levy: Optional[float]
    group: str
    source_page: int


@dataclass
class GroupSubtotal:
    group: str
    expenditures: Optional[float]
    revenue: Optional[float]
    tax_levy: Optional[float]
    source_page: int


@dataclass
class Crosswalk:
    rows: list[DeptRow] = field(default_factory=list)
    subtotals: list[GroupSubtotal] = field(default_factory=list)
    property_tax_levy: Optional[float] = None    # printed anchor (table 0)

    def agencies(self) -> dict[str, list[DeptRow]]:
        out: dict[str, list[DeptRow]] = {}
        for r in self.rows:
            out.setdefault(r.agency, []).append(r)
        return out


def _is_crosswalk_table(table: list[list]) -> bool:
    return bool(table and table[0] and "Agency" in " ".join(str(c) for c in table[0]))


def parse_crosswalk(pdf_path: str = DEFAULT_PDF) -> Crosswalk:
    xw = Crosswalk()
    with pdfplumber.open(pdf_path) as pdf:
        # Property Tax Levy anchor: table 0 on p.414 ("Property Tax Levy" row,
        # 2026 adopted column).
        for tb in pdf.pages[413].extract_tables():
            for r in tb:
                if r and str(r[0]).strip().lower() in ("property tax levy", "total revenue"):
                    xw.property_tax_levy = _num(r[4])
                    break
            if xw.property_tax_levy is not None:
                break

        group = ""
        for pageno in CROSSWALK_PAGES:
            for table in pdf.pages[pageno - 1].extract_tables():
                if not _is_crosswalk_table(table):
                    continue
                for r in table[1:]:
                    code = str(r[0]).strip()
                    name = str(r[2]).strip() if r[2] not in (None, "None") else ""
                    if re.match(r"^\d+$", code):                     # department / line row
                        xw.rows.append(DeptRow(
                            agency=code, fund_type=str(r[1]).replace("\n", " ").strip(),
                            name=name, expenditures=_num(r[3]), revenue=_num(r[4]),
                            tax_levy=_num(r[5]), group=group, source_page=pageno))
                    elif name.startswith("Total "):                  # group subtotal
                        xw.subtotals.append(GroupSubtotal(
                            group=name[len("Total "):], expenditures=_num(r[3]),
                            revenue=_num(r[4]), tax_levy=_num(r[5]), source_page=pageno))
                    elif code and str(r[1]) in ("None", "") and not name.startswith("Total"):
                        group = code                                 # group header
    return xw
