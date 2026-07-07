# MKE Budget Commons

Machine-readable, reconciled structured data extracted from **City of Milwaukee and Milwaukee County adopted budget documents**, with an agentic (MCP) access layer so AI apps can answer cited budget questions.

Every dollar figure is extracted **deterministically** from the governments' own PDFs and checked against the documents' printed totals. **No language model reads the numbers.**

Methodology mirrors [BetaNYC/New-York-City-Budget](https://github.com/BetaNYC/New-York-City-Budget). Built with [Claude](https://claude.ai).

See `docs/PRD.md` for the full spec and `CLAUDE.md` for the operating contract.

## Quickstart

```bash
pip install -r requirements.txt
make parse-city-detailed FY=2026 TYPE=adopted
make reconcile
```

## Layout

```
parsers/     L1 deterministic PDF parsers (Python)
tests/       reconciliation suite (the trust layer)
data/raw/    source PDFs + sources.yml manifest
data/canonical/  extracted, reconciled Parquet + CSV
crosswalks/  department/fund/footnote maps across years
db/          Neon Postgres schema + idempotent loader
mcp/         L3 TypeScript MCP server
docs/        PRD + per-document reconciliation reports
```

## License

Code + derived data: MIT. Source documents: © City of Milwaukee / Milwaukee County, reproduced as public records.
