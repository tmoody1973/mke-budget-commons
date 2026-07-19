"""Convert raw USAspending grant extracts into canonical per-year Parquet.

Deterministic, no LLM. Mechanical raw->columnar step: it does NOT map to the
budget fact schema (grants are their own series — see docs/FEDERAL-GRANTS-DESIGN.md).

Re-verifies each year against its live anchor before writing, so a Parquet file
can never exist for a year that doesn't reconcile.

    python -m scripts.grants_to_parquet

Reads  data/raw/federal/grants/federal-grants-mke-<fy>.csv    (gitignored)
Writes data/canonical/federal/<fy>/grants/mke-grants.parquet  (committed)
"""

import csv
import sys
from decimal import Decimal
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts.fetch_grants import category_anchor  # noqa: E402  same anchor, one definition

RAW = Path("data/raw/federal/grants")
CANON = Path("data/canonical/federal")

# Amounts kept as strings through reconciliation, converted only after it passes.
MONEY = ["federal_action_obligation", "award_total_obligated", "award_total_outlayed"]
TEXT = ["award_key", "award_id", "mod", "recipient_name", "recipient_uei",
        "awarding_agency", "awarding_sub_agency", "award_type",
        "cfda_number", "cfda_title", "description"]


def convert(fy: int) -> dict:
    src = RAW / f"federal-grants-mke-{fy}.csv"
    if not src.exists():
        return {"fy": fy, "ok": False, "note": f"missing {src} — run `make fetch-grants`"}

    rows = list(csv.DictReader(src.open()))
    got = sum((Decimal(r["federal_action_obligation"] or "0") for r in rows), Decimal(0))
    anchor = category_anchor(fy)
    delta = got - anchor
    if delta != 0:
        return {"fy": fy, "ok": False, "rows": len(rows), "sum": got, "delta": delta,
                "note": f"RECONCILIATION FAILED (delta ${delta:,.2f}) — not written"}

    df = pd.DataFrame(rows)
    for c in MONEY:
        df[c] = pd.to_numeric(df[c].replace("", "0"), errors="raise")
    df["action_date"] = pd.to_datetime(df["action_date"], format="%Y-%m-%d", errors="raise")
    for c in TEXT:
        df[c] = df[c].fillna("").astype("string")
    df["fiscal_year"] = fy
    df["source_row"] = range(2, len(df) + 2)   # 1-based row in the extract (header = 1)

    out = CANON / str(fy) / "grants" / "mke-grants.parquet"
    out.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out, compression="zstd", index=False)

    return {"fy": fy, "ok": True, "rows": len(df), "sum": got, "delta": delta,
            "negatives": int((df["federal_action_obligation"] < 0).sum()),
            "recipients": df["recipient_name"].nunique(),
            "mb": out.stat().st_size / 1e6, "file": out}


def main() -> None:
    years = [int(a) for a in sys.argv[1:]] or \
        sorted(int(p.stem.split("-")[-1]) for p in RAW.glob("federal-grants-mke-*.csv"))
    if not years:
        sys.exit("No raw extracts found — run `make fetch-grants` first.")

    results = [convert(fy) for fy in years]
    print(f"{'FY':<7}{'txns':>8}{'obligations':>20}{'delta':>9}{'recips':>8}{'neg':>6}{'MB':>7}  verdict")
    for r in results:
        if not r["ok"]:
            print(f"{r['fy']:<7}  {r.get('note')}")
            continue
        print(f"{r['fy']:<7}{r['rows']:>8,}{r['sum']:>20,.2f}{r['delta']:>9.2f}"
              f"{r['recipients']:>8,}{r['negatives']:>6}{r['mb']:>7.2f}  PASS")

    good = [r for r in results if r["ok"]]
    if good:
        print(f"{'-'*66}\n{'TOTAL':<7}{sum(r['rows'] for r in good):>8,}"
              f"{sum(r['sum'] for r in good):>20,.2f}{'':>9}{'':>8}"
              f"{sum(r['negatives'] for r in good):>6}{sum(r['mb'] for r in good):>7.2f}")
    all_ok = all(r["ok"] for r in results)
    print(f"\nverdict: {'ALL PASS' if all_ok else 'FAILURES — nothing shipped for failing years'}")
    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
