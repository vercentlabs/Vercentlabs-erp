# Internal Link Map — Phase 5

## The graph

```
/industries ──→ /industries/{4 slugs}
/industries/{slug} ──→ /modules/{moduleStack keys} (RecommendedModuleStack)
                    ──→ /workflows/{primaryWorkflowSlug} (if set)
                    ──→ /implementation, /security
                    ──→ /book-demo?industry={slug}

/solutions ──→ /solutions/{5 slugs}
/solutions/{slug} ──→ /product/* (exactly ONE paired platform page, the differentiation anchor)
                  ──→ /modules/{relatedModuleKeys}
                  ──→ /workflows/{relatedWorkflowSlugs} (where set)
                  ──→ /implementation
                  ──→ /book-demo?solution={slug}

/workflows ──→ /workflows/{6 routed slugs}
/workflows/{slug} ──→ /modules/{modules} (every participating module)
                   ──→ /industries/{matching industries, via getIndustriesForWorkflow()}
                   ──→ /implementation
                   ──→ /book-demo?workflow={slug}

/implementation ──→ /security, /product/platform, /industries

/modules/{slug} ──→ /industries/{up to 2, via getIndustriesForModule()}     [NEW this phase]
               ──→ /workflows/{up to 2 routed, via getWorkflowsForModule()}  [NEW this phase]
               ──→ /solutions/{up to 2, via getSolutionsForModule()}        [NEW this phase]

Footer ──→ /industries (+ 4 direct links), /solutions, /workflows           [NEW/restored this phase]
PRIMARY_NAV ──→ Industries (pre-existing, previously 404), Solutions, Workflows [NEW], Implementation (Product submenu) [NEW]
```

## Bidirectionality is structural, not duplicated data

Module → industry/solution/workflow links are derived live via `getIndustriesForModule()`, `getSolutionsForModule()`, `getWorkflowsForModule()` — there is no second, hand-maintained copy of "which industries reference this module" that could drift out of sync with the industry's own `moduleStack`. `internal-link-graph.test.mjs` verifies this reciprocity directly (`getIndustriesForModule(entry.moduleKey)` must include the industry that listed it).

## No orphans, no accidental mesh

- `internal-link-graph.test.mjs` asserts every module has at least one inbound cross-tier link (from an industry, solution, or workflow) — no module page is a dead end.
- The same suite asserts no industry or solution links to literally every module — real curation, not a mechanical dump.

## A real content gap this surfaced and fixed

Building the `project-to-profitability` workflow's sequence revealed its `modules` array was missing `procurement`, despite `product-intelligence.md`'s real Cross-Module Workflow 7 ("Billable Project Delivery") explicitly including it. Fixed by adding `procurement` to the array — which also means Procurement's module page now correctly links to this workflow for the first time. See `workflow-content-architecture.md` for detail.
