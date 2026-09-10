# CRM presentation system

This directory owns CRM presentation composition and the canonical F001-F030 web traceability map. Business rules stay in the eight CRM capability directories; reusable ERP primitives stay in `src/shared/design`.

`crm.css` is the **single CRM route stylesheet**. It consumes only generated `--erp-*` semantic tokens, uses the canonical 480 / 768 / 1024 / 1280 responsive grammar, and is loaded only by the CRM route layout. App-root CRM stylesheets and the former `crm-ui-system.css` override layer are retired.

`crm-route-registry.ts` assigns each CRM route to a stable page archetype. `crm-route-experience.tsx` applies the common geometry/accessibility wrapper. `crm-surface-registry.ts` maps all 30 product capabilities to discoverable web surfaces. Native/mobile uses the same F001-F030 contract through `apps/mobile/src/modules/crm/ui/crm-feature-registry.ts`.

The semantic theme source is `packages/shared-ui/tokens/theme.json`; `scripts/design/generate-theme.mjs` generates the web and native adapters. Do not hand-edit those generated token files.
