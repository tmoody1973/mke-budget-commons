"""Rebuild the Neon serving layer entirely from repo Parquet — idempotent.

The repo Parquet/CSV is the source of truth; Neon is disposable. This loader
drops and recreates the schema, loads the canonical facts, derives the
department dimension, and materializes the reconciliation results so the MCP
server can serve a trust report. Never hand-edit Neon — edit the pipeline and
re-run `make load-neon`.

Connection via DATABASE_URL (owner role). Also (re)creates a SELECT-only role
`mcp_ro` for the MCP server and writes MCP_DATABASE_URL back to .env.
"""
from __future__ import annotations

import os
import secrets
from pathlib import Path
from urllib.parse import urlparse, urlunparse

import pandas as pd
import psycopg
import yaml
from dotenv import load_dotenv

from parsers.city_detailed import ADOPTED_LAYOUT, REQUESTED_LAYOUT, parse_book, slugify
from parsers.reconcile_city import ALL_VINTAGES, REQUESTED_VINTAGES, reconcile_unit

ROOT = Path(__file__).resolve().parent.parent
SCHEMA_SQL = ROOT / "db" / "schema.sql"
SOURCES_YML = ROOT / "data" / "raw" / "sources.yml"
ENV_PATH = ROOT / ".env"

# Every parsed doc: canonical Parquet + how to reconcile it. Add a row per new doc.
DOCS = [
    {"parquet": ROOT / "data/canonical/city/2026/adopted/city-detailed-book.parquet",
     "layout": ADOPTED_LAYOUT, "vintages": ALL_VINTAGES},
    {"parquet": ROOT / "data/canonical/city/2027/requested/city-requested-book.parquet",
     "layout": REQUESTED_LAYOUT, "vintages": REQUESTED_VINTAGES},
]

DATA_TABLES = [
    "reconciliation_result", "fact_amendment", "fact_budget_line",
    "dept_alias", "dim_department", "dim_document", "dim_government",
]

STATUS_MAP = {
    "PASS": "pass",
    "FAIL": "open",
    "SOURCE_INCONSISTENCY": "source_inconsistency",
    "NOT_RECONCILABLE": "not_reconcilable",
}


def dept_id_for(gov_id: str, printed: str) -> str:
    return f"{gov_id}-{slugify(printed)}"


def _clean(v):
    """pandas NaN / NaT -> None; leave everything else."""
    if v is None:
        return None
    if isinstance(v, float) and pd.isna(v):
        return None
    return v


# --------------------------------------------------------------------------- #
def rebuild_schema(cur) -> None:
    for t in DATA_TABLES:
        cur.execute(f"DROP TABLE IF EXISTS {t} CASCADE")
    cur.execute(SCHEMA_SQL.read_text())


def load_governments(cur) -> None:
    cur.executemany(
        "INSERT INTO dim_government (gov_id, name) VALUES (%s, %s)",
        [("city", "City of Milwaukee"), ("county", "Milwaukee County")],
    )


def load_documents(cur) -> None:
    docs = yaml.safe_load(SOURCES_YML.read_text())["documents"]
    rows = [
        (d["doc_id"], d["gov"], d["fiscal_year"], d["doc_type"], d["doc_family"],
         d.get("source_url"), None if d.get("sha256") in (None, "TODO") else d["sha256"],
         d.get("retrieved_on"))
        for d in docs
    ]
    cur.executemany(
        """INSERT INTO dim_document
           (doc_id, gov_id, fiscal_year, doc_type, doc_family, source_url, sha256, retrieved_on)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
        rows,
    )


def load_departments(cur, df: pd.DataFrame) -> None:
    seen = {}
    for gov_id, printed in df[["gov_id", "department_printed"]].drop_duplicates().itertuples(index=False):
        seen[dept_id_for(gov_id, printed)] = (gov_id, printed)
    cur.executemany(
        "INSERT INTO dim_department (dept_id, gov_id, canonical_name) VALUES (%s,%s,%s)",
        [(did, gov, name) for did, (gov, name) in seen.items()],
    )
    aliases = {
        (dept_id_for(g, p), int(fy), p)
        for g, p, fy in df[["gov_id", "department_printed", "fiscal_year"]].drop_duplicates().itertuples(index=False)
    }
    cur.executemany(
        "INSERT INTO dept_alias (dept_id, fiscal_year, printed_name) VALUES (%s,%s,%s)",
        sorted(aliases),
    )


def load_facts(cur, df: pd.DataFrame) -> int:
    cols = ["doc_id", "division", "fund", "org", "sbcl", "account", "line_description",
            "line_kind", "pay_range", "amount", "amount_kind", "units", "flags", "source_page"]
    rows = []
    for r in df.itertuples(index=False):
        d = r._asdict()
        flags = d["flags"]
        flags = list(flags) if isinstance(flags, (list, tuple)) or hasattr(flags, "__len__") and not isinstance(flags, str) else []
        rows.append((
            d["doc_id"], dept_id_for(d["gov_id"], d["department_printed"]),
            _clean(d["division"]), _clean(d["fund"]), _clean(d["org"]), _clean(d["sbcl"]),
            _clean(d["account"]), d["line_description"], d["line_kind"], _clean(d["pay_range"]),
            _clean(d["amount"]), d["amount_kind"], int(d["fiscal_year"]), _clean(d["units"]),
            [str(f) for f in flags], int(d["source_page"]),
        ))
    cur.executemany(
        """INSERT INTO fact_budget_line
           (doc_id, dept_id, division, fund, org, sbcl, account, line_description,
            line_kind, pay_range, amount, amount_kind, fiscal_year, units, flags, source_page)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        rows,
    )
    return len(rows)


