# Four-module 419-capability completion policy

The feature register is a benchmark and implementation programme, not a statement that every capability is shipped.

A capability may be presented as complete only when all of the following are true:

1. Its register status is `Implemented`.
2. `four-module-feature-evidence.json` names the actual implementation paths.
3. The evidence names executable test paths.
4. Acceptance is `verified` with a date and verifier.
5. Required external providers, statutory services, Stock dependencies and operational runbooks are configured and tested where applicable.

`pnpm report:419` reports current progress. `pnpm verify:419-complete` is intentionally a final-programme gate and must fail while any capability lacks implementation or acceptance evidence. It is not part of the controlled early-access release gate.
