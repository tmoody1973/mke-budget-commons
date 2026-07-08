"""MPS per-school budget + enrollment parser (L1).

The `School Budgets – Line Item Detail` PDF prints one clean row per school:
name, enrollment (2 vintages), budget amount (2 vintages), and FTE (2 vintages).
This is what unlocks **per-pupil** analysis. Deterministic pdfplumber table
extraction; NO LLM. Every row cites its page.

The amounts here reconcile school-by-school against the district `.xlsx`
line-item detail (verified: Alcott, Allen-Field agree to the dollar and FTE) —
a cross-document trust check handled in ``reconcile_mps_schools.py``.
"""
from __future__ import annotations

import argparse
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import pdfplumber

from parsers.canonical import ADOPTED, PROPOSED, BudgetLine, lines_to_frame

DEFAULT_PDF = "data/raw/mps/mps-2027-proposed-school-line-item.pdf"
DOC_ID = "mps-2027-proposed-school-lineitem"
GOV = "mps"
DOC_TYPE = "proposed"

# The seven printed columns, in order.
_HEADER_KEY = "school name"


def _num(cell) -> Optional[float]:
    if cell is None:
        return None
    s = str(cell).replace("$", "").replace(",", "").replace("\n", " ").strip()
    if s in ("", "-"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _clean_name(v) -> str:
    return re.sub(r"\s+", " ", str(v)).strip()


@dataclass
class SchoolRow:
    name: str
    source_page: int
    enr_actual_2026: Optional[float] = None      # 2025-26 actual enrollment
    enr_proj_2027: Optional[float] = None        # 2026-27 projected enrollment
    amt_adopted_2026: Optional[float] = None
    fte_adopted_2026: Optional[float] = None
    amt_proposed_2027: Optional[float] = None
    fte_proposed_2027: Optional[float] = None

    @property
    def per_pupil_2027(self) -> Optional[float]:
        if self.amt_proposed_2027 and self.enr_proj_2027:
            return round(self.amt_proposed_2027 / self.enr_proj_2027, 2)
        return None

    @property
    def per_pupil_2026(self) -> Optional[float]:
        if self.amt_adopted_2026 and self.enr_actual_2026:
            return round(self.amt_adopted_2026 / self.enr_actual_2026, 2)
        return None


@dataclass
class SchoolBook:
    schools: list[SchoolRow] = field(default_factory=list)
    lines: list[BudgetLine] = field(default_factory=list)


def _is_data_row(r: list) -> bool:
    """A school row has a name in col 0 and a numeric budget amount in col 3."""
    return bool(r and r[0] and not re.search(r"school name|total|grand", str(r[0]), re.I)
                and _num(r[3]) is not None)


def _emit_lines(school: SchoolRow) -> list[BudgetLine]:
    """One budget line per (school × vintage), carrying enrollment as a flag-free
    companion via units=FTE and the enrollment stored on separate rows."""
    out: list[BudgetLine] = []
    common = dict(doc_id=DOC_ID, source_page=school.source_page, gov_id=GOV,
                  doc_type=DOC_TYPE, department_printed=school.name, division=None)
    if school.amt_adopted_2026 is not None:
        out.append(BudgetLine(**common, fiscal_year=2026, amount_kind=ADOPTED,
                              amount=school.amt_adopted_2026, units=school.fte_adopted_2026,
                              line_description="School Budget", line_kind="school_summary"))
    if school.amt_proposed_2027 is not None:
        out.append(BudgetLine(**common, fiscal_year=2027, amount_kind=PROPOSED,
                              amount=school.amt_proposed_2027, units=school.fte_proposed_2027,
                              line_description="School Budget", line_kind="school_summary"))
    # enrollment as its own metric row (amount NULL, units = pupil count)
    if school.enr_actual_2026 is not None:
        out.append(BudgetLine(**common, fiscal_year=2026, amount_kind=ADOPTED,
                              amount=None, units=school.enr_actual_2026,
                              line_description="Enrollment", line_kind="enrollment"))
    if school.enr_proj_2027 is not None:
        out.append(BudgetLine(**common, fiscal_year=2027, amount_kind=PROPOSED,
                              amount=None, units=school.enr_proj_2027,
                              line_description="Enrollment", line_kind="enrollment"))
    return out


def parse_school_book(pdf_path: str = DEFAULT_PDF) -> SchoolBook:
    book = SchoolBook()
    with pdfplumber.open(pdf_path) as pdf:
        for pi, pg in enumerate(pdf.pages):
            for table in pg.extract_tables():
                for r in table:
                    if not _is_data_row(r):
                        continue
                    school = SchoolRow(
                        name=_clean_name(r[0]), source_page=pi + 1,
                        enr_actual_2026=_num(r[1]), enr_proj_2027=_num(r[2]),
                        amt_adopted_2026=_num(r[3]), fte_adopted_2026=_num(r[4]),
                        amt_proposed_2027=_num(r[5]), fte_proposed_2027=_num(r[6]),
                    )
                    book.schools.append(school)
                    book.lines.extend(_emit_lines(school))
    return book


def main():
    ap = argparse.ArgumentParser(description="Parse the MPS per-school budget PDF.")
    ap.add_argument("--pdf", default=DEFAULT_PDF)
    ap.add_argument("--out", default="data/canonical/mps/2027/proposed/mps-schools.parquet")
    args = ap.parse_args()
    book = parse_school_book(args.pdf)
    df = lines_to_frame(book.lines)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out, index=False)
    df.assign(flags=df["flags"].apply(lambda f: "|".join(f) if isinstance(f, list) else "")) \
      .to_csv(out.with_suffix(".csv"), index=False)
    print(f"Parsed {len(book.schools)} schools ({len(book.lines)} facts) → {out}")


if __name__ == "__main__":
    main()
