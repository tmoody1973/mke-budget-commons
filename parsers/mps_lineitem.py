"""Milwaukee Public Schools line-item budget parser (L1).

A third species: the MPS FY2026-27 Revised Proposed Budget ships as a structured
`.xlsx`, not a PDF — the cleanest, most deterministic source of the three
governments. Parse with pandas; no pdfplumber, no OCR, no band-parsing. NO LLM
ever reads a number. Every emitted row cites its origin (sheet + spreadsheet row).

Verified structure (see CLAUDE.md → MPS facts):
- Sheet ``FY 27 PB Expenditures `` (trailing space): 33,283 real line items with
  6–7 segment account codes, plus 6 null-account memo/total rows.
- Sheet ``FY 27 Revenue``: revenue by source + a null-account grand-total row.
- Two vintages per row: ``FY26 FA`` (prior, fall-adjusted) and ``FY27 PB`` (proposed).
- Account code segments split on ``-``; segment index 2 is the fund letter.
- Reconciliation anchor (in-document): the real line items sum to the printed
  grand-total row — $1,600,555,548 for FY27, which equals gross − eliminations.
"""
from __future__ import annotations

import argparse
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import pandas as pd

from parsers.canonical import (
    BUDGET, EXPENDITURE, FTE, PROPOSED, REVENUE,
    BudgetLine, lines_to_frame,
)

DEFAULT_XLSX = "data/raw/mps/mps-2027-proposed-line-item.xlsx"
DOC_ID = "mps-2027-proposed-lineitem"
GOV = "mps"
DOC_TYPE = "proposed"

EXP_SHEET = "FY 27 PB Expenditures "   # note the trailing space
REV_SHEET = "FY 27 Revenue"

# Column vintages → (fiscal_year, amount_kind). FA = fall-adjusted prior budget;
# PB = proposed budget.
EXP_VINTAGES = [(2026, BUDGET, "FTE FY26 FA", "Amount FY26 FA"),
                (2027, PROPOSED, "FTE FY27 PB", "Amount FY27 PB")]
REV_VINTAGES = [(2026, BUDGET, "FTE 26", "Amount 26"),
                (2027, PROPOSED, "FTE 27", "Amount 27")]

REVENUE_DEPT = "Districtwide Revenue"   # revenue is not departmental


def _norm(col: str) -> str:
    """Collapse internal whitespace so 'Amount  FY26 FA' → 'Amount FY26 FA'."""
    return re.sub(r"\s+", " ", str(col)).strip()


def _num(v) -> Optional[float]:
    """Deterministic numeric coercion; blank/non-numeric → None."""
    if v is None:
        return None
    n = pd.to_numeric(v, errors="coerce")
    if pd.isna(n):
        return None
    return float(n)


def _account_segments(acct) -> Optional[list[str]]:
    if acct is None or pd.isna(acct):
        return None
    parts = str(acct).split("-")
    return parts


def _is_code(acct) -> bool:
    """A real line cites a structured account *code* — alphanumeric, no spaces.
    Rows labeled with a phrase instead (e.g. 'MKE Rec - Extension', the Milwaukee
    Recreation Extension Fund) are section/memo rows sitting outside the printed
    grand total, not line items."""
    if acct is None or pd.isna(acct):
        return False
    return " " not in str(acct).strip()


def _is_real_lineitem(acct) -> bool:
    """A real expenditure line has an account code (no spaces) with ≥3 segments
    (so a fund letter exists). The null-account rows, a lone 2-segment row, and
    phrase-labeled rows are printed totals / memo rows — excluded (documented)."""
    seg = _account_segments(acct)
    return _is_code(acct) and seg is not None and len(seg) >= 3


def _clean(v) -> Optional[str]:
    if v is None or pd.isna(v):
        return None
    s = re.sub(r"\s+", " ", str(v)).strip()
    return s or None


@dataclass
class VintageTotals:
    """Printed grand-total figures for one vintage (from the null-account rows)."""
    net: Optional[float] = None          # sum of line items = published budget
    gross: Optional[float] = None        # gross before internal eliminations
    eliminations: Optional[float] = None # gross − net
    net_fte: Optional[float] = None


@dataclass
class ExcludedRow:
    """A phrase-labeled row outside the printed grand total — surfaced, not dropped."""
    sheet: str
    label: str
    fy26: Optional[float]
    fy27: Optional[float]


@dataclass
class MpsBook:
    lines: list[BudgetLine] = field(default_factory=list)
    exp_totals: dict[int, VintageTotals] = field(default_factory=dict)   # by fiscal_year
    rev_totals: dict[int, float] = field(default_factory=dict)           # printed revenue total
    excluded: list[ExcludedRow] = field(default_factory=list)            # non-account rows, documented

    @property
    def exp_lines(self) -> list[BudgetLine]:
        return [l for l in self.lines if l.line_kind == EXPENDITURE]

    @property
    def rev_lines(self) -> list[BudgetLine]:
        return [l for l in self.lines if l.line_kind == REVENUE]


