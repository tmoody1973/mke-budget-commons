"""Milwaukee County Adopted Operating Budget parser — STUB.

Phase 5. County book is narrative chapters + summary tables (table-detection,
NOT band parsing). See CLAUDE.md county section. Deterministic only. NO LLM.
"""
import argparse


def main():
    ap = argparse.ArgumentParser(description="Parse the county operating budget PDF.")
    ap.add_argument("--fy", type=int, default=2026)
    ap.add_argument("--type", default="adopted")
    args = ap.parse_args()
    raise SystemExit("STUB: county_operating parser not built yet. Phase 5.")


if __name__ == "__main__":
    main()
