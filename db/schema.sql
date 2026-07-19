-- MKE Budget Commons — Neon Postgres serving schema.
-- The repo Parquet is the source of truth; this DB is disposable and rebuilt
-- by db/load.py. Read-only role for the MCP server; never hand-edit.

CREATE TABLE IF NOT EXISTS dim_government (
  gov_id  TEXT PRIMARY KEY,           -- 'city' | 'county'
  name    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dim_department (
  dept_id        TEXT PRIMARY KEY,     -- stable slug, e.g. 'city-fire'
  gov_id         TEXT REFERENCES dim_government,
  canonical_name TEXT NOT NULL,
  org_code       TEXT                  -- county agency number where applicable
);

CREATE TABLE IF NOT EXISTS dept_alias (   -- crosswalk: printed names per year
  dept_id      TEXT REFERENCES dim_department,
  fiscal_year  INT,
  printed_name TEXT,
  PRIMARY KEY (dept_id, fiscal_year, printed_name)
);

CREATE TABLE IF NOT EXISTS dim_document (
  doc_id       TEXT PRIMARY KEY,        -- 'city-2026-adopted-detailed'
  gov_id       TEXT REFERENCES dim_government,
  fiscal_year  INT NOT NULL,
  doc_type     TEXT NOT NULL,           -- requested|proposed|recommended|adopted
  doc_family   TEXT NOT NULL,           -- detailed|summary|operating|capital|amendments
  source_url   TEXT,
  sha256       TEXT,
  retrieved_on DATE
);

CREATE TABLE IF NOT EXISTS fact_budget_line (
  line_id          BIGSERIAL PRIMARY KEY,
  doc_id           TEXT REFERENCES dim_document,
  dept_id          TEXT REFERENCES dim_department,
  division         TEXT,
  fund             TEXT,
  org              TEXT,
  sbcl             TEXT,
  account          TEXT,
  line_description TEXT NOT NULL,
  line_kind        TEXT NOT NULL,       -- position|expenditure|category|program|subtotal|total|fte
  pay_range        TEXT,
  amount           NUMERIC(14,2),
  amount_kind      TEXT NOT NULL DEFAULT 'adopted',  -- actual|budget|requested|proposed|adopted|recommended
  fiscal_year      INT,                 -- the vintage's fiscal year (varies by amount_kind within a doc)
  units            NUMERIC(8,2),        -- FTE / position count
  flags            TEXT[],              -- footnote codes as printed
  source_page      INT NOT NULL,        -- provenance, non-negotiable
  search           TSVECTOR GENERATED ALWAYS AS
                   (to_tsvector('english', line_description)) STORED
);
CREATE INDEX IF NOT EXISTS idx_fbl_dept_doc ON fact_budget_line (dept_id, doc_id);
CREATE INDEX IF NOT EXISTS idx_fbl_search   ON fact_budget_line USING GIN (search);

CREATE TABLE IF NOT EXISTS fact_amendment (
  amend_id     BIGSERIAL PRIMARY KEY,
  gov_id       TEXT REFERENCES dim_government,
  fiscal_year  INT,
  number       TEXT,
  sponsor      TEXT,
  description  TEXT,
  dept_id      TEXT REFERENCES dim_department,
  amount_delta NUMERIC(14,2),
  disposition  TEXT,                    -- adopted|failed|withdrawn
  source_doc   TEXT,
  source_page  INT
);

CREATE TABLE IF NOT EXISTS reconciliation_result (
  doc_id          TEXT REFERENCES dim_document,
  scope           TEXT,                 -- section/division checked
  extracted_total NUMERIC(14,2),
  printed_total   NUMERIC(14,2),
  status          TEXT,                 -- pass|parser_bug|source_inconsistency|not_reconcilable|open
  notes           TEXT,
  PRIMARY KEY (doc_id, scope)
);

-- Layer-2 CONTEXT corpus (Wisconsin Policy Forum wisdom) lives in `context_chunk`.
-- It is NOT part of this fact schema and is owned end-to-end by db/load-context.ts
-- (a TS step that also generates the pgvector embeddings). db/load.py never drops
-- or touches it — facts=Python, context=TS. The DDL, for reference:
--
--   CREATE EXTENSION IF NOT EXISTS vector;
--   CREATE TABLE context_chunk (
--     chunk_id TEXT PRIMARY KEY, source TEXT DEFAULT 'wpf',
--     brief_id TEXT, brief_title TEXT, gov TEXT, year INT, page INT NOT NULL,
--     section TEXT, text TEXT NOT NULL, source_url TEXT,
--     embedding vector(384),
--     search TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', text)) STORED);
--   CREATE INDEX ON context_chunk USING hnsw (embedding vector_cosine_ops);
--
-- WPF = attributed wisdom, never a fact source; context_chunk is prose, never reconciled.

-- ===========================================================================
-- VENDOR PAYMENTS (City Open Checkbook) — cash disbursements, NOT budget.
--
-- Deliberately NOT joinable to fact_budget_line. There is no dept_id here and
-- no FK to dim_department, because there is no valid department-level
-- "budget vs actual" between these two sources:
--   * granularity: 70 spending units here vs 25 budget departments (9 names
--     match exactly — a naive join silently returns 9 and drops 61)
--   * scope: excludes direct salaries/wages (most of any department's budget)
--   * content: includes pension, debt principal, interest — not operating spend
--   * basis: cash (date paid) vs appropriation (fiscal year)
-- Measured: that join yields "City Attorney spent 78.2% of budget" — plausible,
-- quotable, and false. See docs/CHECKBOOK-GUARDRAIL.md.
--
-- Column names carry the warning into raw SQL: amount_paid (not amount),
-- paid_on (not fiscal_year), unit_id (not dept_id). Relating the two requires
-- the explicit crosswalk in crosswalks/, never an implicit join path.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS dim_spending_unit (
  unit_id   TEXT PRIMARY KEY,        -- checkbook's own 'Spending Department ID' (1654)
  gov_id    TEXT REFERENCES dim_government,
  unit_name TEXT NOT NULL            -- 'DER-Employee Benefits Division'
);

CREATE TABLE IF NOT EXISTS fact_vendor_payment (
  payment_id   BIGSERIAL PRIMARY KEY,
  doc_id       TEXT REFERENCES dim_document,       -- 'city-checkbook-2025'
  unit_id      TEXT REFERENCES dim_spending_unit,  -- NOT dept_id, by design
  voucher_id   TEXT NOT NULL,                      -- repeats: one voucher, many lines
  paid_on      DATE NOT NULL,                      -- cash basis
  vendor_name  TEXT NOT NULL,
  account_description TEXT,
  fund_code    TEXT,                               -- zero-padded, text ('0001')
  fund_name    TEXT,
  amount_paid  NUMERIC(14,2) NOT NULL,             -- negatives = refunds/reversals
  amount_basis TEXT NOT NULL DEFAULT 'cash_disbursement',
  source_row   INT NOT NULL,                       -- 1-based row in the sha256-pinned CSV
  search       TSVECTOR GENERATED ALWAYS AS
               (to_tsvector('english', vendor_name)) STORED
);
CREATE INDEX IF NOT EXISTS idx_fvp_unit   ON fact_vendor_payment (unit_id, paid_on);
CREATE INDEX IF NOT EXISTS idx_fvp_vendor ON fact_vendor_payment USING GIN (search);
CREATE INDEX IF NOT EXISTS idx_fvp_doc    ON fact_vendor_payment (doc_id);

COMMENT ON TABLE fact_vendor_payment IS
  'Cash vendor disbursements (City Open Checkbook). NOT comparable to fact_budget_line: '
  'different granularity, scope (excludes salaries), content (includes debt/pension) and '
  'basis (cash vs appropriation). Do not join to fact_budget_line. See docs/CHECKBOOK-GUARDRAIL.md.';

-- ===========================================================================
-- FEDERAL GRANTS (USAspending) — awards to Milwaukee County recipients.
--
-- A third series, separate from both the budget ledger and vendor payments.
-- No key to dim_department: most recipients are nonprofits and universities,
-- not city departments, and the few that are governments are NOT comparable to
-- their budget revenue lines (federal fiscal year vs city calendar year;
-- obligations vs receipts; grants only vs all federal money).
--
-- `obligated` is the per-transaction number and the only one that may be summed.
-- The award_lifetime_* columns repeat the whole award's value on EVERY
-- transaction row — summing them across rows overstates FY2024 by 10.7x
-- ($7.1B against a true $666M). The column names carry that warning into SQL.
-- See docs/FEDERAL-GRANTS-DESIGN.md.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS fact_federal_grant (
  grant_txn_id  BIGSERIAL PRIMARY KEY,
  fiscal_year   INT  NOT NULL,        -- FEDERAL fiscal year (Oct 1 – Sep 30)
  award_key     TEXT NOT NULL,        -- assistance_award_unique_key (stable)
  award_id      TEXT,
  mod           TEXT,                 -- modification number
  action_date   DATE NOT NULL,
  obligated     NUMERIC(14,2) NOT NULL,   -- federal_action_obligation; SUM this one
  award_lifetime_obligated NUMERIC(16,2), -- award total, repeated per row — NEVER SUM
  award_lifetime_outlayed  NUMERIC(16,2), -- award total, repeated per row — NEVER SUM
  recipient_name     TEXT NOT NULL,
  recipient_uei      TEXT,
  awarding_agency    TEXT,
  awarding_sub_agency TEXT,
  award_type    TEXT,
  cfda_number   TEXT,
  cfda_title    TEXT,                 -- the federal program name
  description   TEXT,
  source_row    INT  NOT NULL,        -- 1-based row in the verified extract
  search        TSVECTOR GENERATED ALWAYS AS
                (to_tsvector('english', recipient_name || ' ' || coalesce(cfda_title,''))) STORED
);
CREATE INDEX IF NOT EXISTS idx_ffg_year      ON fact_federal_grant (fiscal_year);
CREATE INDEX IF NOT EXISTS idx_ffg_recipient ON fact_federal_grant (recipient_name);
CREATE INDEX IF NOT EXISTS idx_ffg_search    ON fact_federal_grant USING GIN (search);

COMMENT ON TABLE fact_federal_grant IS
  'Federal grant obligations to Milwaukee County recipients (USAspending). SUM the '
  '`obligated` column only. award_lifetime_obligated / award_lifetime_outlayed repeat '
  'the whole award value on every transaction row — summing them across rows overstates '
  'totals by ~10x. Federal fiscal year, not city fiscal year. Not comparable to budget '
  'revenue lines. See docs/FEDERAL-GRANTS-DESIGN.md.';

-- Per-school budget + enrollment (MPS), kept separate from the budget ledger so
-- name-keyed school metrics don't collide with the code-keyed departments.
CREATE TABLE IF NOT EXISTS fact_school (
  doc_id      TEXT REFERENCES dim_document,
  school_name TEXT NOT NULL,
  fiscal_year INT  NOT NULL,
  enrollment  NUMERIC(10,2),
  budget      NUMERIC(14,2),
  fte         NUMERIC(10,2),
  per_pupil   NUMERIC(12,2),
  source_page INT  NOT NULL,
  PRIMARY KEY (doc_id, school_name, fiscal_year)
);
