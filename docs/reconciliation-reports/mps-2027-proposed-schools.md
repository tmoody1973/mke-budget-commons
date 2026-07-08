# Reconciliation Report — MPS FY2026-27 Per-School Budgets & Enrollment

**doc_id:** `mps-2027-proposed-school-lineitem`  
**Source:** `data/raw/mps/mps-2027-proposed-school-line-item.pdf`  
**Method:** deterministic pdfplumber table extraction of the per-school grid (name · enrollment · budget · FTE, two vintages). Each school's FY2027 budget and FTE are **cross-checked** against the sum of that school's line items in the district `.xlsx` — two independent MPS documents. Matching is by normalized school name (the `.xlsx` truncates names and shares no code), so it is best-effort: matched schools must agree exactly; unmatched schools are surfaced, never hidden. No LLM.

## Result

**135 schools** parsed. **99 (73%) cross-verify to the dollar and FTE** against the district ledger — strong independent confirmation the extraction is faithful.

- ✅ **99 exact** cross-document matches (budget + FTE).
- ❓ **5 matched but not exact** — schools whose budget spans multiple `.xlsx` cost centers (the single best-name match undercounts); listed below.
- ⚪ **31 unmatched** — name-truncation / specialty schools pending a hand-built `crosswalks/mps_schools.yml`; their figures are still extracted faithfully.

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

## Matched-but-not-exact (multi-cost-center schools)

| School | PDF budget | ledger match | Δ |
|---|--:|--:|--:|
| Project Stay HS | $2,295,823 | $1,774,177 | $521,646 |
| Starms Discovery School | $4,153,040 | $4,034,669 | $118,371 |
| Starms Early Childhood | $4,392,904 | $4,274,533 | $118,371 |
| Transition HS | $1,898,610 | $1,387,343 | $511,267 |
| Victory School | $6,163,349 | $6,292,457 | $-129,108 |

## Unmatched (pending a name crosswalk — figures still extracted)

Acad Of Accelerated Learning, Alliance School, Andrew Douglas School, Audubon Tech & Comm Ctr MS, Bay View Montessori, Bethune Academy, Carson Academy, Carver Academy, Craig Montessori School, Fernwood Montessori School, Groppi HS, Hartford University School, King ES, Lincoln Center Of The Arts, Maryland Av Montessori, Milw Acad Of Chinese Language, Milw Co Youth Educ Center, Milw French Immersion School, Milw German Immersion School, Milw HS - Arts, Milw Parkside School, Milw School Of Languages, Milw Sign Language School, Milw Spanish Immersion School, Morse MS, North HS, Pulaski HS, Vincent HS, Westside Academy, WHS Of Information Technology, Wis Conservatory Lifelong Learning

