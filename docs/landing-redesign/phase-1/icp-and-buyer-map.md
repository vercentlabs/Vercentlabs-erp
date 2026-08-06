> Vercentlabs Landing Redesign — Phase 1, Workstream D
> Status: Decided. Supersede only via a new decision entry in `decision-log.md`.

# ICP and Buyer Map

## Candidates evaluated

Eight candidate profiles were evaluated against the ranking criteria (product fit, urgency, ability to demonstrate value, sales feasibility, implementation repeatability, search/content opportunity): growing manufacturers, wholesalers/distributors, multi-location retailers, professional-service organisations, project-based businesses, asset-intensive businesses, businesses replacing spreadsheets, businesses consolidating disconnected systems.

Four were selected as primary. The remaining four are folded in as **secondary relevance** inside the four primary profiles rather than kept as standalone pages — a business "replacing spreadsheets" or "consolidating disconnected systems" is a trigger event, not a distinct industry, and is represented as a cross-cutting objection/angle inside every ICP rather than its own page (avoids thin, overlapping content per Workstream G's anti-cannibalisation rule).

## Ranking

| Rank | ICP | Product fit | Urgency | Demo-ability | Sales feasibility | Implementation repeatability | Search/content opportunity |
|---|---|---|---|---|---|---|---|
| 1 | Growing Manufacturers | High — Manufacturing, Stock, Quality, Procurement, Accounting all engage | High — shop-floor chaos is visible and dated | High — BOM → work order → stock → costing is a concrete visual story | Medium-high — mid-market has budget and a clear buying trigger | Medium — manufacturing has the most process variation | High — "manufacturing ERP" is a well-defined, high-intent query family |
| 2 | Distributors & Multi-Location Retailers | High — Stock, POS, Sales, Procurement, CRM, Accounting | High — stockouts/overstock are a daily, quantifiable cost | High — POS + stock dashboards demo well | High — retail/distribution buyers move fast | High — inventory + POS workflows repeat cleanly across tenants | High — "inventory management software", "multi-location retail ERP" |
| 3 | Project-Based & Professional Services | Medium-high — Projects, CRM, Sales, Accounting, HR & Payroll | Medium — pain is billing leakage and utilisation blindness, less visceral than a stockout | Medium — profitability-per-project story is powerful but more abstract | High — services firms buy on ROI narratives | High — project structures are consistent | Medium-high — competes with point tools (Harvest, monday) on a broader platform argument |
| 4 | Businesses Consolidating Disconnected Systems | Medium — spans everything, hardest to make concrete | Medium — pain accumulates rather than spikes | Low-medium — "one platform instead of eight" is a claim, not a screenshot | Medium — longer, more consultative sales cycle | Medium — every consolidation is a bespoke story | High — large top-of-funnel volume ("replace spreadsheets with ERP", "all-in-one business software") but broad/competitive intent |

Rank 4 is retained as the **homepage and top-of-funnel frame** (the platform-breadth argument), not as a page-level ICP with its own funnel — it recruits traffic that then self-sorts into ranks 1–3.

---

## ICP 1 — Growing Manufacturers

**Company profile:** Discrete or light-process manufacturers, ₹15 Cr–₹300 Cr revenue equivalent, 50–500 employees, 1–5 plants. Currently on a mix of Tally/Excel for accounting and a fragmented shop floor (paper travelers, WhatsApp for production status).

**Operational maturity:** Basic financial discipline exists; production planning and inventory costing are informal. No real-time visibility from BOM to finished-goods cost.

**Locations/teams:** 1–5 facilities, separate purchasing/production/quality/finance teams that don't share a system.

**Existing software environment:** Tally or Zoho Books for accounting, Excel for BOM/production planning, WhatsApp/paper for shop-floor communication, possibly a legacy on-prem ERP (SAP B1, a regional player) that's aging out.

**Core pain points:** No real-time inventory visibility across raw material/WIP/finished goods; production costing is a month-end guess, not a live number; quality holds and rework aren't tracked systematically; procurement and production aren't synchronised, causing both stockouts and excess.

**Trigger events:** A costly stockout or missed customer delivery; an audit or customer (OEM) compliance requirement for traceability; outgrowing the current accounting-only tool; a new plant or product line.

**Buying committee:** Owner/MD (final decision, cares about margin and control), Plant/Operations Head (cares about shop-floor usability), Finance Head/CFO (cares about costing accuracy and audit trail), IT/Ops Manager if one exists (cares about integration and data migration).

**Evaluation criteria:** Can it handle their actual BOM complexity; does the shop floor actually adopt it (usability); does costing update in real time; is data isolated correctly if multi-company; how fast can it go live.

**Objections:** "We tried an ERP before and it failed" (implementation risk); "our processes are too specific"; "our team won't use another system."

**Required evidence:** Real screenshots of BOM → work order → stock ledger flow; a concrete description of the implementation methodology; honest scope statement of what manufacturing capabilities exist today (see [[product-intelligence]] for capability-group-level accuracy — do not claim capacity planning or MRP capabilities that aren't demonstrable).

**Relevant modules:** Manufacturing (primary), Stock, Procurement, Quality, Accounting, Shared Platform (approvals, audit trail).

**Relevant workflows:** Plan-to-production, procure-to-pay, inspection-to-CAPA, inventory-to-replenishment.

**Search behaviour:** "manufacturing ERP software", "ERP for small manufacturers India", "BOM and work order software", "manufacturing inventory management system".

**Best conversion offer:** Book a Product Demo, framed around "see your BOM become a costed work order."

**Qualification criteria:** Has a BOM-driven production process (not pure job-shop/one-off); currently using spreadsheets or an aging point tool for at least one of production/inventory/quality.

---

## ICP 2 — Wholesale Distributors & Multi-Location Retailers

**Company profile:** B2B distributors or retail chains with 3–50 locations/warehouses, ₹10 Cr–₹500 Cr revenue equivalent.

**Operational maturity:** Sales and billing are usually systemised (a POS or basic accounting tool); inventory visibility across locations is the weak point.

**Locations/teams:** Multiple warehouses/stores, central purchasing, per-location sales/POS staff.

**Existing software environment:** A standalone POS system, Tally/QuickBooks for accounting, Excel for stock reconciliation across locations — none of it talking to the others.

**Core pain points:** No single view of stock across locations; can't promise delivery dates confidently; manual reconciliation between POS and books; procurement decisions made on stale data.

**Trigger events:** Opening a new location; a stockout that lost a major account; a failed physical stock count; replacing an end-of-life POS vendor.

**Buying committee:** Owner/Operations Director (final decision), Purchasing Manager (cares about reorder accuracy), Store/Warehouse Managers (cares about day-to-day usability), Accountant (cares about reconciliation).

**Evaluation criteria:** Real-time stock accuracy across locations; POS-to-accounting reconciliation without manual steps; how procurement uses stock data to reorder; multi-location reporting.

**Objections:** "Our POS already works fine" (must show the ERP replaces reconciliation pain, not the checkout screen); "switching locations mid-operation is risky."

**Required evidence:** POS dashboard screenshot, stock ledger across warehouses, procurement-to-replenishment workflow diagram.

**Relevant modules:** Stock, Point of Sale, Sales, Procurement, CRM, Accounting.

**Relevant workflows:** Order-to-fulfilment, inventory-to-replenishment, quote-to-order, lead-to-cash.

**Search behaviour:** "multi-location inventory management software", "retail ERP with POS", "distribution management system", "inventory and billing software for wholesalers".

**Best conversion offer:** Book a Product Demo, framed around "one stock number across every location."

**Qualification criteria:** Operates 3+ locations or warehouses; currently reconciling stock/sales manually across them.

---

## ICP 3 — Project-Based & Professional Services Businesses

**Company profile:** Engineering/EPC contractors, IT services firms, consultancies, or fit-out/interiors businesses running 10–200 concurrent projects, 30–300 employees.

**Operational maturity:** Project delivery is usually tracked in spreadsheets or a lightweight PM tool (monday, Asana); financial tie-back to project profitability is manual and delayed.

**Locations/teams:** Often single HQ with distributed project sites/client teams; project managers, finance, and HR operate separately.

**Existing software environment:** A standalone PM tool for tasks, Excel for budgets/timesheets, Tally/Zoho for accounting, no link between hours logged and project P&L.

**Core pain points:** Don't know which projects are actually profitable until the project is over; timesheet-to-billing is manual and leaky; resource utilisation is a guess; project procurement isn't tied to project budgets.

**Trigger events:** A project that looked profitable but wasn't; scaling past the point where a spreadsheet PM process holds together; a client demanding formal milestone billing and reporting.

**Buying committee:** Managing Partner/Director (final decision, cares about profitability visibility), Project/Delivery Heads (cares about day-to-day PM usability), Finance (cares about billing accuracy and revenue recognition), HR (cares about timesheet/payroll tie-in).

**Evaluation criteria:** Real-time project profitability, not month-end; timesheet-to-invoice automation; resource utilisation reporting; whether it replaces or merely duplicates their existing PM tool.

**Objections:** "We already use [PM tool] and love it" (must reposition as the finance/ops layer underneath, not a PM-tool replacement pitch); "our billing models are too varied (T&M, milestone, retainer)."

**Required evidence:** Project dashboard showing budget vs. actual and utilisation; timesheet-to-billing workflow; a plain statement of which billing models are supported today.

**Relevant modules:** Projects, CRM, Sales, Accounting, HR & Payroll, Support.

**Relevant workflows:** Project planning-to-profitability, quote-to-order, hire-to-retire, ticket-to-resolution.

**Search behaviour:** "project accounting software", "ERP for professional services", "project profitability software", "timesheet to invoice software".

**Best conversion offer:** Book a Product Demo, framed around "see project profitability before the project ends."

**Qualification criteria:** Delivers billable, budgeted projects (not purely internal work); currently disconnects project tracking from financials.

---

## Cross-cutting angle (not a standalone ICP page)

**"Consolidating disconnected systems" / "replacing spreadsheets"** is used as the homepage-level and top-of-funnel framing (five-second message territory — see [[positioning-and-messaging]]) and as a recurring objection-response block on every module and industry page, not as its own `/industries/` entry. Rationale: it describes a trigger condition common to all three ICPs above, not a distinct buyer with distinct workflows — giving it its own page would duplicate intent already served by the homepage and each ICP's pain-point framing.

## How this maps to Information Architecture

Each primary ICP gets one `/industries/{slug}` page (manufacturing, distribution-retail, professional-services) per [[information-architecture]]. Assets-intensive and quality-heavy buying signals (the two candidates folded out) surface as capability call-outs inside the Manufacturing industry page and the Assets/Quality module pages rather than duplicate industry pages.
