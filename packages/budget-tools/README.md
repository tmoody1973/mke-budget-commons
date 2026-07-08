# @mke/budget-tools

Shared **read-only, cited** query layer over the reconciled Milwaukee budget (Neon `mcp_ro`).
The single source of truth for budget queries, imported by:

- `mcp/` — the L3 MCP server (wraps these fns in the MCP `ok`/`fail` envelope).
- `apps/budget-agent/` — the L4 CopilotKit actions (import these fns directly).

Every figure-returning function selects `doc_id` + `source_page` and shapes them via
`citations()`. `runSql` stays behind `guardSelect` (SELECT/WITH only). No write path exists.

- `npm run -w @mke/budget-tools test` — unit/integration tests (needs `MCP_DATABASE_URL`).
- `npm run -w @mke/budget-tools typecheck`
