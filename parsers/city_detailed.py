"""City of Milwaukee Detailed Budget parser — deterministic, no LLM.

Reads the native text layer of the adopted Detailed Budget with pdfplumber
coordinates and regex only. Column bands are derived from each page's header
words (never hardcoded) so year-to-year layout drift is absorbed.

Three value vintages sit side by side in the adopted book and each is emitted
as its own canonical BudgetLine:

    2024 EXPENDITURE  -> amount_kind=actual   fiscal_year=2024
    2025 BUDGET       -> amount_kind=budget   fiscal_year=2025
    2026 BUDGET       -> amount_kind=adopted  fiscal_year=2026

Reconciliation (tests/) is column-wise: every printed number lives in exactly
one vintage column, so summing a column and comparing to that column's printed
reserved-code anchor is exact and robust — even when a position's 2025 and 2026
halves (a reclassification) print far apart on the page.

See CLAUDE.md §"Verified parsing facts" and docs/PRD.md §7.2.
"""
from __future__ import annotations

import argparse
import re
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import pdfplumber

from parsers.canonical import (
    ACTUAL, ADOPTED, BUDGET, PROPOSED, REQUESTED,
    EXPENDITURE, FTE, POSITION, SUBTOTAL, TOTAL,
    BudgetLine, CANONICAL_COLUMNS, lines_to_frame,
)

GOV_ID = "city"

# Money-section headers (all-caps, no numbers). These set the reconciliation
# bucket a following coded/valued row belongs to.
SEC_SALARIES = "salaries"
SEC_OPERATING = "operating"
SEC_EQUIPMENT = "equipment"
SEC_SPECIAL = "special"
SECTION_HEADERS = {
    "SALARIES & WAGES": SEC_SALARIES,
    "OPERATING EXPENDITURES": SEC_OPERATING,
    "EQUIPMENT PURCHASES": SEC_EQUIPMENT,
    "SPECIAL FUNDS": SEC_SPECIAL,
}
# The reserved-code section totals also mark the section boundary (for pages that
# omit the section-header rows).
_SECTION_AFTER_ANCHOR = {
    "anchor_operating": SEC_OPERATING,
    "anchor_equipment": SEC_EQUIPMENT,
    "anchor_special": SEC_SPECIAL,
}

# Reserved-code reconciliation anchors keyed by their printed description.
ANCHOR_NET_SALARIES = "006000"
ANCHOR_FRINGE = "006100"
ANCHOR_OPERATING = "006300"
ANCHOR_EQUIPMENT = "006800"

PAY_RANGE_RE = re.compile(r"^[0-9A-Z]{2,4}$")
# The closed vocabulary of salary adjustment / deduction rows (asterisks stripped).
# ("General Auxiliary Positions" is NOT here — it is a units-only position count.)
_ADJUSTMENT_RE = re.compile(
    r"DEDUCTION|OVERTIME|PERSONNEL COST|WAGE RATE|RATE CHANGE|ALL OTHER SALAR"
)
FOOTNOTE_RE = re.compile(r"\(([A-Z]{1,4})\)")
NUMERIC_RE = re.compile(r"[\d(]")  # a value token contains a digit or an open paren


# --------------------------------------------------------------------------- #
# Document layout — everything geometry-specific lives here, so the same
# classifier/segmenter/reconciler serves the Adopted book (3 vintages, portrait)
# and the Requested book (4 vintages, landscape). A page-header row of DOLLARS /
# UNITS words gives the per-page x anchors; the layout says what each column means.
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class Column:
    key: str          # unique column key, e.g. "dol2026"
    side: str         # 'left' (before description) | 'right' (after pay range)
    role: str         # 'dollars' | 'units'
    fy: int = 0       # dollar columns: the fiscal year
    kind: str = ""    # dollar columns: the amount_kind (actual/budget/adopted/requested/proposed)
    units_for: Optional[str] = None  # dollar columns: paired units column key


