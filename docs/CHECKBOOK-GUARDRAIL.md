# Checkbook guardrail

**Status:** ✅ implemented (2026-07-18). All five decisions resolved as recommended.
Verified by `mcp/test/smoke_payments.mjs` (24 checks) — run via `make mcp-test`.

## The failure this prevents

Vendor payments (`fact_vendor_payment`) and budget appropriations (`fact_budget_line`)
both carry a department and a dollar amount. Nothing structural stops an agent from
joining them and emitting:

> "The City Attorney's office spent only 78% of its budget."

That sentence is false, and it is the *good* case — it's plausible enough to publish.
Measured against real data (checkbook 2025 vs. city 2026 adopted, exact-name join):

| Department | Naive "spent vs budget" | Reality |
|---|---:|---|
| City Attorney | 78.2% | plausible, quotable, **wrong** |
| Common Council-City Clerk | 10.2% | plausible, quotable, **wrong** |
| City Treasurer | 1,534.0% | self-evidently broken |
| Comptroller | 1,443.8% | self-evidently broken |

Absurd outputs are harmless; nobody publishes 1534%. The guardrail exists for the 78%.

## Why the comparison is invalid

1. **Different granularity.** Checkbook has 70 spending units (divisions); the city
   budget has 25 departments. Only **9 of 70 names match exactly** — so a naive join
   silently returns 9 departments and drops 61, while looking complete. Even those 9
   compare a *division's* payments against a *whole department's* appropriation.
2. **Different scope.** Checkbook excludes direct salaries and wages (city payroll is
   not a vendor payment) — typically the majority of a department's budget. Only 62 of
   91,848 rows in 2025 matched salary/wage terms, and all were pension remittances.
3. **Different content.** Checkbook *includes* items that aren't departmental operating
   spend: Pension ($191M), Health Insurance ($152M), Principal Retirement ($124M),
   Interest ($51M). These land on Treasurer/Comptroller and explain the >1000% results.
4. **Different basis.** Cash-basis by date paid vs. appropriation-basis by fiscal year.
5. **Excludes interdepartmental charges**, which are real budget lines.

**Conclusion: there is no valid department-level "budget vs. actual" from these two
sources.** The guardrail is not a warning label on a hard comparison — it is a refusal
of a comparison that cannot be made correctly at all.

## Design principle

Prohibition alone fails: the agent still wants to answer the user's question, and an
unanswered question invites improvisation. Every guardrail below pairs a **refusal**
with a **correct alternative**.

---

## Layer 1 — Separate, deliberately non-joinable dimensions

The strongest move is structural: never give the two fact tables a shared key.

```sql
-- Payment-side spending units. NOT dim_department, NOT joinable to it.
CREATE TABLE dim_spending_unit (
  unit_id    TEXT PRIMARY KEY,   -- checkbook's own 'Spending Department ID' (1654, 3310)
  unit_name  TEXT NOT NULL,      -- 'DER-Employee Benefits Division'
  gov_id     TEXT REFERENCES dim_government
);

CREATE TABLE fact_vendor_payment (
  payment_id   BIGSERIAL PRIMARY KEY,
  doc_id       TEXT REFERENCES dim_document,     -- city-checkbook-<fy>
  unit_id      TEXT REFERENCES dim_spending_unit, -- NOT dept_id
  voucher_id   TEXT NOT NULL,
  paid_on      DATE NOT NULL,
  vendor_name  TEXT NOT NULL,
  account_description TEXT,
  fund_code    TEXT,
  fund_name    TEXT,
  amount_paid  NUMERIC(14,2) NOT NULL,           -- NOT 'amount'
  amount_basis TEXT NOT NULL DEFAULT 'cash_disbursement',
  source_row   INT NOT NULL,                      -- provenance: row in the hashed CSV
  search       TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', vendor_name)) STORED
);
```

Deliberate choices:

- **`unit_id`, not `dept_id`.** No foreign key to `dim_department` exists, so the
  join an agent would reach for has no key to travel on.
- **`amount_paid`, not `amount`.** A SQL author writing
  `SUM(amount_paid) / SUM(amount)` sees the mismatch in the identifiers.
- **`paid_on`, not `date`/`fiscal_year`.** Names the cash basis at the column level.
- **`amount_basis` on every row**, mirroring how `amount_kind` already disambiguates
  vintages in `fact_budget_line`.

✅ **Decided: yes.** The cost: no
"budget and payments for department X" in one query, ever, without an explicit
opt-in crosswalk (below). That cost is the feature.

## Layer 2 — An explicit, opt-in crosswalk (deferred)

