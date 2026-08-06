> Vercentlabs Landing Redesign — Phase 1, Workstream J
> Status: Decided narrative sequence for Prompt 3. This is a blueprint, not implementation — no homepage code is written in this phase.

## The ten questions, answered

1. **What is Vercentlabs?** An operational ERP for growing, multi-location businesses — one system of record across sales, inventory, procurement, production, finance, and people.
2. **Who is it for?** Growing manufacturers, multi-location distributors/retailers, and project-based services businesses that have outgrown accounting-software-plus-spreadsheets (see [[icp-and-buyer-map]]).
3. **What problem does it solve?** The same fact (stock level, project cost, invoice status) exists in multiple disconnected tools and agrees in none of them.
4. **Why is it different?** Genuinely integrated (one data model, one permission/approval layer across 12 modules), not bundled point tools; workflow-first, not form-first; transparent about real scope.
5. **How do the modules work together?** Through real, evidenced cross-module data flow — a sales order really does become a receivable, a requisition really does become a purchase order (see [[product-intelligence]]).
6. **What product evidence exists?** Real product screenshots, annotated per Direction A's treatment (see [[creative-direction]]); no fabricated logos, testimonials, or metrics (Evidence and Honesty Rules).
7. **What outcomes can buyers expect?** Stated in operational terms tied to real capability, never invented percentages — e.g. "see production cost as it happens, not at month-end," not "40% faster close."
8. **How is risk reduced?** A dedicated, specific security section and a named implementation methodology, not vague trust badges.
9. **How is implementation handled?** Addressed honestly and specifically enough to counter the category's #1 objection ("ERPs fail to implement") — full detail lives on `/implementation`, the homepage gives the confidence-building summary.
10. **What should the visitor do next?** Book a Product Demo (primary), or self-route into their module/industry via the module-architecture and industry sections (secondary).

## Section sequence

Sections are ordered to match the message hierarchy in [[positioning-and-messaging]]: five-second → thirty-second → two-minute → (evaluation content lives off-homepage, on module/industry/workflow pages).

### 1. Announcement/context bar
- **Purpose:** orient returning/campaign traffic with one timely, real fact (e.g. a new module release) — never a fake urgency device ("Only 3 spots left").
- **Audience question:** "Is there anything new I should know before I read further?"
- **Message:** one line, dismissible.
- **Copy/visual:** text link only, no imagery.
- **Evidence:** must reference something real and shippable (a real release, a real page) — omitted entirely if nothing genuine exists to say, per Evidence and Honesty Rules. **Candidate for removal at launch** if no real announcement exists yet — do not fabricate one to fill the slot.
- **CTA:** link to the relevant page, not a conversion CTA.
- **Analytics event:** `announcement_bar_click`.
- **Mobile:** collapses to a single-line, dismissible strip.
- **SEO contribution:** none directly; must not push the H1 below the fold on slow connections.

### 2. Navigation
- **Purpose:** wayfinding + persistent primary CTA.
- **Audience question:** "Where can I go from here?"
- **Structure:** per [[information-architecture]] mega-menu (Product, Modules, Industries, Pricing, Resources) + sticky "Book a Demo" button.
- **CTA:** Book a Demo (persistent).
- **Analytics event:** `nav_menu_open`, `nav_link_click` (labeled), `cta_click` (header).
- **Mobile:** accordion nav + bottom-anchored persistent CTA per [[conversion-architecture]].
- **SEO contribution:** primary internal-linking surface; must be crawlable (real `<a>` hrefs, not JS-only routing).

### 3. Hero
- **Purpose:** deliver the five-second message.
- **Audience question:** "What is this, and is it for me?"
- **Message:** headline "The ERP for businesses that outgrew spreadsheets." / subhead "Sales, inventory, procurement, production, and finance — on one live system, from the first order to the balance sheet." (selected in [[positioning-and-messaging]]).
- **Required visual:** a large, real, annotated product screenshot per Direction A (not centered copy over empty space) — the hero *is* the product visual; no separate "product visual" section is needed as a result (see note below).
- **Required product evidence:** the screenshot must be a genuine screen from `apps/web`, not a mockup.
- **CTA:** primary "Book a Demo" + secondary "Watch Product Tour."
- **Analytics event:** `hero_cta_click`, `hero_secondary_cta_click`.
- **Mobile:** screenshot becomes the dominant element, headline/subhead stack above it, CTAs stack full-width below.
- **SEO contribution:** H1 = headline; hero image `alt` text states what the screen shows.

