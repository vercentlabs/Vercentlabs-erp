# AI Runtime Governance Standard

Status: `ARCHITECTURE_FROZEN_PASS_E`

Product AI and engineering AI are separate trust domains. Product AI resolves user, organization, company, entitlement, permission, record and field scope before retrieval and constructs only authorized context. Context carries provenance, source identifiers and freshness; hidden or cross-tenant data cannot enter prompts, tools, vector/search results or model-visible caches.

AI never writes ERP business tables directly. Any action is a proposal/tool call into the same public command used by normal product flows and therefore receives identical authorization, validation, concurrency, idempotency, audit, approval and reconciliation checks. Ledger, stock/valuation, payroll/statutory, tax, payment truth, authorization and legal state-transition truth remain deterministic.

High-impact AI uses explicit policy/approval, human-visible proposed changes, reversible execution where possible, audit/provenance, evaluation, rate/cost limits and a kill-switch. Prompt injection, tool abuse, data exfiltration, cross-tenant retrieval, hallucinated authority, unsafe automation and model drift require negative/evaluation tests before release.