Some legitimate questions do need to relate the two ("which budget department does
DER-Employee Benefits Division roll up to?"). That mapping should exist, but as a
separate artifact a query must knowingly reach for — never an implicit join path.

```
crosswalks/checkbook_unit_to_dept.yml   # unit_id -> dept_id, hand-verified, with coverage notes
```

It must record **which units have no budget-department equivalent** (e.g. "City Wide")
rather than silently omitting them — the same discipline as `NOT_RECONCILABLE`.

✅ **Decided: defer.** Not built. Building it now creates the join path before the tools
that would use it safely exist.

## Layer 3 — Tool surface

**New tools** (checkbook only; never return a budget figure):

| Tool | Answers |
|---|---|
| `search_vendor_payments` | Payments by vendor / unit / account / date range, cited |
| `get_top_vendors` | Largest vendors by net paid, for a unit or citywide |
| `vendor_payment_summary` | A unit's payments by account category or by year |

Every response carries a machine-readable basis block, not prose buried in a description:

```json
{
  "results": [...],
  "basis": {
    "amount_basis": "cash_disbursement",
    "excludes": ["direct salaries and wages", "interdepartmental charges"],
    "includes_non_operating": ["pension remittances", "debt principal", "interest"],
    "comparable_to_budget": false,
    "note": "Vendor disbursements. NOT actuals-against-budget; see docs/CHECKBOOK-GUARDRAIL.md"
  },
  "citation": {"doc_id": "city-checkbook-2025", "source_row": 40122, "sha256": "..."}
}
```

`comparable_to_budget: false` on every single response is the key field — a model has to
actively override an explicit machine-readable flag, not merely fail to infer a caveat.

**Negatives:** `get_top_vendors` nets refunds by default (a "top vendor" means net dollars
received) and exposes `gross_paid` / `refunds` / `net_paid` separately. 11,320 negative
rows exist; netting is a query-time choice, never applied at ingest.

## Layer 4 — The refusal tool

The positive counterpart to the prohibition. When asked "did department X spend its
budget?", the agent needs somewhere correct to land:

```
compare_budget_to_payments(gov, department, fiscal_year)
  -> { "comparable": false,
       "reason": "...granularity, scope, basis...",
       "what_you_can_ask_instead": [
          "top vendors for this unit",
          "payments by account category",
          "year-over-year payment trend"
       ],
       "budget_execution_available": false }
```

It always returns `comparable: false` — that is its entire purpose. It exists so the
question has a correct destination instead of an improvised join.

✅ **Decided: yes** — `compare_budget_to_payments` ships and always refuses — an unanswered
question is where agents invent things.

## Layer 5 — The `run_sql` hole

`run_sql` gives read-only SQL over the whole store, so **any structural guardrail can be
bypassed by a sufficiently determined query.** This is unavoidable without removing the
tool. Mitigations, weakest to strongest:

1. Self-documenting identifiers (Layer 1) — the warning lives in the column names.
2. A `COMMENT ON TABLE fact_vendor_payment` stating non-comparability, surfaced by
   any schema introspection the agent does.
3. ✅ A guard in the SQL validator that flags a query joining `fact_vendor_payment` to
   `fact_budget_line` and returns a warning alongside results — or refuses outright.

✅ **Decided: warn, don't refuse.** `run_sql` returns a `warning` field on any query touching both fact tables — `run_sql` is an expert tool,
and its existing read-only guard already establishes the pattern of constrained-but-open.

## Layer 6 — Documentation & UI

- `CLAUDE.md`: add checkbook to the epistemics section — a **third category** alongside
  reconciled facts and WPF context: *authoritative, reconciled, but not budget-comparable.*
- `README.md`: already carries the callout under Coverage.
- L4 app: vendor spending shown in its own view, never as a column beside budget figures.

---

## Open decisions

| # | Decision | Resolution | Where |
|---|---|---|---|
| 1 | Two non-joinable department dimensions? | ✅ Yes | `db/schema.sql` |
| 2 | Build the unit→dept crosswalk now? | ✅ Deferred — not built | — |
| 3 | Ship a tool whose only job is refusing? | ✅ Yes | `compare_budget_to_payments` |
| 4 | `run_sql`: warn or refuse on cross-joins? | ✅ Warn | `db.ts` `CROSS_BASIS_WARNING` |
| 5 | Net negatives in `get_top_vendors`? | ✅ Netted, gross/refunds exposed | `payments.ts` |

## Verification

`make mcp-test` runs `mcp/test/smoke_payments.mjs` — 24 checks over the real MCP
protocol: data reconciles to $4,937,976,866.16 / 404,120 rows, every tool carries
`comparable_to_budget: false`, the refusal tool refuses, `run_sql` warns on a
cross-basis join and stays silent otherwise, and `fact_vendor_payment` has no
`dept_id` / `amount` / `fiscal_year` column.

> A note on that last group: an earlier version of these checks queried
> `information_schema`, which `run_sql`'s CATALOG guard blocks. The query errored,
> the column list came back empty, and `!columns.includes("dept_id")` passed
> against an empty array — a test that verified nothing while reporting success.
> The checks now probe each column directly. **Absence of rows is not absence of a
> column.**