@dataclass(frozen=True)
class Layout:
    doc_id: str
    default_pdf: str
    doc_type: str
    columns: tuple                # ordered left->right (DOLLARS/UNITS header words)
    code_max_x: float             # account codes sit left of this
    left_value_max_x1: float      # left value columns end by this x1
    pay_min_x: float              # pay-range zone start
    right_min_x: float            # right value columns start
    header_top_max: float         # DOLLARS/UNITS header words are above this
    body_top_min: float           # body rows start at/after this top
    actual_kind: str              # the vintage with no per-position detail (prior-year actuals)
    book_pages: tuple             # (start, end) 1-based departmental ledger range

    def _keys(self, side):
        return [c.key for c in self.columns if c.side == side]

    def vintages(self):
        """(dollar_key, units_key, fiscal_year, amount_kind) per dollar column."""
        return [(c.key, c.units_for, c.fy, c.kind) for c in self.columns if c.role == "dollars"]

    def kinds(self):
        return [c.kind for c in self.columns if c.role == "dollars"]

    def left_keys(self):
        return self._keys("left")

    def right_keys(self):
        return self._keys("right")


def derive_bands(words: list[dict], layout: "Layout") -> Optional[dict]:
    """Map the page's DOLLARS/UNITS header words (in x order) to column keys."""
    hdr = [w for w in words if w["top"] < layout.header_top_max and w["text"] in ("DOLLARS", "UNITS")]
    hdr = sorted(hdr, key=lambda w: w["x0"])
    if len(hdr) != len(layout.columns):
        return None
    return {c.key: w["x1"] for c, w in zip(layout.columns, hdr)}


def _nearest(anchors: dict, keys: list[str], x1: float) -> str:
    return min(keys, key=lambda k: abs(x1 - anchors[k]))


# Verified geometry (see CLAUDE.md §"Verified parsing facts").
ADOPTED_LAYOUT = Layout(
    doc_id="city-2026-adopted-detailed",
    default_pdf="data/raw/city/2026-CITY-OF-MILWAUKEE-DETAILED-BUDGET4.pdf",
    doc_type="adopted",
    columns=(
        Column("exp2024", "left", "dollars", 2024, ACTUAL, None),
        Column("units2025", "left", "units"),
        Column("dol2025", "left", "dollars", 2025, BUDGET, "units2025"),
        Column("units2026", "right", "units"),
        Column("dol2026", "right", "dollars", 2026, ADOPTED, "units2026"),
    ),
    code_max_x=158, left_value_max_x1=308, pay_min_x=463, right_min_x=496,
    header_top_max=70, body_top_min=70, actual_kind=ACTUAL, book_pages=(1, 180),
)

# Requested Budget — landscape, 4 vintages: prior actual / current budget /
# requested / proposed. Same reserved-anchor architecture.
REQUESTED_LAYOUT = Layout(
    doc_id="city-2027-requested-detailed",
    default_pdf="data/raw/city/2027-Budget-Requests---City-of-Milwaukee.pdf",
    doc_type="requested",
    columns=(
        Column("exp2025", "left", "dollars", 2025, ACTUAL, None),
        Column("units2026", "left", "units"),
        Column("dol2026", "left", "dollars", 2026, BUDGET, "units2026"),
        Column("units2027req", "right", "units"),
        Column("dol2027req", "right", "dollars", 2027, REQUESTED, "units2027req"),
        Column("units2027prop", "right", "units"),
        Column("dol2027prop", "right", "dollars", 2027, PROPOSED, "units2027prop"),
    ),
    code_max_x=205, left_value_max_x1=365, pay_min_x=545, right_min_x=576,
    header_top_max=88, body_top_min=88, actual_kind=ACTUAL, book_pages=(1, 311),
)

# Backward-compatible module defaults (the adopted book).
DOC_ID = ADOPTED_LAYOUT.doc_id
DEFAULT_PDF = ADOPTED_LAYOUT.default_pdf


# --------------------------------------------------------------------------- #
# Row extraction — split each visual row into code / value / desc / pay zones.
# --------------------------------------------------------------------------- #
@dataclass
class RawRow:
    page: int                       # 1-based source page
    top: float
    fund: Optional[str] = None
    org: Optional[str] = None
    sbcl: Optional[str] = None
    account: Optional[str] = None
    description: str = ""
    pay_range: Optional[str] = None
    values: dict = field(default_factory=dict)   # column-key -> float
    flags: list[str] = field(default_factory=list)

    @property
    def has_code(self) -> bool:
        return self.account is not None

    @property
    def has_values(self) -> bool:
        return bool(self.values)


