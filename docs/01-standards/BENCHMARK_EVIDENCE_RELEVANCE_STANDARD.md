# Benchmark Evidence Relevance Standard — Final Pass D

## Purpose
A source being official is not enough. Evidence must be relevant to the feature it is attached to. Pass D prevents authoritative-but-irrelevant sources from silently becoming requirements.

## Evidence classes
1. **Curated Pass-D mapping** — two independent official/primary authorities intentionally selected for each F001-F510 feature. These are the benchmark relevance authority for implementation planning.
2. **Legacy RETAIN** — earlier evidence with an official/primary source, recorded finding, compatible module scope and no restricted-topic mismatch.
3. **Legacy REMAP_REQUIRED / NEEDS_BETTER_SOURCE / NEEDS_BETTER_FINDING** — preserved for provenance but non-authoritative until corrected.
4. **SOURCE_LIBRARY_ONLY** — useful background source with no direct business-feature mapping.

## Restricted-topic rule
Payment standards, UPI, statutory agencies, tax portals, security/accessibility standards and technology documentation MUST NOT be mechanically mapped to unrelated business features. For example, UPI evidence cannot benchmark barcode scanning merely because both occur in POS.

## Benchmark versus product authority
Benchmark evidence informs enterprise expectations. It does not override the canonical feature register, Pass B semantic/sub-feature freeze, Pass C flows/state machines, deterministic accounting/inventory/payroll/tax controls, public-module boundaries or explicit Vercentlabs decisions.

### Lifecycle compatibility

Curated Pass-D rows use `status=EVIDENCE_CAPTURED` in `BENCHMARK_REGISTER.csv` because that is the established cross-pass evidence lifecycle consumed by legacy module validators. Final Pass-D approval lives separately in `BENCHMARK_RELEVANCE_REVIEW.csv`; capture status and relevance-approval status are intentionally not conflated.

## Implementation gate
Every canonical business feature must have at least two intentionally mapped official/primary sources, two independent source IDs, a complete relevance review, and no restricted-topic misuse in the curated pair.
