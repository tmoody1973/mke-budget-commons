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