def parse_amount(text: str) -> Optional[float]:
    """Parse a column's joined token text into a signed float. Parens = negative."""
    s = text.replace(" ", "").replace(",", "").replace("$", "").replace("*", "")
    neg = "(" in s
    s = s.replace("(", "").replace(")", "")
    if s == "" or not re.fullmatch(r"\d+(\.\d+)?", s):
        return None
    v = float(s)
    return -v if neg else v


_NUM_FRAG_RE = re.compile(r"^[\d,()]+$")


def _merge_split_numbers(ws: list[dict]) -> list[dict]:
    """Rejoin big numbers pdfplumber splits mid-value (e.g. '7' + '5,536,864').

    On summary pages an 8-digit figure prints as two x-adjacent tokens (gap ~0).
    Merge adjacent pure-numeric fragments whose gap < 1.5pt — well below the
    ~7pt account-code gap and the ~46pt inter-column gap, so nothing legitimate
    is fused.
    """
    out: list[dict] = []
    for w in ws:
        if (out and _NUM_FRAG_RE.match(w["text"]) and _NUM_FRAG_RE.match(out[-1]["text"])
                and w["x0"] - out[-1]["x1"] < 1.5):
            prev = out[-1]
            out[-1] = {**prev, "text": prev["text"] + w["text"], "x1": w["x1"]}
        else:
            out.append(w)
    return out


def extract_row(row_words: list[dict], bands: dict, layout: "Layout") -> RawRow:
    ws = _merge_split_numbers(sorted(row_words, key=lambda w: w["x0"]))
    page = row_words[0].get("_page")
    top = row_words[0]["top"]
    raw = RawRow(page=page, top=top)

    code_tokens: list[dict] = []
    desc_tokens: list[dict] = []
    left_vals: dict[str, list[dict]] = defaultdict(list)
    right_vals: dict[str, list[dict]] = defaultdict(list)
    left_keys, right_keys = layout.left_keys(), layout.right_keys()

    for w in ws:
        x0, x1, txt = w["x0"], w["x1"], w["text"]
        if x0 < layout.code_max_x:                              # account-code zone
            code_tokens.append(w)
        elif x1 <= layout.left_value_max_x1:                    # prior-year value zone
            left_vals[_nearest(bands, left_keys, x1)].append(w)
        elif x0 < layout.pay_min_x:                             # description zone
            desc_tokens.append(w)
        elif x0 < layout.right_min_x:                           # pay-range zone
            if PAY_RANGE_RE.match(txt):
                raw.pay_range = txt
            else:
                desc_tokens.append(w)
        else:                                                   # current-year value zone
            if NUMERIC_RE.search(txt):
                right_vals[_nearest(bands, right_keys, x1)].append(w)
            else:
                desc_tokens.append(w)

    # account codes: FUND ORG SBCL ACCOUNT by x0 order, only when a 6-digit
    # ACCOUNT is present (the discriminator for a coded ledger row).
    if code_tokens:
        codes = sorted(code_tokens, key=lambda w: w["x0"])
        texts = [c["text"] for c in codes]
        if len(texts) >= 4 and re.fullmatch(r"\d{6}", texts[3]):
            raw.fund, raw.org, raw.sbcl, raw.account = texts[0], texts[1], texts[2], texts[3]
        else:
            # stray left text (rare) — fold into description
            desc_tokens = codes + desc_tokens

    raw.description = " ".join(w["text"] for w in sorted(desc_tokens, key=lambda w: w["x0"])).strip()
    raw.flags = FOOTNOTE_RE.findall(raw.description)

    for col, toks in {**left_vals, **right_vals}.items():
        joined = "".join(t["text"] for t in sorted(toks, key=lambda w: w["x0"]))
        v = parse_amount(joined)
        if v is not None:
            raw.values[col] = v
    return raw


# --------------------------------------------------------------------------- #
# Classification + canonical emission.
# --------------------------------------------------------------------------- #
def is_all_caps_label(raw: RawRow) -> bool:
    if raw.has_code or raw.has_values or raw.pay_range:
        return False
    d = raw.description.strip()
    letters = [c for c in d if c.isalpha()]
    return bool(letters) and d.upper() == d


