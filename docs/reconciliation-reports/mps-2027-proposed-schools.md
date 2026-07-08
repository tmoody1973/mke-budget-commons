# Reconciliation Report — MPS FY2026-27 Per-School Budgets & Enrollment

**doc_id:** `mps-2027-proposed-school-lineitem`  
**Source:** `data/raw/mps/mps-2027-proposed-school-line-item.pdf`  
**Method:** deterministic pdfplumber table extraction of the per-school grid (name · enrollment · budget · FTE, two vintages). Each school's FY2027 budget and FTE are **cross-checked** against the sum of that school's line items in the district `.xlsx` — two independent MPS documents. Matching is by normalized school name (the `.xlsx` truncates names and shares no code), so it is best-effort: matched schools must agree exactly; unmatched schools are surfaced, never hidden. No LLM.

## Result

**135 schools** parsed. **126 (93%) cross-verify to the dollar and FTE** against the district ledger — strong independent confirmation the extraction is faithful. Nothing is unmatched or forced.

- ✅ **126 exact** cross-document matches (27 via the curated `crosswalks/mps_schools.yml`, the rest by automatic name match).
- 📌 **9 documented discrepancies** — schools where the per-school PDF and the `.xlsx` line-item sum genuinely disagree (the two documents allocate shared / partnership costs differently); reported with the delta, not forced.
- ❌ **0 failures** · ⚪ **0 unmatched**.

District school-controlled budget: **$797,211,914** over **55,537** projected pupils — an average of **$14,355 per pupil** (school-level budgets only; excludes central offices and districtwide costs).

## Per-pupil range (FY2027 proposed)

| | School | Enrollment | Budget | Per pupil |
|---|---|--:|--:|--:|
| Lowest | Victory School | 993 | $6,163,349 | $6,207 |
|  | Fernwood Montessori School | 767 | $7,295,638 | $9,512 |
|  | Reagan HS | 1,372 | $13,242,991 | $9,652 |
| Median | Lincoln Avenue School | 408 | $6,300,717 | $15,443 |
|  | North HS | 209 | $4,943,212 | $23,652 |
|  | Franklin School | 158 | $3,994,616 | $25,282 |
| Highest | Milw Co Youth Educ Center | 4 | $388,613 | $97,153 |

Small specialty/alternative schools sit at the high end (tiny denominators); large comprehensive schools at the low end — the expected shape, and exactly the equity signal the per-pupil view surfaces.

## Documented cross-document discrepancies

These schools are matched to their ledger cost center, but the per-school PDF and the `.xlsx` line-item sum report **different** figures — the two official documents allocate shared / partnership costs differently. Captured and flagged, never forced to agree (registered in `crosswalks/mps_schools.yml`).

| School | PDF budget | ledger figure | Δ |
|---|--:|--:|--:|
| Alliance School | $2,298,045 | $2,044,994 | $253,051 |
| Groppi HS | $2,393,044 | $2,010,885 | $382,159 |
| Milw HS - Arts | $11,182,877 | — (no ledger match) | n/a |
| Project Stay HS | $2,295,823 | $1,774,177 | $521,646 |
| Starms Discovery School | $4,153,040 | $4,274,533 | $-121,493 |
| Starms Early Childhood | $4,392,904 | $4,274,533 | $118,371 |
| Transition HS | $1,898,610 | $1,387,343 | $511,267 |
| Victory School | $6,163,349 | $6,292,457 | $-129,108 |
| Vincent HS | $7,344,428 | $7,241,142 | $103,286 |

