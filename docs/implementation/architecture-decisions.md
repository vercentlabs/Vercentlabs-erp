# Architecture decisions

| Id | Decision | Reason |
|---|---|---|
| AD1 | Keep the existing layout (`apps/web/src/{app,core,shell,features,shared}`, `packages/design-system`, `services/api`) instead of renaming to the spec's target tree. | The repo already follows the spec's ownership model and has 58 working Playwright specs. A rename adds risk and no behaviour. |
| AD2 | Feature folders are per module (`features/<module>/<screen-group>`), not 98 capability directories. | The spec itself says not to create empty scaffolding. Capability ids are carried by `docs/02-register/CAPABILITY_REGISTER.csv` and the feature-status matrix. |
| AD3 | Pure logic that must be unit-tested without Next.js is extracted to `.ts` files with no `next/*` imports (`core/body-limit.ts`, `core/db-ssl.ts`, `shared/providers/resolve-locale.ts`, `features/pos/offline/seed-vault.ts`). | `node --test` cannot resolve `next/server`. |
| AD4 | Query caches are cleared entirely (`queryClient.clear()`) on tenant switch and sign-out instead of pruning by key prefix. | ~560 query keys exist and not all use `scopedQueryKey`; prefix pruning cannot be proven complete. |
| AD5 | Production refuses `DATABASE_SSL_INSECURE`; certificate verification is on whenever `DATABASE_SSL=true`. | An insecure flag must not be able to weaken production. |
| AD6 | The POS offline seed is wrapped under a non-extractable device key stored as a `CryptoKey` in IndexedDB, and removed on sign-out and tenant switch. Queued ciphertext stays; the same user regains access by signing in online. | The seed was memory-only but the snapshot that carried it was itself encrypted with it, so a cold offline reload could not decrypt. Limits are documented in `seed-vault.ts`. |
| AD7 | Root layout reads the saved locale from the session and falls back to `en-IN`. | The locale was hard-coded to `en-US`. Server and client receive the same prop, so hydration agrees. |
| AD8 | The status generator never emits `VERIFIED_COMPLETE`. | Citing an id or having a route is not evidence of behaviour. |
