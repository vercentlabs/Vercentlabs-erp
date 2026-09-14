# F072 Bid comparison — Atomic requirement trace

Dossier: compare competing bids using "normalized deterministic commercial
and qualitative criteria." Lifecycle: `NOT_STARTED -> IN_EVALUATION ->
COMPLETED -> LOCKED; controlled reopen creates new evaluation evidence`.

`sourcing-evaluations` is a generic child resource. UI: `pass1-operations-
workspace.tsx`'s `record-sourcing-evaluation` action.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001 (evaluation records exist) | PASS (minimal) | An evaluation (`bidId`, `score`, `recommendation`, `note`) can be recorded against a sourcing event through a real form. |
| **CAP-001 — "normalized deterministic" comparison — GAP, confirmed the core capability is missing.** | `export function evaluateSupplierScore(weights, scores)` (`index.js:2370-2377`) is a genuinely well-built, deterministic, decimal-safe weighted-scoring function (`allocate("100", weights)` avoids floating-point drift). **It is never called anywhere** — `grep -rl "evaluateSupplierScore"` outside its own module finds only the `.d.ts` type declaration, no actual call site in the API layer, worker, or web app. The "Evaluation score" field in the UI is a **raw manually-typed number** (`field("score", "Evaluation score", "number")`), not a computed output of this function. The one piece of code built specifically for deterministic bid/supplier scoring is dead. |
| **UX — no side-by-side comparison view.** | **GAP, confirmed.** There is no comparison matrix/table anywhere in the web app rendering multiple bids' prices/terms/scores next to each other for a human to compare — only a generic list of raw evaluation records (`sourcing-evaluations` as one of `pass1-operations-workspace`'s readable resource tables) and, separately, a raw list of bids. An operator would have to manually cross-reference two separate flat lists to "compare" anything. |
| **The award flow bypasses evaluation entirely.** | `awardSourcingEvent` (`index.js:1752+`) reads `input.selectedBidId` directly and looks it up in `source.bids` — it never reads or requires any `sourcing-evaluations` record to exist, let alone reads a comparison score to justify the choice. The UI's own award prompt (`window.prompt("Selected bid ID")`) requires the operator to already know and manually type the raw bid UUID — there is no picker, no visible comparison, nothing connecting "evaluation" to "award" at all. |
| BR-001 (single authoritative comparison logic) | FAIL by omission | Since no comparison logic actually runs, there's nothing to be inconsistently duplicated — but also nothing authoritative to point to. |
| E2E | GAP (module-wide) | See F063. |
| UAT | PENDING HUMAN UAT | |

## Net assessment (2026-09-14)

**This is one of the most significant gaps found in the whole module.**
The dossier's core ask — a deterministic, comparable evaluation of
competing bids — has a real, correct scoring function sitting completely
unused, a manual-entry-only evaluation record with no comparison UI, and
an award action that bypasses evaluation entirely via a raw UUID typed
into a browser `prompt()`. Wiring `evaluateSupplierScore` into a real
comparison view and having the award action consume it would be high-value,
scoped work for the gap-closing pass — the underlying math is already
correct and tested-quality, it's just never invoked.