def _printed_exp_totals(memo: pd.DataFrame, amt_col: str, fte_col: str) -> VintageTotals:
    """Identify net/gross/eliminations from the null-account memo rows by their
    arithmetic relationship: gross − eliminations == net. Label-free and
    deterministic (the memo rows carry no text)."""
    vals = sorted({round(v, 2) for v in (_num(x) for x in memo[amt_col]) if v}, reverse=True)
    t = VintageTotals()
    if not vals:
        return t
    t.gross = vals[0]
    # net is the value V such that (gross − V) is also a printed memo value
    others = set(vals)
    for v in vals:
        if v != t.gross and round(t.gross - v, 2) in others:
            t.net, t.eliminations = v, round(t.gross - v, 2)
            break
    if t.net is None:                       # no gross/elim split printed → net = gross
        t.net = t.gross
    # FTE of the net row (the total-FTE row that carries the net amount)
    for _, r in memo.iterrows():
        if _num(r.get(amt_col)) is not None and round(_num(r[amt_col]), 2) == t.net:
            t.net_fte = _num(r.get(fte_col))
            break
    return t


def parse_workbook(xlsx_path: str = DEFAULT_XLSX) -> MpsBook:
    book = MpsBook()

    # ---- Expenditures ----
    exp = pd.read_excel(xlsx_path, sheet_name=EXP_SHEET)
    exp.columns = [_norm(c) for c in exp.columns]
    acct = exp["Account Number"]
    real = exp[acct.apply(_is_real_lineitem)]
    memo = exp[~acct.apply(_is_real_lineitem)]

    for idx, r in real.iterrows():
        seg = _account_segments(r["Account Number"])
        fund = seg[2] if seg and len(seg) > 2 else None
        common = dict(
            doc_id=DOC_ID, source_page=int(idx) + 2, gov_id=GOV, doc_type=DOC_TYPE,
            department_printed=_clean(r.get("Sch/Dept.")) or "Unassigned",
            division=_clean(r.get("Department/School")),
            line_description=_clean(r.get("Nature of Expenditure")) or "(unlabeled)",
            line_kind=EXPENDITURE, fund=fund, org=_clean(r.get("Location")),
            sbcl=_clean(r.get("Project")), account=_clean(r.get("Account Number")),
        )
        for fy, kind, fte_col, amt_col in EXP_VINTAGES:
            amt, fte = _num(r.get(amt_col)), _num(r.get(fte_col))
            if (amt or 0) == 0 and (fte or 0) == 0:
                continue
            book.lines.append(BudgetLine(
                **common, fiscal_year=fy, amount_kind=kind,
                amount=amt, units=fte,
            ))

    for fy, kind, fte_col, amt_col in EXP_VINTAGES:
        book.exp_totals[fy] = _printed_exp_totals(memo, amt_col, fte_col)

    # ---- Revenue ----
    rev = pd.read_excel(xlsx_path, sheet_name=REV_SHEET)
    rev.columns = [_norm(c) for c in rev.columns]
    racct = rev["Account Number"]
    is_code = racct.apply(_is_code)
    rreal = rev[is_code]
    rmemo = rev[racct.isna() | (racct.astype(str).str.strip() == "")]
    # phrase-labeled revenue rows (e.g. 'MKE Rec - Extension') sit outside the
    # printed grand total — record them so nothing is silently dropped.
    for _, r in rev[racct.notna() & (racct.astype(str).str.strip() != "") & ~is_code].iterrows():
        book.excluded.append(ExcludedRow(
            sheet="revenue", label=f"{_clean(r.get('Account Number'))}: {_clean(r.get('Description')) or ''}".strip(": "),
            fy26=_num(r.get("Amount 26")), fy27=_num(r.get("Amount 27"))))

    for idx, r in rreal.iterrows():
        common = dict(
            doc_id=DOC_ID, source_page=int(idx) + 2, gov_id=GOV, doc_type=DOC_TYPE,
            department_printed=REVENUE_DEPT, division=None,
            line_description=_clean(r.get("Description")) or "(unlabeled revenue)",
            line_kind=REVENUE, account=_clean(r.get("Account Number")),
        )
        for fy, kind, fte_col, amt_col in REV_VINTAGES:
            amt = _num(r.get(amt_col))
            if (amt or 0) == 0:
                continue
            book.lines.append(BudgetLine(**common, fiscal_year=fy, amount_kind=kind, amount=amt))

    # printed revenue grand total = the largest null-account memo amount per vintage
    for fy, kind, fte_col, amt_col in REV_VINTAGES:
        vals = [v for v in (_num(x) for x in rmemo[amt_col]) if v]
        book.rev_totals[fy] = max(vals) if vals else None

    return book


def main():
    ap = argparse.ArgumentParser(description="Parse the MPS proposed budget .xlsx.")
    ap.add_argument("--xlsx", default=DEFAULT_XLSX)
    ap.add_argument("--out", default="data/canonical/mps/2027/proposed/mps-lineitem-book.parquet")
    args = ap.parse_args()

    book = parse_workbook(args.xlsx)
    df = lines_to_frame(book.lines)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out, index=False)
    df.assign(flags=df["flags"].apply(lambda f: "|".join(f) if isinstance(f, list) else "")) \
      .to_csv(out.with_suffix(".csv"), index=False)
    print(f"Parsed {len(book.exp_lines)} expenditure + {len(book.rev_lines)} revenue "
          f"lines ({len(book.lines)} facts) → {out}")


if __name__ == "__main__":
    main()
