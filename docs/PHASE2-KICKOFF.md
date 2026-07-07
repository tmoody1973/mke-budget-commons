# Phase 2 — Claude Code kickoff prompt

Paste this into Claude Code from the repo root, after `pip install -r requirements.txt`
and dropping the source PDFs into `data/raw/city/` and `data/raw/county/`.

---

Read `CLAUDE.md` and `docs/PRD.md` first — especially §7.2 (verified city parsing
facts) and the reconciliation rules. Then build **Phase 2: parse ONE city department
end-to-end and reconcile it exactly.** Don't parse the whole book yet — prove the
vertical slice on one department, get reconciliation green, then we widen.

Target document: `data/raw/city/2026-CITY-OF-MILWAUKEE-DETAILED-BUDGET4.pdf`
(269 pages, native text layer, doc_id `city-2026-adopted-detailed`).

Pick a small-to-mid department with a clean total structure — the **Department of
Administration – ITMD** division region (around pages 40–46) is a good candidate, or
City Attorney. Whatever you pick, print the page range you're working and let me
confirm before you go wide.

## Build order

1. **`parsers/city_detailed.py`** — deterministic, pdfplumber coordinates + regex, NO LLM.
   - Load the PDF, iterate pages in the chosen department's range.
   - Per page: derive column bands from the header words (year labels ~top 39,
     `EXPENDITURE`/`BUDGET`/`PAY` ~top 50). Do NOT hardcode x-positions — read them
     from the header on each page. Assign right-aligned numbers by their x1 (right edge),
     left text by x0.
   - Cluster words into visual rows by `top` (±3pt).
   - Classify each row: department header / division header / position line (has pay
     range at x0≈469) / expenditure line (has FUND ORG SBCL ACCOUNT codes at x0≈36–121)
     / total-anchor row / FTE row.
   - Handle the two-physical-line position reclassification (2025 side w/ old pay range,
     2026 side w/ new) — join into one logical record. Parse `(42,642)` as negative.
   - Emit each row as a `BudgetLine` (from `parsers/canonical.py`) with the three
     `amount_kind` vintages present: 2024 `actual`, 2025 `budget`, 2026 `adopted`.
   - Capture footnote codes `(A)(Y)(X)...` into `flags[]`.
   - Write raw output to `data/canonical/city/2026/adopted/<dept>.csv` and `.parquet`.

2. **`tests/test_reconcile_city_detailed.py`** — pytest, the trust layer.
   - Sum extracted position + expenditure lines and assert they match the printed
     reserved-code anchors: `006000` (net salaries), `006300` (operating expenditures),
     `006800` (equipment), SPECIAL FUNDS TOTAL, and the division/dept `TOTAL` rows.
   - Assert extracted FTE counts match `TOTAL NUMBER OF POSITIONS AUTHORIZED` and
     `O&M FTE'S` / `NON-O&M FTE'S`.
   - Exact match. On mismatch: don't silently pass — record it and print the delta.
     If line items genuinely disagree with the printed total in the PDF, mark it
     `source_inconsistency`, not a test failure to paper over (per CLAUDE.md).

3. **`docs/reconciliation-reports/city-2026-adopted-detailed.md`** — write the result:
   which anchors reconciled exactly, any discrepancies + disposition.

4. **`make parse-city-detailed FY=2026 TYPE=adopted`** and **`make reconcile`** should
   run the above. Wire the Makefile args through argparse in the parser.

## Definition of done for Phase 2

One department's line items sum **exactly** to every printed total anchor in its
section, the reconciliation report says so, `make reconcile` is green, and the CSV is
human-legible. Then stop and show me — Phase 3 (whole city book) is the next session.

Keep me posted on the forks (e.g. if a department's total structure differs from ITMD's),
but build mode — ship it, explain briefly, don't teach unless I ask.
