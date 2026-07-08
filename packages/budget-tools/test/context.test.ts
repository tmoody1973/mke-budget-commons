import { test } from "node:test";
import assert from "node:assert/strict";
import { explain } from "../src/index.js";

// Integration: needs MCP_DATABASE_URL (loaded context_chunk) + the local embedding
// model (cached after the first run). WPF is SECONDARY commentary — these assert
// the retrieval + provenance contract, not any budget figure.

test("explain(city) retrieves cited WPF passages", async () => {
  const r = await explain({ question: "why is the city facing a structural deficit?", gov: "city", k: 4 });
  assert.ok(r.passages.length > 0 && r.passages.length <= 4, "returns up to k passages");
  const p = r.passages[0];
  assert.ok(p.text.length > 0, "passage carries prose");
  assert.ok(p.page > 0, "passage carries a page for citation");
  assert.equal(p.gov, "city", "gov filter honored");
  assert.match(p.brief_id, /^wpf-/, "attributed to a WPF brief");
  assert.ok(r.passages.every((x) => x.score >= -1.0001 && x.score <= 1.0001), "scores are cosine similarity");
  assert.match(r.note, /Wisconsin Policy Forum/, "labeled secondary commentary");
});

test("explain() ranks by relevance and every passage is provenance-bearing", async () => {
  const r = await explain({ question: "what does Wisconsin Act 12 mean for the budget?", k: 5 });
  assert.ok(r.passages.length > 0, "returns passages across governments");
  const scores = r.passages.map((p) => p.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a), "sorted by score desc");
  assert.ok(r.passages.every((p) => p.brief_id && p.page > 0), "every passage cites brief + page");
});
