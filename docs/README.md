# Vercentlabs ERP Product & Engineering Blueprint

This directory is the durable source of truth for the F001–F510 enterprise ERP rebuild.

## Rule zero

The 510 canonical F-IDs are traceability identifiers, not implementation folders. Product implementation is organized by coherent business capabilities and public module contracts. The 36 shared-platform requirements remain separate from the 510 and are not assigned new F-IDs.

## Documentation operating model

1. Bootstrap creates all 510 dossiers as **UNSPECIFIED**.
2. Twelve module passes perform research, domain modelling, current-code audit, user-flow design, security/integration design, testing and red-team review.
3. A dossier reaches `SPECIFICATION_READY` only after objective evidence gates pass.
4. Product implementation starts only from approved capability packs and dependency-aware implementation plans.

See `00-program/CURRENT_REBUILD_CHECKPOINT.md` for the current program state.