def is_caps_name(text: str) -> bool:
    """A NAME printed in all caps (>=5 letters), e.g. a wrapped division total."""
    letters = [c for c in text if c.isalpha()]
    return len(letters) >= 5 and "".join(letters) == "".join(letters).upper()


def classify(raw: RawRow, section: str, seen_equipment_total: bool = False) -> Optional[str]:
    """Return a line_kind, or None to skip (pure label / page furniture)."""
    d = raw.description
    du = d.upper().replace("*", "")  # '*' = appropriation-control marker, not semantic

    # Footnote definition lines — "(VRF) The Budget Director shall inform...",
    # "(BB) 2022-27 COPS Hiring Prog. Grant..." — are prose that occasionally pick
    # up a stray value; never a budget row. (A wrapped position's second line
    # starts with back-to-back codes and carries a pay range, so it isn't caught.)
    if not raw.pay_range and not raw.account and re.match(r"^\([A-Z0-9/]{1,6}\)\s+\S", d):
        return None

    # Reserved-code / printed-total anchors (matched on canonical descriptions).
    if "NET SALARIES & WAGES TOTAL" in du:
        return "anchor_net_salaries"
    if "ESTIMATED EMPLOYEE FRINGE BENEFITS" in du:
        return "anchor_fringe"
    if "OPERATING EXPENDITURES TOTAL" in du:
        return "anchor_operating"
    if "EQUIPMENT PURCHASES TOTAL" in du:
        return "anchor_equipment"
    # "SPECIAL FUNDS TOTAL" on detail pages; on summary pages the same anchor is
    # labeled just "SPECIAL FUNDS" but carries values (section headers are valueless).
    if du.strip() in ("SPECIAL FUNDS TOTAL", "SPECIAL FUNDS"):
        return "anchor_special"
    if "TOTAL BEFORE ADJUSTMENTS" in du:
        return "salary_tba"
    if "GROSS SALARIES & WAGES TOTAL" in du:
        return "salary_gross"
    if "TOTAL NUMBER OF POSITIONS AUTHORIZED" in du:
        return "fte_positions_authorized"
    if "O&M FTE" in du:
        return "fte_om" if du.strip().startswith("O&M") else "fte_nonom"

    # An operating expenditure line is unambiguous by its account code (630xxx-
    # 637xxx), regardless of the tracked section — condensed summary pages omit the
    # section-header rows, so section state can still read SALARIES here.
    if raw.account and re.fullmatch(r"63\d{4}", raw.account):
        return EXPENDITURE

    # Unit / division grand totals always appear AFTER the salaries block (never
    # inside it), so gate on section to avoid misreading a salary row whose pay
    # range drifted off its expected x (e.g. "SCBA ICM 1 80,000") as a boundary.
    # Unit / division grand totals are printed as ALL-CAPS total lines outside the
    # salaries block. Requiring all-caps keeps title-case items that merely contain
    # the word "total" — e.g. "Portable Lifts/Hoists (8 in total)" — from being
    # mistaken for a boundary. Every reserved sub-anchor above is already returned.
    if section != SEC_SALARIES and raw.has_values and not raw.pay_range and is_caps_name(d):
        # explicit "... TOTAL" (but not "SUBTOTAL") — e.g. "DECISION UNIT TOTAL"
        if not du.startswith("SUBTOTAL") and re.search(r"\bTOTAL\b", du):
            return "anchor_grand_total"
        # wrapped / no-keyword total after the equipment total (006800) —
        # e.g. "(1BCU=2DU)", "OFFICE OF COMMUNITY WELLNESS AND SAFETY". Gating on
        # seen_equipment_total keeps all-caps equipment *item* names that precede
        # it — e.g. "SCBA ICM" — from being mistaken for a unit boundary.
        if seen_equipment_total and not raw.account:
            return "anchor_grand_total"

    if section == SEC_SALARIES:
        if raw.pay_range:
            return POSITION
        if raw.has_values:
            # A salary subtotal (e.g. "Total Auxiliary Personnel") sums positions
            # already counted — exclude it so it isn't double-added.
            if "TOTAL" in du:
                return "salary_subtotal"
            # The adjustment/deduction rows between the position list and NET
            # SALARIES are a small closed vocabulary. Anything else valued with no
            # pay range is a position whose pay range wrapped to the next line
            # (e.g. "Equal Rights Commissioner (Y)") — classify it as a position so
            # its headcount and salary are bucketed correctly.
            if du.strip() == "OTHER" or _ADJUSTMENT_RE.search(du):
                return "salary_deduction" if "DEDUCTION" in du else "salary_adjustment"
            # A position has a title, so a blank / number-only description is a
            # mangled total, not a position.
            if not any(c.isalpha() for c in d):
                return None
            # A real position has a non-negative integer headcount; a negative or
            # fractional unit is a wrapped footnote note ("...(0.5 FTE)"), not a position.
            unit_vals = [v for key, v in raw.values.items() if "units" in key]
            if any(u is not None and (u < 0 or u != int(u)) for u in unit_vals):
                return None
            return POSITION
        return None  # section/division label
    if section == SEC_OPERATING:
        if raw.has_values:
            return EXPENDITURE
        return None
    if section == SEC_EQUIPMENT:
        if du.startswith("SUBTOTAL"):
            return SUBTOTAL
        if raw.has_values:
            return "equipment_item"
        return None
    if section == SEC_SPECIAL:
        if raw.has_values:
            return "special_item"
        return None
    return None


