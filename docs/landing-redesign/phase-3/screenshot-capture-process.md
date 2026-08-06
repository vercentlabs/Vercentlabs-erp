# Screenshot Capture Process

## Safety model

All product screenshots on the marketing site are captured from a **dedicated synthetic organization**, never the pre-existing real organization (`id=babdf49c-00ad-4531-a5bd-56437255b2c3`, "VercentLabs", 610 real CRM leads) — that organization was never queried, modified, or touched at any point in this phase.

Two scripts, run once against a local dev instance of the real `apps/web` product and a local Postgres database:

### 1. `apps/landing/scripts/seed-marketing-demo-org.mjs`

Drives the **real product UI** through Playwright (not raw SQL) to:
1. Sign up a new organization ("Vercent Demo Manufacturing") with a randomly-generated, clearly-synthetic email/password.
2. Create master data (items, warehouses) and stock via the real app's own forms.
3. Create CRM leads and an opportunity pipeline, all with fictional company names (Ironclad Industrial Systems, Meridian Fabrication Works, Solstice Tooling Pvt Ltd, Brightedge Engineering Co, Falcon Precision Components, Cascade Metalworks) and fictional contact names — none resembling real companies or people.
4. Create an address, a sales quotation from the seeded opportunity, send it, accept it publicly, and convert it to a sales order.
5. Seed platform roles/users and a procurement supplier/order/receipt cycle.
6. Write credentials to `apps/landing/scripts/.demo-org-credentials.local.md` (gitignored, never committed — confirmed via `git check-ignore -v`).

Guarded by an `assertSafeEnvironment()`-equivalent check refusing to run against anything but `localhost`/`127.0.0.1`.

### 2. `apps/landing/scripts/capture-marketing-screenshots.mjs`

Logs into the seeded org through the real UI (session cookie, not an API token) and captures full-page or targeted-element screenshots of genuine, populated product views at a 1440×900 desktop viewport. **Read-only** — never creates or modifies data. Refuses to run unless `NODE_ENV !== "production"` and the target host is `localhost`/`127.0.0.1`. Saves each capture as PNG (source) and converts to WebP via `sharp` (added as a devDependency for this purpose).

## What was captured, and what was approved

Six views were captured; five are approved for marketing use in `apps/landing/lib/product/screenshots.ts`:

| ID | View | Approved? | Reason |
|---|---|---|---|
| `crm-pipeline-board` | CRM opportunity pipeline (Kanban, 6 stages) | Yes | Clean, polished, module-colored, no exposed internals |
| `crm-leads-list` | CRM leads table (6 records, status/score/value columns) | Yes | Clean, polished |
| `sales-quotation-detail` | Quotation detail — line items, totals, revision history, full audit trail | Yes | Directly substantiates the "immutable audit trail" claim |
| `sales-order-detail` | Sales order detail — governance badges, quantity lifecycle | Yes | Directly substantiates the "governed, gated fulfillment" claim |
| `stock-overview` | Stock overview — on-hand/reserved/value/low-stock | Yes | Clean, though sparse |
| `crm-opportunity-detail` | Opportunity detail page | **No** | Renders ~12 raw internal UUID fields (company/branch/stage/lead/party/contact/owner IDs) with no styling treatment hiding them — reads as an unfinished debug view, not something to show a buying committee. See `decision-log.md` item 2. |

## Registration and wiring

Approved screenshots are registered in `apps/landing/lib/product/screenshots.ts`'s `APPROVED_SCREENSHOTS` array with `approvedForMarketing: true`, real dimensions (read directly from the PNG file headers, not guessed), descriptive `alt` text, and a caption tying the image back to a specific product claim. `getApprovedScreenshot(id)` returns `null` for anything not explicitly approved — the `ProductScreenshot` component (`apps/landing/components/product/product-frame.tsx`) renders nothing on public pages for an unapproved ID, only ever showing the honest "pending approval" placeholder on the noindex `/design-system` route.

The hero (`HERO.screenshotId = "crm-pipeline-board"`) and flagship-workflow section (`FLAGSHIP_WORKFLOW_SECTION.screenshotIds = ["crm-pipeline-board", "sales-quotation-detail", "sales-order-detail"]`) both reference IDs that are now approved, so both sections render their full two-column layout with real product imagery in production — see `homepage-content-specification.md`'s "Conditional layout" section for what happens when a referenced ID is *not* yet approved.

## Verification performed before approval

Every candidate screenshot was visually inspected (not just assumed safe because the seeding script ran without error) before being marked `approvedForMarketing: true`, specifically checking for:
- No real customer names, emails, or identifiers anywhere in frame.
- The synthetic org name ("Vercent Demo Manufacturing") and synthetic user ("Asha Kapoor", Organization Owner) visible in chrome, confirming the capture is from the demo org, not the real one.
- No exposed internal implementation detail that would look unpolished or unintentional (the reason `crm-opportunity-detail` was excluded).

## Known follow-up

The excluded opportunity-detail view represents a real, working product feature — only this specific capture is unsuitable. A cleaner re-capture (or a UI change to hide raw IDs behind a "technical details" disclosure) is a reasonable Phase 4 candidate if a CRM-module page needs an opportunity-detail screenshot. See `phase-4-brief.md`.
