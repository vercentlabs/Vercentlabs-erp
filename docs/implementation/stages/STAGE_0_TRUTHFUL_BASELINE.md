# Stage 0 of 11 — truthful release baseline

## Purpose

Stage 0 corrects public, internal and automated statements that overstate or contradict the current ERP release. It changes no tenant schema, business command, accounting posting rule, procurement lifecycle, Sales calculation or CRM record workflow.

## Release vocabulary

- **Controlled early access** means selected workflows are available for pilot validation.
- **Roadmap** means the module or capability cannot be represented as shipped.
- **Implemented** in the 419-capability programme requires implementation paths, executable tests and verified acceptance evidence.
- Static source checks do not constitute live end-to-end certification.

## Canonical scope

- Total modules: 12
- Controlled early-access modules: CRM, Sales, Accounting and Procurement
- Roadmap modules: Stock, Manufacturing, Projects, Assets, Point of Sale, Quality, Support and HR & Payroll
- Native operational focus: CRM and selected Procurement/platform workspaces
- Sales and Accounting mobile access: responsive-web handoff until native operations are delivered

## Stage acceptance

Stage 0 passes only when:

1. module counts derive from the shared module catalogue;
2. CRM-only, 3/9 and unsupported end-to-end claims are absent from protected scope files;
3. module pages describe the selected module rather than calling every module CRM;
4. mobile parity distinguishes native workflows from secure browser handoff;
5. OpenAPI is labelled as a partial internal contract;
6. the 419-row register remains unchanged;
7. the 419-row evidence ledger exists and the final completion gate remains closed;
8. relevant source-contract tests and syntax checks pass.