@dataclass
class ParsedUnit:
    """One reconciliation unit (a division / budgetary control unit)."""
    department_printed: str
    division: Optional[str]
    lines: list[BudgetLine] = field(default_factory=list)
    kinds: list[str] = field(default_factory=list)   # parallel line_kind tags (pre-canonical)
    title: str = ""                                  # first all-caps header block
    grand_desc: str = ""                             # description of the closing total row

    @property
    def page_start(self) -> Optional[int]:
        pages = [ln.source_page for ln in self.lines if ln.source_page]
        return min(pages) if pages else None

    @property
    def page_end(self) -> Optional[int]:
        pages = [ln.source_page for ln in self.lines if ln.source_page]
        return max(pages) if pages else None

    @property
    def label(self) -> str:
        t = re.sub(r"\s+", " ", self.title).strip().title()
        return t or self.department_printed or "(unnamed unit)"


def _clean_dept(footer_dept: str) -> str:
    return footer_dept.title().replace("Itmd", "ITMD")


_FOOTNOTE_ONLY_RE = re.compile(r"^(\([A-Z0-9/]{1,6}\))+$")


def _join_wrapped_positions(events: list[list]) -> None:
    """Reclassify the first line of a position whose pay range wrapped.

    When footnotes overflow, a position prints as two rows: line 1 carries the
    title + prior-year side but no pay range (so it lands in the adjustment
    bucket), and line 2 is footnote overflow + the pay range + current-year side.
    A `position` row whose description is *only* footnote codes is always such a
    continuation, so the valued no-pay row immediately before it is that
    position's first line. Mutates `events` in place. (kind is index 1.)
    """
    for i, ev in enumerate(events):
        if ev[1] != POSITION or not _FOOTNOTE_ONLY_RE.match(ev[0].description.strip()):
            continue
        j = i - 1
        while j >= 0 and events[j][1] in ("section", "label"):
            j -= 1
        if j >= 0:
            prev = events[j]
            if prev[1] == "salary_adjustment" and prev[0].has_values and not prev[0].pay_range:
                prev[1] = POSITION


