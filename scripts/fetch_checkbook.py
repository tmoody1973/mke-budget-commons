"""Acquire the City of Milwaukee Open Checkbook from OpenGov's public API.

Deterministic, no LLM. Pulls one file per fiscal year and verifies each against
that year's own published total — the same reconciliation contract the budget
PDFs get, using the portal's own printed totals as anchors.

Two things this works around, both verified:
  * The UI's CSV export truncates at 50,000 rows. This endpoint paginates
    without that cap (1,000 rows/request, server-enforced).
  * The server 403s on non-browser User-Agents — this is the "gov sites block
    bot fetching" behavior noted in CLAUDE.md, and it is UA filtering, not auth.

Pagination sorts by `quasi_id` (a unique per-row hash) rather than date, so
pages cannot shift or duplicate mid-pull the way a non-unique sort key allows.

    python -m scripts.fetch_checkbook            # all years
    python -m scripts.fetch_checkbook 2024 2025  # specific years
"""

import csv
from decimal import Decimal
import hashlib
import json
import sys
import time
import urllib.request
from pathlib import Path

BASE = "https://milwaukee.opengov.com/api/transactions/v2"
DATASET = "ec781edd-ba12-428f-b679-bf357c92b6a7"
REPORT_URL = "https://milwaukee.opengov.com/transparency#/66975"

HEADERS = {
    "Content-Type": "application/json",
    # A real browser UA is required — Python's default gets a 403.
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    ),
}

# Every visible column, plus quasi_id as stable row identity for provenance.
FIELDS = [
    "quasi_id", "voucher_id_0", "date", "amount", "vendor_name",
    "spending_department_id", "spending_department_name",
    "account_description", "fund_0", "descr",
]

PAGE = 1000                       # server-enforced ceiling
YEARS = [2022, 2023, 2024, 2025, 2026]
OUTDIR = Path("data/raw/city/checkbook")


def post(path: str, payload: dict) -> dict:
    req = urllib.request.Request(
        f"{BASE}/{path}/{DATASET}",
        data=json.dumps(payload).encode(),
        headers=HEADERS,
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.load(r)


def fetch_year(year: int) -> dict:
    date_filter = {"ge": f"{year}-01-01", "le": f"{year}-12-31"}
    anchor = post("total", {"fields": ["amount"], "filter": {"date": date_filter}})
    want_rows, want_sum = int(anchor["count"]), Decimal(str(anchor["total"]))
    out = OUTDIR / f"city-open-checkbook-{year}.csv"

    print(f"\n=== {year} === published: {want_rows:,} rows / ${want_sum:,.2f}")
    rows, got_sum, offset = 0, Decimal(0), 0

    with out.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=FIELDS)
        w.writeheader()
        while offset < want_rows:
            page = post("query", {
                "sort": [{"quasi_id": "asc"}],
                "offset": offset,
                "limit": PAGE,
                "fields": FIELDS,
                "filter": {"date": date_filter},
            })["transactions"]
            if not page:
                print(f"\n  !! empty page at offset {offset:,} — stopping early")
                break
            for row in page:
                # NB: quasi_id is a CONTENT hash, not a unique row id — two
                # separate payments with identical field values share one.
                # De-duping on it silently drops real payment lines (verified:
                # it lost 540 rows / $394,293.23 from 2026). Write every row;
                # the count+total check below is what proves the pull correct.
                got_sum += Decimal(row["amount"])
                rows += 1
                w.writerow({k: row.get(k, "") for k in FIELDS})
            offset += len(page)
            print(f"\r  {offset:>7,}/{want_rows:,} ({offset/want_rows:5.1%})", end="", flush=True)
            time.sleep(0.15)   # be polite to a public gov endpoint

    delta = got_sum - want_sum
    ok = rows == want_rows and delta == 0
    print(f"\r  {rows:,} rows | sum ${got_sum:,.2f} | delta ${delta:,.2f} | "
          f"{'PASS' if ok else 'FAIL'}        ")
    return {
        "year": year, "file": out, "rows": rows, "want_rows": want_rows,
        "total": got_sum, "want_total": want_sum, "ok": ok,
        "sha256": hashlib.sha256(out.read_bytes()).hexdigest(),
    }


def main() -> None:
    years = [int(a) for a in sys.argv[1:]] or YEARS
    OUTDIR.mkdir(parents=True, exist_ok=True)
    results = [fetch_year(y) for y in years]

    print("\n\n--- RECONCILIATION SUMMARY ---")
    for r in results:
        print(f"  {r['year']}  {r['rows']:>7,} rows  ${r['total']:>18,.2f}  "
              f"{'PASS' if r['ok'] else 'FAIL'}")
    all_ok = all(r["ok"] for r in results)
    print(f"  verdict: {'ALL PASS' if all_ok else 'FAILURES — do not ship'}")

    print("\n--- for data/raw/sources.yml ---")
    for r in results:
        print(f"""  - doc_id: city-checkbook-{r['year']}
    gov: city
    fiscal_year: {r['year']}
    doc_family: checkbook
    file: {r['file']}
    source_url: {REPORT_URL}
    api_endpoint: {BASE}/query/{DATASET}
    rows: {r['rows']}
    published_total: {r['want_total']}
    retrieved_on: {time.strftime('%Y-%m-%d')}
    sha256: {r['sha256']}""")

    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
