# Benchmark Research Standard

## Source priority
Prefer current official product documentation, release documentation and primary standards. Secondary commentary can guide discovery but cannot be the sole evidence for a material requirement.

## Evidence granularity
Each material benchmark finding receives its own `evidence_id` and maps to one or more canonical feature IDs and/or a noncanonical capability ID. Vendor-level rows are a research queue, not evidence by themselves.

## Required evidence fields
Record module, vendor/product, source type, source title, source URL, publication/update date when available, access date, mapped F-IDs/capability IDs, concise observed capability, decision, rationale, and research status.

## Decision vocabulary
- `REQUIRED`: mature enterprise behavior Vercentlabs should support.
- `DIFFERENTIATOR`: behavior worth intentionally doing better or more simply.
- `NOT_APPLICABLE`: deliberately excluded with explicit product/domain rationale.

Vendor behavior is evidence, not automatic scope. No meaningful expected capability may be silently omitted merely because the canonical F-name is short.
