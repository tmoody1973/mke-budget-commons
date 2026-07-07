"""Milwaukee County Adopted Operating Budget parser (L1).

A different species from the city Detailed Budget: narrative department chapters,
each carrying summary *tables* (table detection, NOT column-band parsing). One
chapter per department, keyed off the clean ``Agency No. NNN`` running header.

Deterministic only. NO LLM ever reads a number. Every emitted BudgetLine carries
``source_page``. Reconciliation identities live in ``reconcile_county.py``.

Verified against ``data/raw/county/2026-Adopted-Operating-Budget-.pdf``:
- ``pdfplumber`` ``extract_tables()`` reads the summary tables cleanly.
- The **BUDGET SUMMARY** table (once per department) has columns
  ``Category | 2023 Actual | 2024 Actual | 2025 Budget | 2026 Adopted | Variance``
  and rows grouped under ``Expenditures`` / ``Revenues`` / ``Personnel`` markers.
- Never anchor on section *titles* (their text layer is scrambled) — anchor on
  the ``Agency No.`` header and on the clean category row names.
"""
from __future__ import annotations

import argparse
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import pdfplumber

from parsers.canonical import (
    ACTUAL, ADOPTED, BUDGET, CATEGORY, FTE, PROGRAM,
    BudgetLine, lines_to_frame,
)

DEFAULT_PDF = "data/raw/county/2026-Adopted-Operating-Budget-.pdf"
DOC_ID = "county-2026-adopted-operating"
GOV = "county"
DOC_TYPE = "adopted"
FISCAL_YEAR = 2026

BOOK_START = 78          # first department chapter (County Board, Agency 100)
BOOK_END = 442           # last page

# The four value columns, left→right, mapped to (fiscal_year, amount_kind).
# The document also prints a fifth Variance column (2026 adopted − 2025 budget),
# which is a free reconciliation check, not a stored vintage.
VINTAGES: list[tuple[int, str]] = [
    (2023, ACTUAL),
    (2024, ACTUAL),
    (2025, BUDGET),
    (2026, ADOPTED),
]

_AGENCY_RE = re.compile(r"Agency No\.?\s*(\d{3})")
_PROGRAM_AREA_RE = re.compile(r"Strategic Program Area:\s*(.+)")

# Section-marker row names (value cells are all blank on these rows).
_EXP_MARKER = "expenditures"
_REV_MARKER = "revenues"
_PERSONNEL_MARKER = "personnel"

# Rows that close a group.
_TOTAL_EXP = "total expenditures"
_TOTAL_REV = "total revenues"
_TAX_LEVY = "tax levy"


def _num(cell: Optional[str]) -> Optional[float]:
    """Parse a printed money/FTE cell deterministically. None if blank.

    Handles ``$`` prefixes, thousands commas, and parenthesised negatives
    (e.g. ``($1,234,262)`` → -1234262.0). Never guesses — a cell that is not a
    clean number returns None.
    """
    if cell is None:
        return None
    s = cell.strip().replace("\n", " ")
    if s in ("", "-", "—"):
        return None
    neg = s.startswith("(") and s.endswith(")")
    s = s.strip("()").replace("$", "").replace(",", "").strip()
    if s == "":
        return None
    try:
        val = float(s)
    except ValueError:
        return None
    return -val if neg else val


@dataclass
class Row:
    """One category row of a summary table, normalized."""
    name: str
    section: str                       # expenditure|revenue|total_exp|total_rev|tax_levy|personnel
    values: list[Optional[float]]      # len 4, aligned to VINTAGES
    variance: Optional[float] = None


@dataclass
class ProgramSummary:
    """A Strategic Program Area's condensed Program Budget Summary rollup."""
    name: str
    page: int
    rows: list[Row] = field(default_factory=list)


@dataclass
class CountyDept:
    """One reconciliation unit = one department chapter."""
    agency_no: str
    department_printed: str
    page_start: int
    page_end: int
    summary_page: Optional[int]
    rows: list[Row] = field(default_factory=list)          # BUDGET SUMMARY rows
    programs: list[ProgramSummary] = field(default_factory=list)
    lines: list[BudgetLine] = field(default_factory=list)
    # standard        = the usual departmental BUDGET SUMMARY table
    # revenue_ledger  = a non-departmental revenue ledger (items → Total Revenues)
    # nondept_programs = a non-departmental chapter that is only a list of
    #                    Strategic-Program-Area rollups, with no chapter total
    chapter_kind: str = "standard"

    @property
    def label(self) -> str:
        return f"{self.department_printed} ({self.agency_no})"

    def row(self, name: str) -> Optional[Row]:
        key = name.strip().lower()
        return next((r for r in self.rows if r.name.strip().lower() == key), None)

    def rows_in(self, section: str) -> list[Row]:
        return [r for r in self.rows if r.section == section]


