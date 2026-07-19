"""Acquire federal grant awards to Milwaukee County recipients from USAspending.

Deterministic, no LLM. One file per federal fiscal year, each verified against
two independent anchors before it is written — see docs/FEDERAL-GRANTS-DESIGN.md.

Uses the **bulk download** endpoint, NOT the search API. This is not a style
preference: `/search/spending_by_transaction/` returns amounts that disagree with
USAspending's own aggregates, inconsistently and by real money (FY2025 was off by
$577,547; FY2024 happened to agree). Filtering to a single agency produced a third
number again. The bulk extract reconciles exactly, every year tested.

The amount is `federal_action_obligation`: money legally committed by each
transaction. Deliberately NOT `total_obligated_amount`, which repeats the whole
award's lifetime value on every transaction row and sums to $7.1B for FY2024
against a true $666M — a 10.7x overstatement.

    python -m scripts.fetch_grants              # all years
    python -m scripts.fetch_grants 2024 2025    # specific federal fiscal years
"""

import csv
import io
import json
import sys
import time
import urllib.request
import zipfile
from decimal import Decimal
from pathlib import Path

API = "https://api.usaspending.gov/api/v2"
EARLIEST_FY = 2008                # API rejects start dates before 2007-10-01
OUTDIR = Path("data/raw/federal/grants")
POLL_SECONDS, POLL_MAX = 15, 60   # large years take a few minutes to generate

GRANT_TYPES = ["02", "03", "04", "05"]   # block/formula/project grants + coop agreements
COUNTY = {"country": "USA", "state": "WI", "county": "079"}

# Columns kept from the extract. federal_action_obligation is the headline;
# the award-level columns are carried but must NEVER be summed across rows
# (they repeat the award total on every transaction) — see the design doc.
KEEP = {
    "assistance_award_unique_key": "award_key",
    "award_id_fain": "award_id",
    "modification_number": "mod",
    "action_date": "action_date",
    "federal_action_obligation": "federal_action_obligation",
    "recipient_name": "recipient_name",
    "recipient_uei": "recipient_uei",
    "awarding_agency_name": "awarding_agency",
    "awarding_sub_agency_name": "awarding_sub_agency",
    "assistance_type_description": "award_type",
    "cfda_number": "cfda_number",
    "cfda_title": "cfda_title",
    "total_obligated_amount": "award_total_obligated",
    "total_outlayed_amount_for_overall_award": "award_total_outlayed",
    "prime_award_base_transaction_description": "description",
}


def post(path: str, body: dict) -> dict:
    req = urllib.request.Request(
        f"{API}{path}", data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def get(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=120) as r:
        return json.load(r)


def filters_for(fy: int) -> dict:
    """Federal fiscal year: Oct 1 of FY-1 through Sep 30 of FY."""
    return {"time_period": [{"start_date": f"{fy - 1}-10-01", "end_date": f"{fy}-09-30"}],
            "recipient_locations": [COUNTY], "award_type_codes": GRANT_TYPES}


def category_anchor(fy: int) -> Decimal:
    """Total from spending_by_category, summed across ALL pages.

    Paginating fully is not optional: deobligations (negative amounts) sort onto
    later pages, so a single-page read overstates the total.
    """
    total, page = Decimal(0), 1
    while True:
        d = post("/search/spending_by_category/awarding_agency/",
                 {"filters": filters_for(fy), "limit": 100, "page": page})
        if not d["results"]:
            break
        total += sum((Decimal(str(r["amount"])) for r in d["results"]), Decimal(0))
        if not d["page_metadata"]["hasNext"]:
            break
        page += 1
    return total


def request_extract(fy: int) -> tuple[str, str]:
    r = post("/bulk_download/awards/", {
        "filters": {
            "prime_award_types": GRANT_TYPES,
            "date_type": "action_date",
            "date_range": {"start_date": f"{fy - 1}-10-01", "end_date": f"{fy}-09-30"},
            "recipient_locations": [COUNTY],
        },
        "file_format": "csv",
    })
    return r["file_name"], r["file_url"]


def await_extract(file_name: str) -> int:
    """Poll until the extract is generated; returns USAspending's own row count."""
    for _ in range(POLL_MAX):
        s = get(f"{API}/download/status?file_name={file_name}")
        if s.get("status") == "finished":
            return int(s.get("total_rows") or 0)
        if s.get("status") == "failed":
            raise RuntimeError(f"extract failed: {s.get('message')}")
        time.sleep(POLL_SECONDS)
    raise TimeoutError(f"extract not ready after {POLL_SECONDS * POLL_MAX}s")


def read_extract(url: str) -> list[dict]:
    with urllib.request.urlopen(url, timeout=600) as r:
        blob = r.read()
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        names = [n for n in z.namelist() if n.endswith(".csv")]
        if len(names) != 1:
            raise RuntimeError(f"expected 1 CSV in the extract, found {len(names)}: {names}")
        with z.open(names[0]) as fh:
            # Fields contain embedded newlines — must go through a real CSV
            # reader, never line counting (the raw file has 2,949 lines for
            # 1,676 records).
            return list(csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8")))


def fetch_year(fy: int) -> dict:
    print(f"\n=== FY{fy} ===")
    anchor = category_anchor(fy)
    print(f"  anchor: ${anchor:,.2f}")
    if anchor == 0:
        return {"fy": fy, "ok": False, "note": "no grant activity"}

    name, url = request_extract(fy)
    print(f"  extract requested, generating…")
    want_rows = await_extract(name)
    rows = read_extract(url)
    print(f"  {len(rows):,} records (USAspending reported {want_rows:,})")

    got = sum((Decimal(r["federal_action_obligation"] or "0") for r in rows), Decimal(0))
    delta = got - anchor
    ok = len(rows) == want_rows and delta == 0

    out = OUTDIR / f"federal-grants-mke-{fy}.csv"
    if ok:
        with out.open("w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=list(KEEP.values()))
            w.writeheader()
            for r in rows:
                w.writerow({dst: r.get(src, "") for src, dst in KEEP.items()})

    negatives = sum(1 for r in rows if Decimal(r["federal_action_obligation"] or "0") < 0)
    print(f"  sum ${got:,.2f} | delta ${delta:,.2f} | {'PASS' if ok else 'FAIL — not written'}")
    return {"fy": fy, "ok": ok, "rows": len(rows), "sum": got, "delta": delta,
            "negatives": negatives, "file": out if ok else None}


def main() -> None:
    years = [int(a) for a in sys.argv[1:]] or list(range(EARLIEST_FY, 2027))
    OUTDIR.mkdir(parents=True, exist_ok=True)
    results = []
    for fy in years:
        try:
            results.append(fetch_year(fy))
        except Exception as e:                      # noqa: BLE001 — report, don't abort the run
            print(f"  ERROR: {e}")
            results.append({"fy": fy, "ok": False, "note": str(e)})

    print("\n\n--- RECONCILIATION SUMMARY ---")
    for r in results:
        if r["ok"]:
            print(f"  FY{r['fy']}  {r['rows']:>7,} txns  ${r['sum']:>18,.2f}  "
                  f"{r['negatives']:>4} neg  PASS")
        else:
            print(f"  FY{r['fy']}  {r.get('note', 'FAILED')}")
    ok = [r for r in results if r["ok"]]
    print(f"\n  {len(ok)}/{len(results)} years reconciled")
    if ok:
        print(f"  combined: {sum(r['rows'] for r in ok):,} transactions · "
              f"${sum(r['sum'] for r in ok):,.2f}")
    sys.exit(0 if len(ok) == len(results) else 1)


if __name__ == "__main__":
    main()
