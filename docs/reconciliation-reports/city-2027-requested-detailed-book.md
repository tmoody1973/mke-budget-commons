# Reconciliation Report — City of Milwaukee 2027 Requested Budget

**doc_id:** `city-2027-requested-detailed`  
**Source:** `data/raw/city/2027-Budget-Requests---City-of-Milwaukee.pdf` (463 pp.)  
**Method:** the same deterministic pipeline as the Adopted book, driven by a landscape 4-vintage `Layout` (2025 actual / 2026 budget / 2027 requested / proposed). The PROPOSED column is blank in this edition. No LLM reads the numbers.

## Result

Departmental ledger pp. 1–311 · **59 units** · 6879 canonical lines.

- 🟢 **48 fully reconciled**
- 🟡 **1 money-reconciled** (headcount/subtotal only)
- 📌 **0 carry a documented source-document error**
- ❌ **10 open findings** (all small — max ~$6K; several are $1 source-document roundings and one, Employee Relations operating −$973, is the **same error that appears in the Adopted book's 2026 column** — a persistent source-document arithmetic error, not a parser defect).

**Dollars reconcile for 49/59 units (83%)** on the first pass with no requested-specific parser code — only the layout config.

## Open findings (follow-up)

| Pages | Unit | Failed check | Vintage | Printed | Extracted | Δ |
|---|---|---|---|--:|--:|--:|
| 62–66 | City Treasurer Budgetary Control Uni | operating items == 006300 | actual | 633,642 | 636,702 | 3,060 |
| 62–66 | City Treasurer Budgetary Control Uni | operating items == 006300 | budget | 695,589 | 701,379 | 5,790 |
| 84–89 | Comptroller Budgetary Control Unit ( | 006000+006100+006300+006800+special == unit total | actual | 5,868,580 | 5,868,581 | 1 |
| 100–101 | Department Of Employee Relations Sum | 006000+006100+006300+006800+special == unit total | actual | 6,175,236 | 6,175,505 | 269 |
| 100–101 | Department Of Employee Relations Sum | operating items == 006300 | budget | 618,260 | 617,287 | -973 |
| 106–109 | Department Of Employee Relations Emp | 006000+006100+006300+006800+special == unit total | actual | 1,690,686 | 1,690,955 | 269 |
| 110–114 | Department Of Employee Relations Ope | equipment subtotals == 006800 | requested | 500 | 250 | -250 |
| 174–175 | Library Budgetary Control Unit (Summ | operating items == 006300 | actual | 3,750,133 | 3,750,134 | 1 |
| 184–188 | Library Operations Decision Unit | operating items == 006300 | actual | 3,070,408 | 3,070,409 | 1 |
| 184–188 | Library Operations Decision Unit | 006000+006100+006300+006800+special == unit total | actual | 7,228,925 | 7,228,926 | 1 |
| 189–193 | Library | operating items == 006300 | actual | 468,971 | 468,972 | 1 |
| 222–246 | Police Department (1Bcu = 1Du) | position$ + adjustments == NET SALARIES (006000) | requested | 214,768,305 | 214,770,332 | 2,026 |
| 302–306 | Dpw-Operations Division Sanitation S | operating items == 006300 | actual | 1,952,353 | 1,952,352 | -1 |
