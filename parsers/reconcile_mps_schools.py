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
from pathlib import Path
from typing import Optional

import pandas as pd
import yaml

from parsers.mps_lineitem import DEFAULT_XLSX, EXP_SHEET
from parsers.mps_schools import SchoolBook

EPS_DOLLARS = 0.5
EPS_FTE = 0.05

_CROSSWALK_PATH = Path(__file__).resolve().parent.parent / "crosswalks" / "mps_schools.yml"


def _load_crosswalk() -> dict:
    if not _CROSSWALK_PATH.exists():
        return {"verified": {}, "discrepancies": {}}
    d = yaml.safe_load(_CROSSWALK_PATH.read_text()) or {}
    return {"verified": d.get("verified") or {}, "discrepancies": d.get("discrepancies") or {}}


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
    status: str                        # PASS | FAIL | UNMATCHED | DISCREPANCY
    via: str = "auto"                  # auto | crosswalk | discrepancy

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
    by_code = {sd.split()[0]: v for sd, v in agg.items()}   # 3-digit code → aggregate
    xwalk = _load_crosswalk()
    checks: list[Check] = []
    for s in book.schools:
        amt, fte = s.amt_proposed_2027, s.fte_proposed_2027
        # 1. curated crosswalk — verified exact mappings (re-checked every run)
        if s.name in xwalk["verified"]:
            v = by_code.get(str(xwalk["verified"][s.name]))
            ok = v and abs((amt or 0) - v["amt"]) <= EPS_DOLLARS and abs((fte or 0) - v["fte"]) <= EPS_FTE
            checks.append(Check(s.name, xwalk["verified"][s.name], amt, v["amt"] if v else None,
                                fte, v["fte"] if v else None, "PASS" if ok else "FAIL", via="crosswalk"))
            continue
        # 2. documented cross-document discrepancy (the two documents disagree)
        if s.name in xwalk["discrepancies"]:
            code = (xwalk["discrepancies"][s.name] or {}).get("code")
            v = by_code.get(str(code)) if code else None
            checks.append(Check(s.name, code, amt, v["amt"] if v else None,
                                fte, v["fte"] if v else None, "DISCREPANCY", via="discrepancy"))
            continue
        # 3. automatic normalized-name prefix match
        npdf = _norm(s.name)
        cands = [(sd, v) for sd, v in agg.items()
                 if _norm(v["name"]) and npdf.startswith(_norm(v["name"])) and v["amt"] != 0]
        cands.sort(key=lambda kv: -len(_norm(kv[1]["name"])))
        if not cands:
            checks.append(Check(s.name, None, amt, None, fte, None, "UNMATCHED"))
            continue
        sd, v = cands[0]
        ok = abs((amt or 0) - v["amt"]) <= EPS_DOLLARS and abs((fte or 0) - v["fte"]) <= EPS_FTE
        checks.append(Check(s.name, sd, amt, v["amt"], fte, v["fte"], "PASS" if ok else "FAIL"))
    return checks


def summarize(checks: list[Check]) -> dict:
    return {
        "passed": [c for c in checks if c.status == "PASS"],
        "failed": [c for c in checks if c.status == "FAIL"],
        "discrepancy": [c for c in checks if c.status == "DISCREPANCY"],
        "unmatched": [c for c in checks if c.status == "UNMATCHED"],
        "total": len(checks),
    }
