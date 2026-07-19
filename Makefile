.PHONY: help parse-city-detailed parse-city-book parse-county-operating fetch-checkbook checkbook-parquet fetch-grants grants-parquet reconcile \
        load-neon parse-wpf load-context mcp-install mcp-dev mcp-test tools-test clean

help:
	@echo "MKE Budget Commons — targets:"
	@echo "  make parse-city-detailed FY=2026 TYPE=adopted   parse Phase 2 target units (+report)"
	@echo "  make parse-city-book FY=2026 TYPE=adopted        parse the whole adopted ledger (+report)"
	@echo "  make parse-city-requested                        parse the 2027 requested budget (+report)"
	@echo "  make parse-county-operating FY=2026             parse the county operating budget"
	@echo "  make fetch-checkbook [YEARS='2024 2025']        pull City Open Checkbook via API (verified)"
	@echo "  make checkbook-parquet                          re-derive checkbook Parquet from raw CSVs"
	@echo "  make fetch-grants [YEARS='2024 2025']           pull federal grants via USAspending (verified)"
	@echo "  make reconcile                                  run reconciliation pytest suite"
	@echo "  make load-neon                                  rebuild Neon from repo Parquet (idempotent)"
	@echo "  make mcp-install                                install the MCP server's node deps"
	@echo "  make mcp-dev                                    run MCP server locally (stdio)"
	@echo "  make mcp-test                                   smoke-test the MCP server end-to-end"
	@echo "  make tools-test                                 run @mke/budget-tools unit/integration tests"
	@echo "  make explainer                                  build the standalone public budget explainer"

FY     ?= 2026
TYPE   ?= adopted
TARGET ?= all

parse-city-detailed:
	python -m parsers.city_detailed --fy $(FY) --type $(TYPE) --target $(TARGET)
	python -m scripts.report_city_detailed

parse-city-book:
	python -m parsers.city_detailed --fy $(FY) --type $(TYPE) --book
	python -m scripts.report_city_book

parse-city-requested:
	python -m scripts.report_city_requested

# Pulls the City Open Checkbook from OpenGov's public (undocumented) API, one file
# per fiscal year, each verified against that year's published count + total.
# Exits non-zero if any year fails. See docs/OPEN-CHECKBOOK-API.md.
fetch-checkbook:
	python -m scripts.fetch_checkbook $(YEARS)
	python -m scripts.checkbook_to_parquet $(YEARS)

# Re-derive canonical Parquet from raw CSVs already on disk (no network).
checkbook-parquet:
	python -m scripts.checkbook_to_parquet $(YEARS)

# Federal grants via USAspending's bulk_download endpoint (NOT the search API —
# see docs/FEDERAL-GRANTS-DESIGN.md). Each federal FY gated on two anchors.
fetch-grants:
	python -m scripts.fetch_grants $(YEARS)
	python -m scripts.grants_to_parquet $(YEARS)

grants-parquet:
	python -m scripts.grants_to_parquet $(YEARS)

parse-county-operating:
	python -m parsers.county_operating
	python -m scripts.report_county_operating
	python -m scripts.report_county_taxlevy

parse-mps:
	python -m parsers.mps_lineitem
	python -m scripts.report_mps_lineitem
	python -m parsers.mps_schools
	python -m scripts.report_mps_schools

reconcile:
	pytest tests/ -v

load-neon:
	python -m db.load

parse-wpf:
	python -m parsers.wpf_briefs

# Layer-2 context corpus → Neon pgvector. Embeds via the OpenAI API, so it needs
# OPENAI_API_KEY. Run AFTER parse-wpf; independent of load-neon (which never
# touches context_chunk). Rebuilds the table from scratch if the vector width changed.
load-context:
	node --import tsx db/load-context.ts

mcp-install:
	cd mcp && npm install

mcp-dev:
	cd mcp && npm run dev

mcp-test:
	cd mcp && node test/smoke.mjs
	cd mcp && node test/smoke_county.mjs
	cd mcp && node test/smoke_mps.mjs
	cd mcp && node test/smoke_payments.mjs
	cd mcp && node test/smoke_grants.mjs

tools-test:
	npm run -w @mke/budget-tools test

explainer:
	python -m scripts.build_explainer

clean:
	rm -rf data/canonical/**/*.parquet data/canonical/**/*.csv
