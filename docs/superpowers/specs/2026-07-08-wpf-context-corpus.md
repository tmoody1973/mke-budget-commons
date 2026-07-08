# Spec — WPF Context Corpus (Layer 2): cited retrieval of Wisconsin Policy Forum wisdom

**Status:** Scoped (Layer 1 shipped in the prompt). Ready to expand into a task plan + build.
**Date:** 2026-07-08
**Depends on:** the L1→L4 pipeline, `@mke/budget-tools`, the budget-agent app.

## Goal

Give the Budget Analyst agent the Wisconsin Policy Forum's **qualitative wisdom** — explanations, context, historical framing, the "so what" — as a **cited, retrievable knowledge layer**, so it can explain Milwaukee's budgets in plain English grounded in respected independent analysis. **Never as a source of figures.**

## The inviolable rule, extended (the whole point)

- **WPF = wisdom, not numbers.** Every `$`/FTE/`%` the agent states as a *current fact* comes from a reconciled budget tool and is cited to a budget document page. WPF retrieval supplies *explanation, context, framing, definitions* only.
- **Always attributed.** WPF passages are labeled secondary commentary and cited (brief · page): "the Wisconsin Policy Forum's 2026 City Budget Brief (p. 12) frames this as…".
- **Conflicts → tools win.** If WPF and a tool differ on a figure, the reconciled tool is authoritative; note WPF's framing, cite our number.
- This keeps the "no LLM touches the canonical numbers" wall intact — WPF is a *separate, secondary* corpus for prose, never a fact source.

## Architecture (mirrors the existing L1→L4 pattern)

```
L1 parse   →  wi-policy-forum/*.pdf → cleaned prose CHUNKS w/ provenance (brief·gov·year·page)
              → repo canonical: data/canonical/context/wpf/*.csv+parquet (diffable, auditable)
L2 store   →  Neon pgvector: context_chunk(source='wpf', gov, year, page, text, embedding)
              (disposable, rebuilt from repo by db/load; embeddings generated at load)
L3 tool    →  explain(question, gov?, k?) — read-only, semantic search → cited WPF passages,
              labeled "secondary commentary". Added to @mke/budget-tools (shared) + MCP + app actions.
L4 app     →  agent calls `explain` for context; renders a ContextCard (WPF quote + citation chip);
              answer weaves WPF framing (attributed) around tool-sourced, cited numbers.
```

## Key design decisions

1. **Corpus is CONTEXT, not FACT.** New table `context_chunk`, clearly separate from `fact_budget_line`. Chunks are prose (not a ledger); **not reconcilable** and never labeled otherwise. `source='wpf'` distinguishes it; the schema leaves room for other secondary sources later.
2. **Extraction is prose-grade, not reconciliation-grade.** These are design PDFs (messy text layer). Use OCR (or word-level de-spacing) → clean paragraphs. Because we capture prose for retrieval — not figures — imperfect extraction is acceptable. Keep each chunk's page for citation.
3. **Chunking:** by section/paragraph (~150–400 words), preserving the "Keys to Understanding" structure and headings as metadata. Each chunk keeps brief, gov, year, page.
4. **Embeddings (the one new dependency — a conscious yes).** Retrieval needs an embedding model. Recommended: a small, cheap model via API (e.g. OpenAI `text-embedding-3-small`) or a local sentence-transformer to avoid a new cloud dep. It runs at **L2 load time only**, over the **secondary** corpus, and **never touches canonical numbers** — so it does not violate "no LLM in `parsers/`" (scoped to the fact pipeline). Store vectors in Neon **pgvector**.
5. **Retrieval tool `explain`:** input `{ question, gov?, k=4 }` → embed the question → pgvector cosine top-k over `context_chunk` (optionally filtered by gov) → return `{ passages: [{ text, brief, gov, year, page, score }], note: "Wisconsin Policy Forum commentary — secondary source" }`. Read-only. Provenance on every passage.
6. **Copyright/attribution posture:** return **short** passages, always attributed + linked to WPF; never reproduce whole briefs. Fits a public tool and WPF's nonpartisan mission.

## Task outline (to expand into a bite-sized plan)

1. **L1 parser** `parsers/wpf_briefs.py` — extract the 3 briefs → cleaned chunks CSV (brief, gov, year, page, section, text). No LLM. Emit a small QA report (chunk counts/page coverage). *(No reconciliation suite — it's prose; instead assert page coverage + non-empty chunks.)*
2. **Canonical output** — commit `data/canonical/context/wpf/2026-2027/chunks.{csv,parquet}`.
3. **L2 schema + load** — `context_chunk` table (with `pgvector` extension) + `db/load` step that embeds chunks and upserts vectors. Idempotent, rebuildable.
4. **L3 `explain` in `@mke/budget-tools`** — the retrieval query fn + Zod schema + citation shaping; add to the MCP server (thin registration) and the app's `defineTool`s. Unit test: a known query returns relevant WPF passages with citations.
5. **L4 wiring** — a `ContextCard` generative component (WPF quote + brief·page chip + link) rendered via `useRenderTool` for `explain`; prompt note that `explain` returns secondary commentary to be attributed.
6. **Prompt tightening** — point the agent to call `explain` for "why/what does this mean/explain" questions; reaffirm the strict number rule.
7. **Verify** — live: an "explain like I'm 12" question pulls WPF context (attributed + cited) while all figures come from budget tools.

## Open questions for the plan phase
- Embedding model choice (cheap API vs local) + where the embed step runs (db/load in Python vs a Node step). Recommend Python at load, consistent with the pipeline.
- Whether to expose `explain` over MCP too (parity) or app-only first.
- Chunk size / overlap tuning after seeing retrieval quality.

## Out of scope / guardrails
- WPF is **not** a new government or a fact source — it's a secondary *context* corpus over the same three governments. Not the prohibited scope creep (MMSD/MATC, capital, ACFR).
- No canonical number ever originates from WPF. The reconciliation wall is unchanged.