def _iter_rows(pdf_path: str, start_page: int, end_page: Optional[int],
               layout: "Layout" = ADOPTED_LAYOUT):
    """Yield (raw, kind, department, division, section) for every meaningful row.

    Section headers and all-caps labels are yielded with sentinel kinds
    ("section", "label") so callers can track structure without re-parsing.
    """
    section = SEC_SALARIES
    division_label: Optional[str] = None
    department = ""
    seen_equipment_total = False  # per-unit: passed the 006800 total yet?

    with pdfplumber.open(pdf_path) as pdf:
        end = end_page or len(pdf.pages)
        for pno in range(start_page, end + 1):
            page = pdf.pages[pno - 1]
            words = page.extract_words()
            for w in words:
                w["_page"] = pno
            bands = derive_bands(words, layout)
            if bands is None:
                continue  # front/back matter or non-standard layout — skip

            rows = defaultdict(list)
            for w in words:
                if w["top"] < layout.body_top_min:
                    continue  # repeating header band
                rows[round(w["top"] / 3)].append(w)  # cluster by ~3pt

            footer = _read_footer(rows)
            if footer:
                department = footer
            footer_key = max(rows) if rows else None  # bottom-most row = page footer

            # Build the page's events in reading order, then fix wrapped positions
            # (a within-page pattern) before yielding.
            events: list[list] = []
            for key in sorted(rows):
                if key == footer_key:
                    continue  # skip the running "DEPARTMENT - NN -" footer line
                raw = extract_row(rows[key], bands, layout)
                if not raw.description and not raw.has_values and not raw.has_code:
                    continue
                if _is_page_footer(raw.description):
                    continue

                if raw.description.upper() in SECTION_HEADERS and not raw.has_values:
                    section = SECTION_HEADERS[raw.description.upper()]
                    events.append([raw, "section", department, division_label, section])
                    continue
                if is_all_caps_label(raw) and not raw.has_values:
                    division_label = raw.description.title()
                    events.append([raw, "label", department, division_label, section])
                    continue

                kind = classify(raw, section, seen_equipment_total)
                if kind is None:
                    continue
                if kind == "anchor_equipment":
                    seen_equipment_total = True
                events.append([raw, kind, department, division_label, section])
                # Advance the money-section on the reserved-code totals too, so
                # condensed summary pages (which omit the section-header rows) still
                # move out of SALARIES before the grand total — otherwise the grand
                # total is mistaken for a salary subtotal and the unit never closes.
                section = _SECTION_AFTER_ANCHOR.get(kind, section)
                if kind == "anchor_grand_total":
                    # new reconciliation unit starts fresh after a grand total
                    section = SEC_SALARIES
                    division_label = None
                    seen_equipment_total = False

            _join_wrapped_positions(events)
            for ev in events:
                yield tuple(ev)


def parse_range(pdf_path: str, start_page: int, end_page: int,
                layout: "Layout" = ADOPTED_LAYOUT) -> ParsedUnit:
    """Parse pages [start_page, end_page] (1-based) into ONE unit (no segmenting)."""
    unit = ParsedUnit(department_printed="", division=None)
    department = ""
    title_parts: list[str] = []
    title_locked = False
    for raw, kind, dept, division, section in _iter_rows(pdf_path, start_page, end_page, layout):
        department = dept
        if kind == "label":
            if not title_locked:
                title_parts.append(raw.description)
            continue
        if kind == "section":
            title_locked = True
            continue
        _emit(unit, raw, kind, dept, division, section, layout)
        if kind == "anchor_grand_total" and not unit.grand_desc:
            unit.grand_desc = raw.description
    unit.department_printed = _clean_dept(department)
    unit.title = " ".join(title_parts)
    return unit


def parse_book(pdf_path: str, start_page: int = 1, end_page: Optional[int] = None,
               layout: "Layout" = ADOPTED_LAYOUT) -> list[ParsedUnit]:
    """Segment the whole book into reconciliation units at each grand-total row."""
    units: list[ParsedUnit] = []
    cur = ParsedUnit(department_printed="", division=None)
    title_parts: list[str] = []
    title_locked = False
    last_dept = ""

    for raw, kind, dept, division, section in _iter_rows(pdf_path, start_page, end_page, layout):
        last_dept = dept or last_dept
        if kind == "label":
            if not title_locked:
                title_parts.append(raw.description)
            continue
        if kind == "section":
            if title_parts:
                title_locked = True
            continue

        _emit(cur, raw, kind, dept, division, section, layout)
        if kind == "anchor_grand_total":
            cur.department_printed = _clean_dept(dept)
            cur.division = division
            cur.grand_desc = raw.description
            cur.title = " ".join(title_parts)
            units.append(cur)
            cur = ParsedUnit(department_printed="", division=None)
            title_parts, title_locked = [], False

    if cur.lines:  # trailing rows with no closing grand total
        cur.department_printed = _clean_dept(last_dept)
        cur.title = " ".join(title_parts)
        units.append(cur)
    return units