def _classify(name: str, values: list[Optional[float]], section_state: str) -> Optional[str]:
    """Assign a row to a reconciliation section. Returns the row's section, or
    None if the row is a marker / not a data row."""
    low = name.strip().lower()
    has_values = any(v is not None for v in values)
    if low == _TOTAL_EXP:
        return "total_exp"
    if low == _TOTAL_REV:
        return "total_rev"
    if low == _TAX_LEVY:
        return "tax_levy"
    if low in (_EXP_MARKER, _REV_MARKER, _PERSONNEL_MARKER):
        return None  # section marker, no data
    if not has_values:
        return None
    return section_state


def _is_budget_summary(table: list[list]) -> bool:
    """The BUDGET SUMMARY table is the one carrying both a 'Total Expenditures'
    row and a 'Tax Levy' row. Program tables have neither."""
    names = {(r[0] or "").strip().lower() for r in table if r and r[0]}
    return _TOTAL_EXP in names and _TAX_LEVY in names


def _is_program_summary(table: list[list]) -> bool:
    """The Program Budget Summary is the condensed rollup: an 'Expenditures'
    row that carries values (not a blank marker) and a 'Tax Levy' row, without
    the 'Total Expenditures' breakdown."""
    names = {(r[0] or "").strip().lower() for r in table if r and r[0]}
    if _TOTAL_EXP in names:
        return False
    if _TAX_LEVY not in names and _EXP_MARKER not in names:
        return False
    # an 'Expenditures' row must carry actual values
    for r in table:
        if r and (r[0] or "").strip().lower() == _EXP_MARKER:
            return any(_num(c) is not None for c in r[1:])
    return False


_TOTAL_REV_NAMES = (_TOTAL_REV, "total revenue")  # county prints both plural & singular


def _is_revenue_ledger(table: list[list]) -> bool:
    """A standalone revenue ledger (the non-departmental revenue chapters):
    a 'Revenues' marker + item rows + a 'Total Revenue(s)' row, with NO
    expenditure side. Distinct from a department summary (which prints revenues
    inside a table that also carries Total Expenditures)."""
    names = {(r[0] or "").strip().lower() for r in table if r and r[0]}
    has_total_rev = any(n in names for n in _TOTAL_REV_NAMES)
    return (has_total_rev and _REV_MARKER in names
            and _TOTAL_EXP not in names and "personnel costs" not in names)


def _parse_revenue_ledger(table: list[list]) -> list[Row]:
    """Revenue items → section='revenue'; the printed total → section='total_rev'."""
    rows: list[Row] = []
    in_revenues = False
    for raw in table[1:]:  # skip header
        if not raw or not raw[0]:
            continue
        name = re.sub(r"\s+", " ", raw[0]).strip()   # collapse wrapped item names
        low = name.lower()
        if low == _REV_MARKER:
            in_revenues = True
            continue
        values = [_num(c) for c in raw[1:5]]
        variance = _num(raw[5]) if len(raw) > 5 else None
        if low in _TOTAL_REV_NAMES:
            rows.append(Row(name=name, section="total_rev", values=values, variance=variance))
            continue
        if in_revenues and any(v is not None for v in values):
            rows.append(Row(name=name, section="revenue", values=values, variance=variance))
    return rows


def _parse_summary_rows(table: list[list]) -> list[Row]:
    """Turn a BUDGET SUMMARY table (with header row) into normalized Rows."""
    rows: list[Row] = []
    section_state = "expenditure"
    for raw in table[1:]:  # skip header
        if not raw or not raw[0]:
            continue
        name = raw[0].strip()
        low = name.lower()
        if low == _EXP_MARKER:
            section_state = "expenditure"
            continue
        if low == _REV_MARKER:
            section_state = "revenue"
            continue
        if low == _PERSONNEL_MARKER:
            section_state = "personnel"
            continue
        values = [_num(c) for c in raw[1:5]]
        variance = _num(raw[5]) if len(raw) > 5 else None
        section = _classify(name, values, section_state)
        if section is None:
            continue
        rows.append(Row(name=name, section=section, values=values, variance=variance))
    return rows


def _parse_program_rows(table: list[list]) -> list[Row]:
    """Program tables are a flat rollup: Expenditures / (Revenues) / Tax Levy / FTE."""
    rows: list[Row] = []
    for raw in table[1:]:
        if not raw or not raw[0]:
            continue
        name = raw[0].strip()
        values = [_num(c) for c in raw[1:5]]
        if not any(v is not None for v in values):
            continue
        variance = _num(raw[5]) if len(raw) > 5 else None
        low = name.lower()
        section = ("fte" if "fte" in low or "pos" in low
                   else "tax_levy" if low == _TAX_LEVY
                   else "revenue" if low == _TOTAL_REV or low == _REV_MARKER
                   else "expenditure")
        rows.append(Row(name=name, section=section, values=values, variance=variance))
    return rows


