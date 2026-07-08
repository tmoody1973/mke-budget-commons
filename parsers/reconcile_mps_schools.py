"""Cross-document reconciliation for the MPS per-school budget PDF.

The per-school PDF and the district `.xlsx` line-item detail are two independent
MPS documents. This checks that each school's printed budget + FTE in the PDF
matches the sum of that school's line items in the `.xlsx` — a genuine
cross-document trust check. Matching is by normalized school name (the `.xlsx`
truncates names and carries no shared code), so it is best-effort: matched
schools must agree exactly; unmatched schools are **surfaced**, never hidden.

No LLM. Pure arithmetic + deterministic name normalization.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

import pandas as pd

from parsers.mps_lineitem import DEFAULT_XLSX, EXP_SHEET
from parsers.mps_schools import SchoolBook

EPS_DOLLARS = 0.5
EPS_FTE = 0.05


def _norm(s: str) -> str:
    """Normalize a school name for cross-document matching: uppercase, drop the
    generic words, keep alphanumerics only."""
    s = re.sub(r"\bSCHOOL\b|\bSCH\b|\bMONTESSORI\b|\bACADEMY\b", "", str(s).upper())
    return re.sub(r"[^A-Z0-9]", "", s)


@dataclass
class Check:
    school: str
    matched_xlsx: Optional[str]
    pdf_amount: Optional[float]
    xlsx_amount: Optional[float]
    pdf_fte: Optional[float]
    xlsx_fte: Optional[float]
    status: str                        # PASS | FAIL | UNMATCHED

    @property
    def delta(self) -> Optional[float]:
        if self.pdf_amount is None or self.xlsx_amount is None:
            return None
        return round(self.pdf_amount - self.xlsx_amount, 2)


def _xlsx_school_aggregates(xlsx_path: str) -> dict[str, dict]:
    """Per Sch/Dept code: summed FY27 amount + FTE and the (truncated) name."""
    exp = pd.read_excel(xlsx_path, sheet_name=EXP_SHEET)
    exp.columns = [re.sub(r"\s+", " ", str(c)).strip() for c in exp.columns]
    exp["amt"] = pd.to_numeric(exp["Amount FY27 PB"], errors="coerce").fillna(0)
    exp["fte"] = pd.to_numeric(exp["FTE FY27 PB"], errors="coerce").fillna(0)
    exp["sd"] = exp["Sch/Dept."].astype(str).str.strip()
    out: dict[str, dict] = {}
    for sd, g in exp.groupby("sd"):
        m = re.match(r"(\d{3})\s+(.*)", sd)
        if not m:
            continue
        out[sd] = {"name": m.group(2).upper().strip(),
                   "amt": round(g["amt"].sum(), 2), "fte": round(g["fte"].sum(), 2)}
    return out


def reconcile_schools(book: SchoolBook, xlsx_path: str = DEFAULT_XLSX) -> list[Check]:
    agg = _xlsx_school_aggregates(xlsx_path)
    # index by normalized truncated name → candidate codes (with nonzero budget)
    checks: list[Check] = []
    for s in book.schools:
        npdf = _norm(s.name)
        cands = [(sd, v) for sd, v in agg.items()
                 if _norm(v["name"]) and npdf.startswith(_norm(v["name"])) and v["amt"] != 0]
        cands.sort(key=lambda kv: -len(_norm(kv[1]["name"])))  # most specific prefix wins
        if not cands:
            checks.append(Check(s.name, None, s.amt_proposed_2027, None,
                                s.fte_proposed_2027, None, "UNMATCHED"))
            continue
        sd, v = cands[0]
        ok = (abs((s.amt_proposed_2027 or 0) - v["amt"]) <= EPS_DOLLARS
              and abs((s.fte_proposed_2027 or 0) - v["fte"]) <= EPS_FTE)
        checks.append(Check(s.name, f"{sd}", s.amt_proposed_2027, v["amt"],
                            s.fte_proposed_2027, v["fte"], "PASS" if ok else "FAIL"))
    return checks


def summarize(checks: list[Check]) -> dict:
    return {
        "passed": [c for c in checks if c.status == "PASS"],
        "failed": [c for c in checks if c.status == "FAIL"],
        "unmatched": [c for c in checks if c.status == "UNMATCHED"],
        "total": len(checks),
    }