*(Note: the brief lists "Hero" and "Product visual" as separate sections. In Direction A, the product visual **is** the hero — a separate section would duplicate it. Merged deliberately; see [[decision-log]].)*

### 4. Problem framing
- **Purpose:** make the visitor recognise their own operational pain before pitching the solution.
- **Audience question:** "Does this understand my actual problem?"
- **Message:** the "same fact, disconnected tools" framing from [[positioning-and-messaging]], illustrated with 2-3 concrete, ICP-spanning examples (a stock number that disagrees between POS and books; a project that looked profitable but wasn't; a PO issued against stock that wasn't actually there).
- **Required visual:** a simple, real diagram (not stock photography) showing disconnected-tools friction — built in Direction A's line/rectangle vocabulary.
- **CTA:** none (this section's job is recognition, not conversion).
- **Analytics event:** `problem_section_view` (scroll-depth based).
- **Mobile:** examples stack vertically, one per screen-height.
- **SEO contribution:** this copy is a natural home for informational-intent phrasing ("reconciling stock across locations", "project profitability tracking") without keyword-stuffing.

### 5. Connected platform explanation
- **Purpose:** deliver the core differentiator — genuinely integrated, not bundled.
- **Audience question:** "What actually makes this different from buying five separate tools?"
- **Message:** one data model, one permission/approval/audit layer, illustrated by naming the specific shared platform capabilities (see [[product-intelligence]] Shared Platform profile).
- **Required visual:** a structural diagram (modules as colored segments around a shared core), not a stock illustration.
- **Required evidence:** references to real shared-platform features (roles/permissions, approvals, audit trail, module entitlements).
- **CTA:** secondary "Explore the Platform" → `/product/platform`.
- **Analytics event:** `platform_section_cta_click`.
- **Mobile:** diagram simplifies to a stacked list with the same color coding.
- **SEO contribution:** targets "connected ERP platform" / "integrated business software" intent.

### 6. Module architecture
- **Purpose:** let the visitor self-route into their domain.
- **Audience question:** "Where do I go to see what matters to me specifically?"
- **Message:** the 12-module index, grouped per the mega-menu's 5 buyer-facing groups (Revenue, Operations, Finance, People & Service, Delivery).
- **Required visual:** colored index/table-of-contents per Direction A, using real per-module accent tokens (not a generic icon card grid).
- **CTA:** each module links to `/modules/{slug}`.
- **Analytics event:** `module_card_click` (labeled per module).
- **Mobile:** collapses to a vertical grouped list.
- **SEO contribution:** primary internal link fan-out to all 12 module pages.

### 7. Cross-module workflow
- **Purpose:** prove the modules actually talk to each other, concretely.
- **Audience question:** "Show me, don't just tell me, that this is really connected."
- **Message:** one flagship workflow walked through step by step (recommend lead-to-cash or quote-to-order — highest cross-ICP relevance per [[icp-and-buyer-map]]).
- **Required visual:** the horizontal, module-colored pipeline diagram from [[creative-direction]], each step linking to its real annotated screenshot.
- **Required evidence:** the actual route/data connection documented in [[product-intelligence]].
- **CTA:** "See How It Works" → `/workflows/{slug}`.
- **Analytics event:** `workflow_section_cta_click`.
- **Mobile:** pipeline becomes a vertical stepped list.
- **SEO contribution:** targets workflow-informational intent and links to the `/workflows/*` tier.

### 8. Role-based / industry relevance
- **Purpose:** let a specific persona (ops head, CFO, plant manager) or industry see themselves.
- **Audience question:** "Is this built for someone like me, in a business like mine?"
- **Message:** the 3 industry cards (Manufacturing, Distribution & Retail, Professional Services) from [[icp-and-buyer-map]], each with its one-line pain statement.
- **Required visual:** three panels, each anchored by a real screenshot relevant to that industry's flagship modules.
- **CTA:** each card links to `/industries/{slug}`.
- **Analytics event:** `industry_card_click` (labeled).
- **Mobile:** stacked cards, one per screen-height.
- **SEO contribution:** internal link fan-out to the 3 industry pages; supports industry-commercial query intent.

### 9. Security and governance
- **Purpose:** answer the buying committee's risk question before they have to ask it.
- **Audience question:** "Can I trust this with my company's data and controls?"
- **Message:** specific, real controls — role-based permissions, approval workflows, immutable audit trail, multi-company data isolation (see [[product-intelligence]] Shared Platform evidence) — not generic "bank-level security" language.
- **Required visual:** a real screenshot of the audit-log or roles/permissions screen.
- **CTA:** "See the Security Architecture" → `/security`.
- **Analytics event:** `security_section_cta_click`.
- **Mobile:** copy and screenshot stack; no loss of specificity.
- **SEO/AEO contribution:** directly answers "is [category] software secure" intent.

### 10. Implementation
- **Purpose:** directly counter the category's #1 objection.
- **Audience question:** "What happens after we say yes, and will it actually work?"
- **Message:** an honest, specific description of the go-live approach — no invented timelines ("live in 2 weeks!") unless genuinely true and defensible.
- **Required visual:** a simple real-process diagram, not a generic 3-icon "Discover/Design/Deploy" graphic.
- **CTA:** "See the Implementation Approach" → `/implementation`.
- **Analytics event:** `implementation_section_cta_click`.
- **Mobile:** stacks to a numbered list.
- **SEO/AEO contribution:** answers "how long does ERP implementation take" intent directly.

### 11. Final CTA
- **Purpose:** convert every visitor who scrolled this far and hasn't converted yet.
- **Audience question:** "I'm convinced enough to talk — how do I start?"
- **Message:** direct restatement of the promise + a single, unambiguous action.
- **Required visual:** none beyond the form itself — no more product proof needed at this depth.
- **CTA:** Book a Demo (embedded form per [[conversion-architecture]]) + secondary "Talk to an ERP Specialist" framing for buying-committee visitors.
- **Analytics event:** `final_cta_form_start`, `final_cta_form_submit_success/error`.
- **Mobile:** form fields stack full-width, sticky submit button.
- **SEO contribution:** none direct; this is the primary on-page conversion point Search Console/analytics will tie back to organic sessions.

### 12. Footer
- **Purpose:** exhaustive-but-organized wayfinding and trust signals (legal, company info) for visitors who scrolled to the bottom looking for something specific.
- **Audience question:** "Where's the thing I'm looking for that wasn't in the main nav?"
- **Message:** none (utility, not persuasion).
- **Structure:** module list, company/about/legal links, contact info, structured `Organization` data (site-wide, not footer-specific markup).
- **CTA:** secondary Book a Demo link (not primary-styled — avoid CTA fatigue).
- **Analytics event:** `footer_link_click` (labeled).
- **Mobile:** accordion-grouped.
- **SEO contribution:** sitewide internal-linking backstop ensuring no orphan pages (per [[seo-aeo-geo-architecture]]).

## Sections removed from the brief's default list, and why

- **"Product visual" as a section separate from Hero** — merged into Hero. In Direction A the hero *is* a large annotated screenshot; a second, separate "product visual" section immediately after would be redundant and violate the brief's own "remove sections that do not earn their place" instruction.
- **"Trust or product proof" as a standalone section** — not given its own slot. With no real customer logos/testimonials available yet (Evidence and Honesty Rules), a dedicated "trust" section would either be empty or forced to pad with generic claims. Trust is instead distributed through the sections that can carry it honestly: the Security section (real controls), the Cross-module workflow section (real, provable integration), and the product screenshots throughout. Revisit once real customer evidence exists in a later phase.
- **"Automation" and "Reporting and analytics" as separate full sections** — folded into the Connected Platform Explanation section as named capabilities rather than given their own hero-scroll real estate. They are real shared-platform capabilities (workflow engine, reporting framework — see [[product-intelligence]]) but do not carry enough distinct visual/narrative weight to justify a 13th and 14th full-width section on an already-long homepage; they get their own depth on `/product/automation` and `/product/analytics` per the IA instead.
- **"Objection handling" as a separate dedicated section** — distributed inline (Security section handles the risk objection, Implementation section handles the "ERPs fail" objection, Problem Framing implicitly handles "why not just keep using spreadsheets") rather than a single generic FAQ-style block, which tends to read as filler on a homepage; a fuller FAQ treatment belongs on module/industry pages per the AEO architecture.

This leaves 12 sections (down from the brief's ~19-item default list), each earning its place against a specific audience question, per the brief's own instruction to remove sections that don't.
