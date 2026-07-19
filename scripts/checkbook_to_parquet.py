"""Convert raw Open Checkbook CSVs into canonical per-year Parquet.

Deterministic, no LLM. Mechanical raw->columnar step only: it does NOT map to
the canonical fact schema or crosswalk departments — that belongs in
parsers/city_checkbook.py once the fact/actuals separation is settled.

Verifies every year against its published total (docs/OPEN-CHECKBOOK-API.md)
before writing, and refuses to emit a file that doesn't reconcile.

    python -m scripts.checkbook_to_parquet

Reads  data/raw/city/checkbook/city-open-checkbook-<fy>.csv   (gitignored, regenerable)
Writes data/canonical/city/<fy>/actual/city-checkbook.parquet (committed)
"""

import sys
from decimal import Decimal
from pathlib import Path

import pandas as pd

RAW = Path("data/raw/city/checkbook")
CANON = Path("data/canonical/city")

# Published count + total per fiscal year, from the portal's own /total endpoint.
# These are the reconciliation anchors — the checkbook equivalent of a printed
# total in a budget PDF.
#
# Totals are Decimal, not float, and the gate below demands EXACT equality.
# With float64 a genuine one-cent miss can compute as 0.009999990463256836,
# which slips past `abs(delta) < 0.01` — a reconciliation gate that silently
# accepts a real failure is worse than no gate.
ANCHORS = {
    2022: (94_203, Decimal("945047260.77")),
    2023: (92_043, Decimal("981221393.92")),
    2024: (91_218, Decimal("1137479102.02")),
    2025: (91_848, Decimal("1186269947.32")),
    2026: (34_808, Decimal("687959162.13")),
}

# quasi_id is a content hash, not a row key (see docs/OPEN-CHECKBOOK-API.md).
# It costs ~13MB of the 18.5MB Parquet and serves no purpose downstream —
# provenance is voucher id + the raw file's sha256, recorded in sources.yml.
# Kept in the raw CSV so the choice is reversible without re-fetching.
DROP = ["quasi_id"]

# Read as text, convert deliberately. Zero-padded codes (fund "0001",
# department "0000", voucher "02311251") become wrong numbers if inferred.
TEXT_COLS = [
    "voucher_id_0", "vendor_name", "spending_department_id",
    "spending_department_name", "account_description", "fund_0", "descr",
]


def convert(year: int) -> dict:
    src = RAW / f"city-open-checkbook-{year}.csv"
    if not src.exists():
        return {"year": year, "ok": False, "note": f"missing {src} — run `make fetch-checkbook`"}

    df = pd.read_csv(src, dtype=str, keep_default_na=False, na_values=[])
    want_rows, want_sum = ANCHORS[year]

    # Reconcile in exact decimal, from the ORIGINAL strings — before any float
    # conversion can round a real discrepancy away.
    got_sum = sum((Decimal(v) for v in df["amount"]), Decimal(0))
    delta = got_sum - want_sum
    ok = len(df) == want_rows and delta == 0
    if not ok:
        return {"year": year, "ok": False, "rows": len(df), "sum": got_sum,
                "delta": delta, "note": "RECONCILIATION FAILED — not written"}

    df["amount"] = pd.to_numeric(df["amount"], errors="raise")
    df["date"] = pd.to_datetime(df["date"], format="%Y-%m-%d", errors="raise")
    for c in TEXT_COLS:
        df[c] = df[c].astype("string")

    df = df.drop(columns=[c for c in DROP if c in df.columns])
    out = CANON / str(year) / "actual" / "city-checkbook.parquet"
    out.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out, compression="zstd", index=False)

    return {"year": year, "ok": True, "rows": len(df), "sum": got_sum,
            "delta": delta, "negatives": int((df["amount"] < 0).sum()),
            "mb": out.stat().st_size / 1e6, "file": out}


def main() -> None:
    years = [int(a) for a in sys.argv[1:]] or sorted(ANCHORS)
    results = [convert(y) for y in years]

    print(f"{'year':<6}{'rows':>9}{'sum':>20}{'delta':>10}{'neg':>8}{'MB':>7}  verdict")
    for r in results:
        if not r["ok"]:
            print(f"{r['year']:<6}  {r.get('note')}")
            continue
        print(f"{r['year']:<6}{r['rows']:>9,}{r['sum']:>20,.2f}{r['delta']:>10.2f}"
              f"{r['negatives']:>8,}{r['mb']:>7.1f}  PASS")

    good = [r for r in results if r["ok"]]
    if good:
        print(f"\n{'TOTAL':<6}{sum(r['rows'] for r in good):>9,}"
              f"{sum(r['sum'] for r in good):>20,.2f}"
              f"{'':>10}{sum(r['negatives'] for r in good):>8,}"
              f"{sum(r['mb'] for r in good):>7.1f}")

    all_ok = all(r["ok"] for r in results)
    print(f"\nverdict: {'ALL PASS' if all_ok else 'FAILURES — nothing shipped for failing years'}")
    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
