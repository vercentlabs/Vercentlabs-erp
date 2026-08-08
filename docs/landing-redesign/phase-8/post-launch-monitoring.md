# Phase 8 Post-Launch Monitoring Plan

## First 24 hours

| Signal | How to check | Current implementation status |
|---|---|---|
| HTTP availability | Real uptime check against the production domain | Not implemented — the deployment platform's own uptime monitoring (if any) is the actual mechanism; nothing in this repo provides one |
| 5xx errors | Server logs | Lead-delivery 5xx are structurally logged (`lib/lead-observability.ts`); general server 5xx are not — see `analytics-rum-readiness.md`'s disclosed gap |
| Asset failures | Manual spot-check + browser console | Verified clean in this session's testing; ongoing monitoring needs a real log/RUM sink |
| Demo form / CRM delivery | Real submission log entries | Fully implemented (`lead-observability.ts`'s 4-outcome taxonomy) |
| Analytics | Provider dashboard, once wired | Not wired — see `analytics-rum-readiness.md` |
| CSP violations | Browser console / CSP report-uri (none configured) | No `report-uri`/`report-to` CSP directive exists — violations would only surface via manual browser inspection, not an automated report. Not added this phase (would require a real report-collection endpoint, out of scope to invent). |
| Canonical/robots/sitemap | Manual `curl` spot-check against production | No automated ongoing check — `final-route-inventory.md`'s crawl was a one-time verification against this session's local build |

## First 7 days

- **Indexing / Search Console:** once real Search Console access exists (see Phase 7's `search-console-readiness.md`), monitor the Coverage report for unexpected exclusions or errors.
- **Web Vitals / RUM:** once a real provider is wired, this is the first point actual field CWV data becomes possible — compare against Phase 7's lab baseline (`phase-7/baseline-measurements.md`) as an initial lab-vs-field sanity check, not a like-for-like comparison (see `phase-7/performance-methodology.md`'s explicit lab≠field distinction).
- **Lead volume/quality:** first real signal on whether the demo-request funnel is working as intended in production — no historical baseline exists to compare against (day one of real traffic), so this establishes the starting point rather than validating against a prior number.
- **Form completion rate:** `demo_form_start` → `demo_form_success`, once analytics is wired.
- **Broken links / crawl errors:** re-run the same crawl methodology `final-route-inventory.md` used, against the real production domain instead of localhost.

## First 30 days

- **Acquisition channels:** which `utm_source`/referrer categories are actually driving traffic (via the attribution data now flowing into real leads).
- **Organic landing-page performance:** which module/industry/workflow/resource pages are earning organic traffic — the first real validation of Phase 1-6's SEO/AEO/GEO architecture investment.
- **Demo funnel by device:** mobile vs. desktop completion-rate comparison, informed by Phase 7's mobile-conversion work.
- **Field CWV**, if sufficient traffic has accumulated for CrUX/RUM data to be statistically meaningful — explicitly do not draw conclusions from a tiny sample (per the governing brief's own instruction).
- **CRO hypothesis prioritization:** revisit `phase-7/cro-hypothesis-backlog.md`'s H-001/H-002/H-003 now that real traffic could support a genuine experiment (see `phase-7/experiment-framework.md`'s own conclusion that experimentation was premature before real traffic existed).
- **Content discovery / comparison-page traffic:** whether `/compare/vercentlabs-vs-odoo` and the resource/glossary content are actually earning the high-intent traffic they were built for.
- **Requirements-evaluator usage:** whether the interactive checklist tool sees real engagement (no telemetry exists for this today, since its progress state is deliberately never sent to a server — see `cookie-storage-audit.md` — so usage would need to be inferred from page-view analytics alone, once wired).

## What this plan does not do

It does not commit to a specific analytics/RUM/error-monitoring vendor — that remains an open decision per `analytics-rum-readiness.md`. It does not invent metrics or targets that don't yet have a real baseline to measure against — every "first N days" item above is framed as establishing a baseline or checking for problems, not hitting a number that was never actually derived from real data.