def _emit_lines(dept: CountyDept) -> list[BudgetLine]:
    """Canonical BudgetLine rows: one per (row × populated vintage)."""
    out: list[BudgetLine] = []

    def emit(row: Row, page: int, line_kind: str, division: Optional[str]):
        is_fte = row.section == "personnel" and (
            "fte" in row.name.lower() or "pos" in row.name.lower()
        )
        for (fy, kind), val in zip(VINTAGES, row.values):
            if val is None:
                continue
            out.append(BudgetLine(
                doc_id=DOC_ID, source_page=page, gov_id=GOV,
                fiscal_year=fy, doc_type=DOC_TYPE,
                department_printed=dept.department_printed,
                line_description=row.name, line_kind=line_kind,
                amount=None if is_fte else val,
                amount_kind=kind,
                units=val if is_fte else None,
                division=division,
            ))

    page = dept.summary_page or dept.page_start
    for r in dept.rows:
        kind = FTE if r.section == "personnel" else CATEGORY
        emit(r, page, kind, division=None)
    for prog in dept.programs:
        for r in prog.rows:
            kind = FTE if r.section == "fte" else PROGRAM
            emit(r, prog.page, kind, division=prog.name)
    return out


def parse_department(pages: list, page_start: int, agency_no: str,
                     department_printed: str) -> CountyDept:
    """Parse one department chapter into a CountyDept reconciliation unit."""
    page_end = page_start + len(pages) - 1
    dept = CountyDept(
        agency_no=agency_no, department_printed=department_printed,
        page_start=page_start, page_end=page_end, summary_page=None,
    )

    pending_program: Optional[str] = None
    for offset, pg in enumerate(pages):
        pageno = page_start + offset
        text = pg.extract_text() or ""
        for line in text.splitlines():
            pm = _PROGRAM_AREA_RE.search(line)
            if pm:
                pending_program = pm.group(1).strip()
                break

        for table in pg.extract_tables():
            if not table or not table[0]:
                continue
            if dept.summary_page is None and _is_budget_summary(table):
                dept.rows = _parse_summary_rows(table)
                dept.summary_page = pageno
            elif pending_program and _is_program_summary(table):
                # A Program Budget Summary always follows a Strategic Program Area
                # heading. Requiring the heading avoids mis-capturing the stray
                # summary/crosswalk tables in the non-departmental chapters as
                # phantom programs.
                dept.programs.append(
                    ProgramSummary(name=pending_program, page=pageno,
                                   rows=_parse_program_rows(table))
                )
                pending_program = None
            elif dept.summary_page is None and _is_revenue_ledger(table):
                # Non-departmental revenue chapters (Non-Departmental Revenues,
                # Property Taxes): a standalone revenue ledger, no expenditure side.
                dept.rows = _parse_revenue_ledger(table)
                dept.summary_page = pageno
                dept.chapter_kind = "revenue_ledger"

    # A non-departmental chapter that is only a list of program-area rollups (no
    # BUDGET SUMMARY, no revenue ledger) has no chapter total to reconcile against;
    # its programs are still captured as facts.
    if dept.summary_page is None and dept.programs:
        dept.chapter_kind = "nondept_programs"

    dept.lines = _emit_lines(dept)
    return dept


def parse_book(pdf_path: str = DEFAULT_PDF, start_page: int = BOOK_START,
               end_page: int = BOOK_END) -> list[CountyDept]:
    """Segment the operating book into department chapters and parse each."""
    depts: list[CountyDept] = []
    with pdfplumber.open(pdf_path) as pdf:
        # First pass: find each chapter's first page (agency-number transitions).
        starts: list[tuple[int, str, str]] = []
        prev = None
        for i in range(start_page - 1, min(end_page, len(pdf.pages))):
            text = pdf.pages[i].extract_text() or ""
            hdr = next((l for l in text.splitlines() if "Agency No" in l), None)
            if not hdr:
                continue
            m = _AGENCY_RE.search(hdr)
            if not m:
                continue
            ag = m.group(1)
            if ag != prev:
                name = hdr.split("(")[0].strip()
                starts.append((i + 1, ag, name))
                prev = ag

        # Second pass: slice pages per chapter and parse.
        for idx, (pstart, ag, name) in enumerate(starts):
            pend = starts[idx + 1][0] - 1 if idx + 1 < len(starts) else end_page
            pages = pdf.pages[pstart - 1:pend]
            depts.append(parse_department(pages, pstart, ag, name))
    return depts


def main():
    ap = argparse.ArgumentParser(description="Parse the county operating budget PDF.")
    ap.add_argument("--pdf", default=DEFAULT_PDF)
    ap.add_argument("--start", type=int, default=BOOK_START)
    ap.add_argument("--end", type=int, default=BOOK_END)
    ap.add_argument("--out", default="data/canonical/county/2026/adopted/county-operating-book.parquet")
    args = ap.parse_args()

    depts = parse_book(args.pdf, args.start, args.end)
    lines = [ln for d in depts for ln in d.lines]
    df = lines_to_frame(lines)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out, index=False)
    df.assign(flags=df["flags"].apply(lambda f: "|".join(f) if isinstance(f, list) else "")) \
      .to_csv(out.with_suffix(".csv"), index=False)
    print(f"Parsed {len(depts)} departments, {len(lines)} lines → {out}")


if __name__ == "__main__":
    main()
