# AEO Answer Library

## What it is

`packages/landing-content/src/answers.js`'s `AEO_ANSWERS` — 12 typed, reusable question/answer entries (`id`, `question`, `entity`, `directAnswer`, `expandedExplanation`, `relatedRoute`, `lastReviewedAt`). Not a hidden database and not a dedicated page per question — each entry's `directAnswer`/`expandedExplanation` is meant to be rendered in-context wherever it's referenced (a glossary card's short definition, a resource guide's direct-answer opening, an FAQ), and to power the real, visible content those pages already carry.

## The 12 entries

What is ERP · What is MRP · What is a bill of materials · What is manufacturing ERP · What is procure-to-pay · What is lead-to-cash · What is multi-tenant SaaS · What is multi-company ERP · What is RBAC · What is maker-checker · Which ERP modules should you implement first · What should an ERP implementation checklist cover.

## Sourcing discipline

Universal ERP/manufacturing definitions (what is ERP, what is MRP) aren't tied to an external `EDITORIAL_SOURCES` entry — these are standard-usage definitions, not competitor-specific or statistical claims requiring live verification (see `.claude/rules/landing-content.md` rule 2's explicit scope). Every entry describing what Vercentlabs specifically does traces to `product-intelligence.md` and the same cited facts already used in `workflows.js`/`solutions.js` — no new unverified product claim was invented for this library.

## Relationship to the glossary and resources

Each answer's `relatedRoute` points to the real page that already covers the concept in depth — a glossary standalone page (e.g. `what-is-rbac` → `/resources/glossary/rbac`), a workflow page (`what-is-lead-to-cash` → `/workflows/lead-to-cash`), or a resource guide (`which-erp-modules-do-we-need-first` → `/resources/erp-buying-guide`). This is a cross-reference layer connecting AEO-shaped questions to existing content, not a parallel content system.

## Why not a dedicated page per question

A dedicated `/answers/what-is-erp` page would either duplicate `/resources/glossary/erp` or compete with it for the same query — exactly the cannibalisation risk the brief warned against. The answer library exists so the *phrasing* of common questions is deliberately catalogued and can be surfaced consistently (in an FAQ block, a direct-answer opening paragraph) without creating a second URL for the same intent.

## Current usage status

The library is built and typed, exported from the content package, and content-complete. It is not yet wired into every page's rendered FAQ/direct-answer content programmatically (most pages currently have their own hand-written `faqs`/`directDefinition` fields, authored before or independent of this library). Recommended as a Phase 7 or later refinement: audit existing page-level FAQs against `AEO_ANSWERS` for phrasing consistency, and consider driving new FAQ entries from this library going forward rather than hand-writing duplicates. This is a genuine, disclosed gap — not silently left unaddressed.