def _read_footer(rows: dict) -> Optional[str]:
    """Department from the running footer. Two formats:

        Adopted book:   'CITY ATTORNEY - 25 -'
        Requested book: 'DEPARTMENT OF ADMINISTRATION 120.1 1st Run 3/3/26'
    """
    if not rows:
        return None
    last = rows[max(rows)]
    txt = " ".join(w["text"] for w in sorted(last, key=lambda w: w["x0"]))
    m = re.match(r"^(.*?)\s*-\s*\d+\s*-\s*$", txt)          # NAME - NN -
    if m:
        return m.group(1).strip()
    m = re.match(r"^(.*?)\s+\d+\.\d+\s+.*\bRun\b", txt)     # NAME NNN.N <n>st Run <date>
    if m:
        return m.group(1).strip()
    return None


def _is_page_footer(desc: str) -> bool:
    return bool(re.search(r"-\s*\d+\s*-\s*$", desc)) or "*Appropriation Control Account" in desc


ANCHOR_ACCOUNTS = {
    "anchor_net_salaries": ANCHOR_NET_SALARIES,
    "anchor_fringe": ANCHOR_FRINGE,
    "anchor_operating": ANCHOR_OPERATING,
    "anchor_equipment": ANCHOR_EQUIPMENT,
}
ANCHOR_KIND_TO_LINEKIND = {
    "anchor_net_salaries": TOTAL, "anchor_fringe": TOTAL, "anchor_operating": TOTAL,
    "anchor_equipment": TOTAL, "anchor_special": TOTAL, "anchor_grand_total": TOTAL,
    "salary_tba": SUBTOTAL, "salary_gross": SUBTOTAL, "salary_subtotal": SUBTOTAL,
    "salary_adjustment": SUBTOTAL, "salary_deduction": SUBTOTAL,
    "equipment_item": EXPENDITURE, "special_item": EXPENDITURE,
    "fte_om": FTE, "fte_nonom": FTE, "fte_positions_authorized": FTE,
}


def _emit(unit: ParsedUnit, raw: RawRow, kind: str, department: str,
          division: Optional[str], section: str, layout: "Layout") -> None:
    """Emit one BudgetLine per present vintage for this raw row."""
    line_kind = ANCHOR_KIND_TO_LINEKIND.get(kind, kind)
    account = raw.account or ANCHOR_ACCOUNTS.get(kind)

    # FTE rows carry a value in the dollars columns that is actually a unit count.
    fte_kind = kind in ("fte_om", "fte_nonom", "fte_positions_authorized")

    for col, units_col, fy, amount_kind in layout.vintages():
        amt = raw.values.get(col)
        units = raw.values.get(units_col) if units_col else None
        if fte_kind:
            # the "amount" is really the FTE/position count for that vintage
            count = amt
            if count is None and units is not None:
                count = units
            if count is None:
                continue
            unit.lines.append(BudgetLine(
                doc_id=layout.doc_id, source_page=raw.page, gov_id=GOV_ID, fiscal_year=fy,
                doc_type=layout.doc_type, department_printed=_clean_dept(department),
                division=division, line_description=raw.description, line_kind=FTE,
                amount=None, amount_kind=amount_kind, units=count,
                account=account, flags=list(raw.flags),
            ))
            unit.kinds.append(kind)
            continue

        if amt is None and units is None:
            continue
        unit.lines.append(BudgetLine(
            doc_id=layout.doc_id, source_page=raw.page, gov_id=GOV_ID, fiscal_year=fy,
            doc_type=layout.doc_type, department_printed=_clean_dept(department),
            division=division, line_description=raw.description, line_kind=line_kind,
            amount=amt, amount_kind=amount_kind, units=units,
            fund=raw.fund, org=raw.org, sbcl=raw.sbcl, account=account,
            pay_range=raw.pay_range, flags=list(raw.flags),
        ))
        unit.kinds.append(kind)


# --------------------------------------------------------------------------- #
# Output
# --------------------------------------------------------------------------- #
def slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return s or "unit"


