.PHONY: help parse-city-detailed parse-city-book parse-county-operating reconcile \
        load-neon mcp-install mcp-dev mcp-test tools-test clean

help:
	@echo "MKE Budget Commons — targets:"
	@echo "  make parse-city-detailed FY=2026 TYPE=adopted   parse Phase 2 target units (+report)"
	@echo "  make parse-city-book FY=2026 TYPE=adopted        parse the whole adopted ledger (+report)"
	@echo "  make parse-city-requested                        parse the 2027 requested budget (+report)"
	@echo "  make parse-county-operating FY=2026             parse the county operating budget"
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

mcp-install:
	cd mcp && npm install

mcp-dev:
	cd mcp && npm run dev

mcp-test:
	cd mcp && node test/smoke.mjs
	cd mcp && node test/smoke_county.mjs
	cd mcp && node test/smoke_mps.mjs

tools-test:
	npm run -w @mke/budget-tools test

explainer:
	python -m scripts.build_explainer

clean:
	rm -rf data/canonical/**/*.parquet data/canonical/**/*.csv
