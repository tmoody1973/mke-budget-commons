# MKE Budget Commons — MCP Server (L3)

Read-only, **cited** access to the reconciled Milwaukee budget. TypeScript, official
MCP SDK, stdio transport. Connects to Neon through a `SELECT`-only role (`mcp_ro`);
`run_sql` is additionally guarded in code. Every substantive response carries a
`citations` array of `{doc_id, source_page}` — no claim without a page.

## Prereqs

1. `make load-neon` — builds the Neon serving layer from repo Parquet and writes
   `MCP_DATABASE_URL` (the read-only role) into `.env`.
2. `make mcp-install` — installs node deps.

## Run / test

```bash
make mcp-dev     # start the server on stdio
make mcp-test    # end-to-end smoke test through the MCP protocol
```

The project ships a root `.mcp.json`, so opening this repo in Claude Code registers
the `mke-budget` server automatically. For Claude Desktop, add to its config:

```json
{ "mcpServers": { "mke-budget": { "command": "npm", "args": ["--prefix", "/abs/path/to/mke-budget-commons/mcp", "run", "start"] } } }
```

## Tools (v1)

| Tool | What it returns |
|---|---|
| `list_departments` | departments + adopted grand totals |
| `get_department_budget` | reserved-code totals (006000/100/300/800), FTE, divisions, top expenditures, citations |
| `search_line_items` | full-text hits over line descriptions, ranked, cited |
| `get_positions` | position lines: titles, pay ranges, FTE, footnote flags, cited |
| `cite` | full provenance for one `line_id` (document, page, source URL) |
| `budget_breakdown` | *(citizen)* where the money goes — salaries / fringe / operating / equipment / special as $ and %, per department or citywide |
| `biggest_changes` | *(journalist)* the departments that changed most between two years — the story-finder, ranked by $ or %, cited |
| `find_positions` | *(both)* search positions by title, **per-person** salary floor, or footnote flag (e.g. grant-funded), cited |
| `glossary` | *(both)* plain-language explanations of codes, terms, footnotes, and vintages |
| `compare_years` | department reserved-code totals across two fiscal years, $ and % deltas, cited (2026 adopted ↔ 2027 requested) |
| `trace_adoption` | a department's budget through the stages loaded for a fiscal year (requested → … → adopted), with stage deltas |
| `reconciliation_status` | trust report: pass / not-reconcilable / **source-document errors**, with deltas |
| `run_sql` | read-only `SELECT`/`WITH` escape hatch (auto-`LIMIT`, 5 s timeout, catalog deny-list) |
| `get_amendments` | declared; returns `available:false` until the amendment (file/markup) documents are ingested |

Loaded docs: **`city-2026-adopted-detailed`** (2024 actual / 2025 budget / 2026 adopted)
and **`city-2027-requested-detailed`** (2025 actual / 2026 budget / 2027 requested).

## Design notes

- **Department rollups use `MAX`, not `SUM`**, over grand-total rows: a department's
  summary unit already equals the sum of its divisions, so `MAX` avoids double-counting.
- Ambiguous department names return `candidates` instead of guessing (via `dept_alias`).
- Responses are compact JSON (aggregates + top-N), never full table dumps.