def write_unit(unit: ParsedUnit, fy: int, doc_type: str, slug: str) -> Path:
    out_dir = Path(f"data/canonical/{GOV_ID}/{fy}/{doc_type}")
    out_dir.mkdir(parents=True, exist_ok=True)
    df = lines_to_frame(unit.lines)
    # stable column order + CSV-friendly flags
    df = df.reindex(columns=CANONICAL_COLUMNS)
    csv_df = df.copy()
    csv_df["flags"] = csv_df["flags"].apply(lambda xs: "|".join(xs) if isinstance(xs, list) else "")
    csv_path = out_dir / f"{slug}.csv"
    pq_path = out_dir / f"{slug}.parquet"
    csv_df.to_csv(csv_path, index=False)
    try:
        df.to_parquet(pq_path, index=False)
    except Exception as exc:  # pragma: no cover - parquet engine optional
        print(f"  (parquet skipped: {exc})")
    return csv_path


def write_book(units: list[ParsedUnit], fy: int, doc_type: str,
               slug: str = "city-detailed-book") -> Path:
    """Combine every unit's canonical lines into one diffable book-wide file."""
    out_dir = Path(f"data/canonical/{GOV_ID}/{fy}/{doc_type}")
    out_dir.mkdir(parents=True, exist_ok=True)
    all_lines = [ln for u in units for ln in u.lines]
    df = lines_to_frame(all_lines).reindex(columns=CANONICAL_COLUMNS)
    csv_df = df.copy()
    csv_df["flags"] = csv_df["flags"].apply(lambda xs: "|".join(xs) if isinstance(xs, list) else "")
    csv_path = out_dir / f"{slug}.csv"
    csv_df.to_csv(csv_path, index=False)
    try:
        df.to_parquet(out_dir / f"{slug}.parquet", index=False)
    except Exception as exc:  # pragma: no cover
        print(f"  (parquet skipped: {exc})")
    return csv_path


# Departmental line-item ledger runs pp.17-180; pp.181+ are citywide fund /
# special-purpose / capital budgets (a different doc species, out of P0 scope).
BOOK_START, BOOK_END = 1, 180

# Phase 2 targets — single reconciliation units confirmed by inspection.
TARGETS = {
    "itmd": {
        "start": 40, "end": 42, "slug": "dept-of-administration-itmd",
        "label": "Department of Administration – Information & Technology Management Division",
    },
    "city-attorney": {
        "start": 47, "end": 49, "slug": "city-attorney",
        "label": "City Attorney",
    },
}


def main() -> None:
    ap = argparse.ArgumentParser(description="Parse the city detailed budget PDF (one unit).")
    ap.add_argument("--fy", type=int, default=2026)
    ap.add_argument("--type", default="adopted")
    ap.add_argument("--pdf", default=DEFAULT_PDF)
    ap.add_argument("--target", default="itmd", choices=list(TARGETS) + ["all"])
    ap.add_argument("--book", action="store_true",
                    help="parse the whole departmental ledger (pp.%d-%d)" % (BOOK_START, BOOK_END))
    ap.add_argument("--start-page", type=int, help="override: 1-based start page")
    ap.add_argument("--end-page", type=int, help="override: 1-based end page")
    ap.add_argument("--slug", help="override output slug")
    args = ap.parse_args()

    if args.book:
        units = parse_book(args.pdf, BOOK_START, BOOK_END)
        path = write_book(units, args.fy, args.type)
        n_lines = sum(len(u.lines) for u in units)
        print(f"Departmental ledger  (pp. {BOOK_START}-{BOOK_END})  ->  {path}  "
              f"[{len(units)} units, {n_lines} canonical lines]")
        return

    if args.start_page and args.end_page:
        targets = [{"start": args.start_page, "end": args.end_page,
                    "slug": args.slug or "custom", "label": "custom range"}]
    elif args.target == "all":
        targets = list(TARGETS.values())
    else:
        targets = [TARGETS[args.target]]

    for t in targets:
        unit = parse_range(args.pdf, t["start"], t["end"])
        path = write_unit(unit, args.fy, args.type, t["slug"])
        print(f"{t['label']}  (pp. {t['start']}-{t['end']})  ->  {path}  "
              f"[{len(unit.lines)} canonical lines]")


if __name__ == "__main__":
    main()