def load_reconciliation(cur) -> int:
    rows, seen = [], set()
    for doc in DOCS:
        lay = doc["layout"]
        lo, hi = lay.book_pages
        units = parse_book(lay.default_pdf, lo, hi, lay)
        for u in units:
            for c in reconcile_unit(u, doc["vintages"]):
                scope = f"pp{u.page_start}-{u.page_end} | {u.label} | {c.name} | {c.vintage}"
                key = (lay.doc_id, scope)
                if key in seen:
                    continue
                seen.add(key)
                rows.append((lay.doc_id, scope, _clean(c.actual), _clean(c.expected),
                             STATUS_MAP.get(c.status, "open"), c.disposition or None))
    cur.executemany(
        """INSERT INTO reconciliation_result
           (doc_id, scope, extracted_total, printed_total, status, notes)
           VALUES (%s,%s,%s,%s,%s,%s)""",
        rows,
    )
    return len(rows)


def ensure_readonly_role(cur, owner_url: str) -> str:
    """(Re)create SELECT-only role mcp_ro; return its connection URL (stable password)."""
    load_dotenv(ENV_PATH)
    existing = os.environ.get("MCP_DATABASE_URL")
    if existing:
        pw = urlparse(existing).password
    else:
        pw = secrets.token_urlsafe(24)
    cur.execute(
        """DO $$ BEGIN
             IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='mcp_ro') THEN
               CREATE ROLE mcp_ro LOGIN;
             END IF;
           END $$;"""
    )
    cur.execute(f"ALTER ROLE mcp_ro LOGIN PASSWORD '{pw}'")
    cur.execute("GRANT USAGE ON SCHEMA public TO mcp_ro")
    cur.execute("GRANT SELECT ON ALL TABLES IN SCHEMA public TO mcp_ro")
    cur.execute("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO mcp_ro")
    p = urlparse(owner_url)
    ro = p._replace(netloc=f"mcp_ro:{pw}@{p.hostname}")
    return urlunparse(ro)


def _write_env_var(key: str, value: str) -> None:
    lines = ENV_PATH.read_text().splitlines() if ENV_PATH.exists() else []
    lines = [ln for ln in lines if not ln.startswith(f"{key}=")]
    lines.append(f"{key}={value}")
    ENV_PATH.write_text("\n".join(lines) + "\n")


def main() -> None:
    load_dotenv(ENV_PATH)
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL not set (see .env)")
    df = pd.concat([pd.read_parquet(d["parquet"]) for d in DOCS], ignore_index=True)

    with psycopg.connect(url, autocommit=False) as conn:
        with conn.cursor() as cur:
            rebuild_schema(cur)
            load_governments(cur)
            load_documents(cur)
            load_departments(cur, df)
            n_facts = load_facts(cur, df)
            n_recon = load_reconciliation(cur)
            ro_url = ensure_readonly_role(cur, url)
        conn.commit()

    _write_env_var("MCP_DATABASE_URL", ro_url)
    print("Neon rebuilt from repo Parquet:")
    print(f"  docs: {', '.join(sorted(df['doc_id'].unique()))}")
    print(f"  {df['department_printed'].nunique()} departments · {n_facts} budget lines · "
          f"{n_recon} reconciliation checks")
    print("  read-only role mcp_ro ready · MCP_DATABASE_URL written to .env")


if __name__ == "__main__":
    main()
