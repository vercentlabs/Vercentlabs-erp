#!/usr/bin/env bash
set -euo pipefail

log(){ printf '\n[INFO] %s\n' "$*"; }
ok(){ printf '[ OK ] %s\n' "$*"; }
warn(){ printf '[WARN] %s\n' "$*"; }
fail(){ printf '[FAIL] %s\n' "$*" >&2; exit 1; }

command -v git >/dev/null 2>&1 || fail "git is required."
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[[ -n "$ROOT" ]] || fail "Run this from anywhere inside the Vercentlabs ERP Git repository."
cd "$ROOT"

log "Vercentlabs ERP documentation blueprint bootstrap"
printf '[INFO] Repository: %s\n' "$ROOT"

if [[ -d docs && -n "$(find docs -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
  TS="$(date +%Y%m%d-%H%M%S)"
  BACKUP=".blueprint-backups/docs-$TS"
  mkdir -p "$(dirname "$BACKUP")"
  cp -a docs "$BACKUP"
  warn "Existing docs backed up to $BACKUP"
  rm -rf docs
fi

mkdir -p docs

python - <<'PY'
from __future__ import annotations
from pathlib import Path
import csv, re, textwrap, json

root = Path.cwd()
docs = root / "docs"

FEATURE_TEXT = r'''F001|CRM|Leads
F002|CRM|Accounts / companies
F003|CRM|Contacts
F004|CRM|Lead sources
F005|CRM|Lead assignment
F006|CRM|Lead qualification
F007|CRM|Lead stages and statuses
F008|CRM|Duplicate detection
F009|CRM|Opportunities
F010|CRM|Opportunity pipeline
F011|CRM|Probability and expected revenue
F012|CRM|Sales stages
F013|CRM|Calls
F014|CRM|Meetings
F015|CRM|Tasks
F016|CRM|Follow-ups and reminders
F017|CRM|Notes and attachments
F018|CRM|Email history
F019|CRM|Activity timeline
F020|CRM|Territories and sales teams
F021|CRM|Lead import and export
F022|CRM|Lead-to-opportunity conversion
F023|CRM|Opportunity-to-quotation conversion
F024|CRM|Pipeline dashboard
F025|CRM|Sales forecast
F026|CRM|Won / lost reasons
F027|CRM|Basic lead scoring
F028|CRM|Custom fields and tags
F029|CRM|Bulk actions
F030|CRM|CRM reports
F031|Sales|Customer master
F032|Sales|Customer addresses and contacts
F033|Sales|Products and services
F034|Sales|Price lists
F035|Sales|Customer-specific prices
F036|Sales|Quotations
F037|Sales|Quotation versions and revisions
F038|Sales|Quotation expiry
F039|Sales|Discounts
F040|Sales|Taxes
F041|Sales|Approval workflow
F042|Sales|Sales orders
F043|Sales|Order confirmation
F044|Sales|Order amendments
F045|Sales|Availability check
F046|Sales|Stock reservation
F047|Sales|Partial fulfilment
F048|Sales|Backorders
F049|Sales|Delivery and shipment
F050|Sales|Sales invoices
F051|Sales|Partial invoicing
F052|Sales|Advance payments
F053|Sales|Credit limits
F054|Sales|Customer returns
F055|Sales|Credit notes and refunds
F056|Sales|Drop shipping
F057|Sales|Sales commissions
F058|Sales|Payment terms
F059|Sales|Order status tracking
F060|Sales|Sales analytics
F061|Sales|Margin and profitability
F062|Sales|Order-to-cash reporting
F063|Procurement|Supplier master
F064|Procurement|Supplier contacts and addresses
F065|Procurement|Supplier onboarding
F066|Procurement|Supplier categories
F067|Procurement|Purchase requisitions
F068|Procurement|Requisition approvals
F069|Procurement|RFQ creation
F070|Procurement|RFQ to multiple vendors
F071|Procurement|Supplier quotations
F072|Procurement|Bid comparison
F073|Procurement|Supplier selection
F074|Procurement|Purchase orders
F075|Procurement|PO approvals
F076|Procurement|PO amendments
F077|Procurement|Blanket purchase orders
F078|Procurement|Purchase agreements and contracts
F079|Procurement|Supplier price lists
F080|Procurement|Goods receipt / GRN
F081|Procurement|Partial receipts
F082|Procurement|Rejected receipts
F083|Procurement|Purchase returns
F084|Procurement|Supplier invoices
F085|Procurement|2-way matching
F086|Procurement|3-way matching: PO – GRN – Invoice
F087|Procurement|Landed costs
F088|Procurement|Payment terms
F089|Procurement|Supplier performance
F090|Procurement|Supplier rating
F091|Procurement|Supplier lead times
F092|Procurement|Spend analysis
F093|Procurement|Purchase history
F094|Procurement|Reorder-generated purchasing
F095|Procurement|Subcontract purchasing
F096|Procurement|Procurement dashboard
F097|Stock / Inventory|Item master
F098|Stock / Inventory|Item categories
F099|Stock / Inventory|SKUs
F100|Stock / Inventory|Variants
F101|Stock / Inventory|Multiple units of measure
F102|Stock / Inventory|UOM conversions
F103|Stock / Inventory|Warehouses
F104|Stock / Inventory|Warehouse locations and bins
F105|Stock / Inventory|Multi-warehouse inventory
F106|Stock / Inventory|Real-time stock balance
F107|Stock / Inventory|Stock ledger
F108|Stock / Inventory|Goods receipts
F109|Stock / Inventory|Goods issues
F110|Stock / Inventory|Internal transfers
F111|Stock / Inventory|Stock adjustments
F112|Stock / Inventory|Stock reservations
F113|Stock / Inventory|Available stock
F114|Stock / Inventory|Available-to-promise
F115|Stock / Inventory|Batch tracking
F116|Stock / Inventory|Lot tracking
F117|Stock / Inventory|Serial-number tracking
F118|Stock / Inventory|Expiry dates
F119|Stock / Inventory|Barcode scanning
F120|Stock / Inventory|Cycle counting
F121|Stock / Inventory|Physical inventory
F122|Stock / Inventory|Reorder point
F123|Stock / Inventory|Minimum / maximum stock
F124|Stock / Inventory|Safety stock
F125|Stock / Inventory|Automatic replenishment
F126|Stock / Inventory|Negative-stock control
F127|Stock / Inventory|FIFO valuation
F128|Stock / Inventory|Weighted / moving-average valuation
F129|Stock / Inventory|Standard costing
F130|Stock / Inventory|Inventory valuation
F131|Stock / Inventory|Landed cost allocation
F132|Stock / Inventory|Stock aging
F133|Stock / Inventory|Slow-moving inventory
F134|Stock / Inventory|Dead-stock reporting
F135|Stock / Inventory|Picking
F136|Stock / Inventory|Packing
F137|Stock / Inventory|Shipping
F138|Stock / Inventory|Returns
F139|Stock / Inventory|Damaged stock
F140|Stock / Inventory|Quarantine and quality-held stock
F141|Stock / Inventory|Batch / serial traceability
F142|Stock / Inventory|Inventory movement history
F143|Stock / Inventory|Stock reports
F144|Stock / Inventory|Inventory dashboard
F145|Manufacturing|Bill of Materials (BOM)
F146|Manufacturing|Multi-level BOM
F147|Manufacturing|BOM versions
F148|Manufacturing|BOM revisions
F149|Manufacturing|Alternate BOM
F150|Manufacturing|Routings
F151|Manufacturing|Operations
F152|Manufacturing|Work centres
F153|Manufacturing|Machine / work-centre capacity
F154|Manufacturing|Shift calendars
F155|Manufacturing|Manufacturing orders
F156|Manufacturing|Work orders
F157|Manufacturing|Job cards
F158|Manufacturing|Production planning
F159|Manufacturing|MRP
F160|Manufacturing|Material requirements
F161|Manufacturing|Material availability
F162|Manufacturing|Raw-material reservations
F163|Manufacturing|Material issue
F164|Manufacturing|Material consumption
F165|Manufacturing|Backflushing
F166|Manufacturing|Work in progress
F167|Manufacturing|Finished-goods receipt
F168|Manufacturing|Production scheduling
F169|Manufacturing|Labor time
F170|Manufacturing|Machine time
F171|Manufacturing|Setup time
F172|Manufacturing|Scrap
F173|Manufacturing|Waste
F174|Manufacturing|By-products and co-products
F175|Manufacturing|Rework
F176|Manufacturing|Batch manufacturing
F177|Manufacturing|Serial tracking
F178|Manufacturing|Make-to-stock
F179|Manufacturing|Make-to-order
F180|Manufacturing|Subcontract manufacturing
F181|Manufacturing|Production quality inspections
F182|Manufacturing|Production hold
F183|Manufacturing|Production costing
F184|Manufacturing|Standard vs actual costing
F185|Manufacturing|Cost variance
F186|Manufacturing|Yield analysis
F187|Manufacturing|Production efficiency
F188|Manufacturing|Downtime
F189|Manufacturing|Maintenance integration
F190|Manufacturing|Engineering change and revision control
F191|Manufacturing|Production reports
F192|Manufacturing|Production dashboard
F193|Projects|Projects
F194|Projects|Customer projects
F195|Projects|Internal projects
F196|Projects|Project templates
F197|Projects|Work Breakdown Structure (WBS)
F198|Projects|Milestones
F199|Projects|Tasks
F200|Projects|Subtasks
F201|Projects|Task dependencies
F202|Projects|Assignees
F203|Projects|Priority
F204|Projects|Project status
F205|Projects|Gantt chart
F206|Projects|Kanban / task board
F207|Projects|Project calendar
F208|Projects|Resource allocation
F209|Projects|Resource availability
F210|Projects|Timesheets
F211|Projects|Project expenses
F212|Projects|Materials consumed
F213|Projects|Project procurement
F214|Projects|Project budget
F215|Projects|Budget revisions
F216|Projects|Cost tracking
F217|Projects|Revenue tracking
F218|Projects|Fixed-price billing
F219|Projects|Time-and-material billing
F220|Projects|Milestone billing
F221|Projects|Project invoices
F222|Projects|Project profitability
F223|Projects|Cost variance
F224|Projects|Issues
F225|Projects|Risks
F226|Projects|Documents
F227|Projects|Comments and collaboration
F228|Projects|Progress tracking
F229|Projects|Project dashboard
F230|Projects|Project reports
F231|Assets|Asset register
F232|Assets|Asset categories
F233|Assets|Asset identification and code
F234|Assets|Asset location
F235|Assets|Custodian
F236|Assets|Department
F237|Assets|Purchase and capitalization
F238|Assets|Asset creation from procurement
F239|Assets|Asset transfers
F240|Assets|Asset assignment
F241|Assets|Asset movement history
F242|Assets|Asset value
F243|Assets|Useful life
F244|Assets|Salvage value
F245|Assets|Straight-line depreciation
F246|Assets|Declining-balance depreciation
F247|Assets|Units-of-production depreciation
F248|Assets|Depreciation schedule
F249|Assets|Depreciation posting
F250|Assets|Asset revaluation
F251|Assets|Asset impairment
F252|Assets|Asset maintenance
F253|Assets|Preventive maintenance
F254|Assets|Maintenance schedule
F255|Assets|Repair history
F256|Assets|Downtime
F257|Assets|Warranty
F258|Assets|Inspection
F259|Assets|Calibration
F260|Assets|Physical verification and audit
F261|Assets|Barcode / QR identification
F262|Assets|Asset disposal
F263|Assets|Asset sale
F264|Assets|Asset scrap
F265|Assets|Gain / loss on disposal
F266|Assets|Asset accounting integration
F267|Assets|Asset reports
F268|Point of Sale|Stores and outlets
F269|Point of Sale|POS terminals
F270|Point of Sale|Cashiers
F271|Point of Sale|Cashier permissions
F272|Point of Sale|Product search
F273|Point of Sale|Barcode scanning
F274|Point of Sale|Product variants
F275|Point of Sale|Price lists
F276|Point of Sale|Customer selection
F277|Point of Sale|Cart
F278|Point of Sale|Taxes
F279|Point of Sale|Discounts
F280|Point of Sale|Promotions
F281|Point of Sale|Coupons
F282|Point of Sale|Cash payments
F283|Point of Sale|Card payments
F284|Point of Sale|UPI and digital payments
F285|Point of Sale|Split payments
F286|Point of Sale|Multiple payment methods
F287|Point of Sale|Hold / suspend sale
F288|Point of Sale|Resume sale
F289|Point of Sale|Receipt printing
F290|Point of Sale|Invoice generation
F291|Point of Sale|Returns
F292|Point of Sale|Refunds
F293|Point of Sale|Exchanges
F294|Point of Sale|Stock reduction
F295|Point of Sale|Lot / serial support where required
F296|Point of Sale|Real-time inventory
F297|Point of Sale|Offline POS
F298|Point of Sale|Offline-to-online synchronization
F299|Point of Sale|Cash drawer opening balance
F300|Point of Sale|Cash movements
F301|Point of Sale|Shift opening
F302|Point of Sale|Shift closing
F303|Point of Sale|Day-end / Z report
F304|Point of Sale|Payment reconciliation
F305|Point of Sale|POS accounting posting
F306|Point of Sale|Loyalty
F307|Point of Sale|POS sales analytics
F308|Quality|Quality standards
F309|Quality|Inspection specifications
F310|Quality|Quality plans
F311|Quality|Quality control points
F312|Quality|Incoming inspection
F313|Quality|In-process inspection
F314|Quality|Final inspection
F315|Quality|Sampling plans
F316|Quality|Measurement checks
F317|Quality|Pass / fail checks
F318|Quality|Tolerances
F319|Quality|Inspection results
F320|Quality|Defect recording
F321|Quality|Non-conformance / NCR
F322|Quality|Quality hold
F323|Quality|Quality hold must block stock movement
F324|Quality|Hold release
F325|Quality|Disposition
F326|Quality|Rework
F327|Quality|Scrap
F328|Quality|Return to supplier
F329|Quality|Use-as-is approval
F330|Quality|Root-cause analysis
F331|Quality|CAPA
F332|Quality|Corrective actions
F333|Quality|Preventive actions
F334|Quality|Supplier quality
F335|Quality|Customer quality complaints
F336|Quality|Calibration
F337|Quality|Quality audits
F338|Quality|Certificate of Analysis
F339|Quality|Lot / batch traceability
F340|Quality|Quality documents
F341|Quality|Quality cost reporting
F342|Quality|Quality KPI dashboard
F343|Support / Customer Service|Tickets and cases
F344|Support / Customer Service|Ticket number
F345|Support / Customer Service|Customer
F346|Support / Customer Service|Contact
F347|Support / Customer Service|Category
F348|Support / Customer Service|Priority
F349|Support / Customer Service|Status
F350|Support / Customer Service|Queues
F351|Support / Customer Service|Agent assignment
F352|Support / Customer Service|Automatic routing
F353|Support / Customer Service|Email-to-ticket
F354|Support / Customer Service|Web ticket creation
F355|Support / Customer Service|Manual ticket creation
F356|Support / Customer Service|Customer replies
F357|Support / Customer Service|Internal / private notes
F358|Support / Customer Service|Attachments
F359|Support / Customer Service|SLA policies
F360|Support / Customer Service|First-response SLA
F361|Support / Customer Service|Resolution SLA
F362|Support / Customer Service|SLA breach handling
F363|Support / Customer Service|Escalations
F364|Support / Customer Service|Reassignment
F365|Support / Customer Service|Ticket history
F366|Support / Customer Service|Reopen ticket
F367|Support / Customer Service|Merge duplicate tickets
F368|Support / Customer Service|Tags
F369|Support / Customer Service|Knowledge base
F370|Support / Customer Service|Canned responses
F371|Support / Customer Service|Customer portal
F372|Support / Customer Service|Customer order history
F373|Support / Customer Service|Product linkage
F374|Support / Customer Service|Asset linkage
F375|Support / Customer Service|Warranty and service entitlement
F376|Support / Customer Service|CSAT / customer rating
F377|Support / Customer Service|Agent performance
F378|Support / Customer Service|SLA reporting
F379|Support / Customer Service|Ticket dashboards
F380|Support / Customer Service|Complete audit trail
F381|HR & Payroll|Employee master
F382|HR & Payroll|Employee number
F383|HR & Payroll|Departments
F384|HR & Payroll|Designations
F385|HR & Payroll|Reporting manager
F386|HR & Payroll|Branch and location
F387|HR & Payroll|Employment type
F388|HR & Payroll|Employee documents
F389|HR & Payroll|Joining
F390|HR & Payroll|Probation
F391|HR & Payroll|Confirmation
F392|HR & Payroll|Transfers
F393|HR & Payroll|Promotions
F394|HR & Payroll|Separation
F395|HR & Payroll|Offboarding
F396|HR & Payroll|Employee self-service
F397|HR & Payroll|Job openings
F398|HR & Payroll|Candidates
F399|HR & Payroll|Recruitment pipeline
F400|HR & Payroll|Interviews
F401|HR & Payroll|Offers
F402|HR & Payroll|Candidate-to-employee conversion
F403|HR & Payroll|Shifts
F404|HR & Payroll|Attendance
F405|HR & Payroll|Check-in and check-out
F406|HR & Payroll|Late arrival
F407|HR & Payroll|Early exit
F408|HR & Payroll|Overtime
F409|HR & Payroll|Attendance regularization
F410|HR & Payroll|Leave types
F411|HR & Payroll|Leave policies
F412|HR & Payroll|Leave balances
F413|HR & Payroll|Leave accrual
F414|HR & Payroll|Carry-forward
F415|HR & Payroll|Holiday calendars
F416|HR & Payroll|Leave requests
F417|HR & Payroll|Leave approval
F418|HR & Payroll|Salary components
F419|HR & Payroll|Earnings
F420|HR & Payroll|Deductions
F421|HR & Payroll|Salary structures
F422|HR & Payroll|Employee compensation assignment
F423|HR & Payroll|Payroll periods
F424|HR & Payroll|Payroll calculation
F425|HR & Payroll|Attendance-based payroll
F426|HR & Payroll|Joining / separation proration
F427|HR & Payroll|Overtime calculation
F428|HR & Payroll|Bonus
F429|HR & Payroll|Incentives
F430|HR & Payroll|Reimbursements
F431|HR & Payroll|Loans and salary advances
F432|HR & Payroll|Arrears
F433|HR & Payroll|Final settlement
F434|HR & Payroll|Payroll approval
F435|HR & Payroll|Payslips
F436|HR & Payroll|Bank-transfer file
F437|HR & Payroll|Payroll accounting posting
F438|HR & Payroll|Payroll reconciliation
F439|HR & Payroll|Provident Fund (PF)
F440|HR & Payroll|ESIC
F441|HR & Payroll|Professional Tax
F442|HR & Payroll|TDS
F443|HR & Payroll|Labour Welfare Fund where applicable
F444|HR & Payroll|Gratuity
F445|HR & Payroll|Statutory reports
F446|HR & Payroll|State-specific statutory configuration
F447|HR & Payroll|Payroll compliance reports
F448|HR & Payroll|Goals
F449|HR & Payroll|Appraisals
F450|HR & Payroll|Performance reviews
F451|HR & Payroll|Skills
F452|HR & Payroll|Training
F453|Accounting / Finance|Chart of Accounts
F454|Accounting / Finance|General Ledger
F455|Accounting / Finance|Journal entries
F456|Accounting / Finance|Double-entry enforcement
F457|Accounting / Finance|Fiscal years
F458|Accounting / Finance|Accounting periods
F459|Accounting / Finance|Period locks
F460|Accounting / Finance|Cost centres
F461|Accounting / Finance|Departments / financial dimensions
F462|Accounting / Finance|Custom accounting dimensions
F463|Accounting / Finance|Customer invoices
F464|Accounting / Finance|Credit notes
F465|Accounting / Finance|Customer receipts
F466|Accounting / Finance|Payment allocation
F467|Accounting / Finance|Outstanding balances
F468|Accounting / Finance|AR aging
F469|Accounting / Finance|Customer statements
F470|Accounting / Finance|Credit control
F471|Accounting / Finance|Supplier invoices
F472|Accounting / Finance|Debit notes
F473|Accounting / Finance|Supplier payments
F474|Accounting / Finance|Supplier payment allocation
F475|Accounting / Finance|AP aging
F476|Accounting / Finance|Bank accounts
F477|Accounting / Finance|Cash accounts
F478|Accounting / Finance|Bank transactions
F479|Accounting / Finance|Bank reconciliation
F480|Accounting / Finance|Payment reconciliation
F481|Accounting / Finance|Tax codes
F482|Accounting / Finance|Tax calculation
F483|Accounting / Finance|GST
F484|Accounting / Finance|CGST / SGST / IGST
F485|Accounting / Finance|TDS
F486|Accounting / Finance|TCS
F487|Accounting / Finance|Tax reports
F488|Accounting / Finance|Budgets
F489|Accounting / Finance|Budget vs actual
F490|Accounting / Finance|Recurring journals
F491|Accounting / Finance|Accruals
F492|Accounting / Finance|Deferrals and prepayments
F493|Accounting / Finance|Revenue recognition
F494|Accounting / Finance|Multi-currency
F495|Accounting / Finance|Exchange rates
F496|Accounting / Finance|FX gains and losses
F497|Accounting / Finance|Intercompany
F498|Accounting / Finance|Multi-company
F499|Accounting / Finance|Consolidation
F500|Accounting / Finance|Financial close
F501|Accounting / Finance|Trial balance
F502|Accounting / Finance|Profit & Loss
F503|Accounting / Finance|Balance Sheet
F504|Accounting / Finance|Cash Flow Statement
F505|Accounting / Finance|General Ledger report
F506|Accounting / Finance|AR aging report
F507|Accounting / Finance|AP aging report
F508|Accounting / Finance|Cost-centre / dimension reports
F509|Accounting / Finance|Financial dashboards
F510|Accounting / Finance|Audit trail'''

features = []
for line in FEATURE_TEXT.splitlines():
    fid, module, name = line.split('|', 2)
    features.append((fid, module, name))

assert len(features) == 510, len(features)
assert [f[0] for f in features] == [f"F{i:03d}" for i in range(1,511)]
assert len({f[0] for f in features}) == 510

module_defs = [
    ("CRM", "crm", "F001", "F030", 30, "Customer acquisition, relationship management, pipeline and forecasting"),
    ("Sales", "sales", "F031", "F062", 32, "Quote-to-order-to-cash commercial execution"),
    ("Procurement", "procurement", "F063", "F096", 34, "Supplier lifecycle and procure-to-pay execution"),
    ("Stock / Inventory", "stock", "F097", "F144", 48, "Inventory control, warehouse execution, traceability and valuation"),
    ("Manufacturing", "manufacturing", "F145", "F192", 48, "Plan-to-produce, shop-floor execution and manufacturing costing"),
    ("Projects", "projects", "F193", "F230", 38, "Project planning, delivery, resource/cost control and project-to-cash"),
    ("Assets", "assets", "F231", "F267", 37, "Asset lifecycle, maintenance, depreciation and asset-to-books"),
    ("Point of Sale", "point-of-sale", "F268", "F307", 40, "Retail transaction execution, payments, offline resilience and stock/accounting effects"),
    ("Quality", "quality", "F308", "F342", 35, "Inspection, quality holds, NCR/CAPA, traceability and quality analytics"),
    ("Support / Customer Service", "support", "F343", "F380", 38, "Case management, SLAs, routing, customer service and customer 360"),
    ("HR & Payroll", "hr-payroll", "F381", "F452", 72, "Hire-to-retire, time/leave, payroll, compliance and performance"),
    ("Accounting / Finance", "accounting", "F453", "F510", 58, "Financial control, subledgers, tax, close, reporting and auditability"),
]
module_to_slug = {m:s for m,s,*_ in module_defs}

for m, slug, start, end, count, desc in module_defs:
    got = [x for x in features if x[1] == m]
    assert len(got) == count, (m, len(got), count)
    assert got[0][0] == start and got[-1][0] == end


def write(path: Path, content: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(textwrap.dedent(content).lstrip(), encoding="utf-8", newline="\n")


def slugify(name: str) -> str:
    s = name.lower().replace('&', ' and ')
    s = re.sub(r'[^a-z0-9]+', '-', s).strip('-')
    return s[:80] or 'feature'

write(docs / "README.md", """
# Vercentlabs ERP Product & Engineering Blueprint

This directory is the durable source of truth for the F001–F510 enterprise ERP rebuild.

## Rule zero

The 510 canonical F-IDs are traceability identifiers, not implementation folders. Product implementation is organized by coherent business capabilities and public module contracts. The 36 shared-platform requirements remain separate from the 510 and are not assigned new F-IDs.

## Documentation operating model

1. Bootstrap creates all 510 dossiers as **UNSPECIFIED**.
2. Twelve module passes perform research, domain modelling, current-code audit, user-flow design, security/integration design, testing and red-team review.
3. A dossier reaches `SPECIFICATION_READY` only after objective evidence gates pass.
4. Product implementation starts only from approved capability packs and dependency-aware implementation plans.

See `00-program/CURRENT_REBUILD_CHECKPOINT.md` for the current program state.
""")

program_files = {
"PRODUCT_CHARTER.md": """
# Product Charter

## Mission
Build Vercentlabs ERP as an enterprise-grade, integrated SaaS ERP with the canonical F001–F510 scope implemented as advanced, usable capabilities rather than checkbox CRUD screens.

## Product principles
- Business workflows first; F-IDs provide traceability.
- Deterministic controls remain authoritative for finance, payroll, valuation, authorization and state transitions.
- AI assists, recommends, generates or automates only with explicit safety/approval semantics.
- Server-side authorization, tenant isolation, auditability, idempotency and failure recovery are product requirements.
- Desktop, tablet, mobile/responsive, keyboard and accessibility behavior are specified before Product Ready.
- Cross-module side effects occur through public module contracts/orchestration, not private table writes.
""",
"PRODUCT_SCOPE.md": """
# Product Scope

Canonical scope is exactly F001–F510 across 12 modules. The 36 shared-platform requirements are a separate platform baseline and are not counted in the 510.

Every short canonical feature name is a traceability anchor. It does not limit the mature capability expected by an enterprise operator. Each dossier must pass an Omission Gate that asks what a mature user would reasonably expect beyond the literal title.
""",
"SOURCE_OF_TRUTH.md": """
# Source of Truth

Priority order:
1. Canonical F001–F510 register and exact feature names.
2. Approved feature dossiers and capability packs.
3. Approved cross-module journey specifications and architecture decisions.
4. Current source code as implementation evidence, never as an automatic replacement for product requirements.
5. Official vendor/standards research recorded in the benchmark register.

No F511+ identifiers may be invented for canonical product features. Nested requirement IDs use forms such as `F001-FR-001`, `F001-UX-001`, `F001-BR-001`, `F001-SEC-001`, `F001-AI-001`, `F001-INT-001`, and `F001-E2E-001`.
""",
"STATUS_MODEL.md": """
# Status Model

## Specification
`UNSPECIFIED -> RESEARCHING -> DRAFTED -> RED_TEAM_REVIEW -> SPECIFICATION_READY`

## Implementation
`NOT_STARTED -> FOUNDATION -> IMPLEMENTING -> TESTING -> IMPLEMENTED`

## Product readiness
`NOT_READY -> PARTIAL_UI -> FUNCTIONAL_UI -> RESPONSIVE -> UX_HARDENED -> E2E_VERIFIED -> PRODUCT_READY`

`IMPLEMENTED` never implies `PRODUCT_READY`.
""",
"CHANGE_CONTROL.md": """
# Change Control

Changes to canonical IDs, names, module ranges or counts require explicit founder approval and a documented decision. Subrequirements may evolve without changing canonical identity, but all material requirement changes must update traceability, affected capability packs, dependencies, test plans and UAT criteria.
""",
"RISK_REGISTER.md": """
# Risk Register

| Risk | Probability | Impact | Control |
|---|---|---|---|
| Checkbox implementation | High | Critical | Feature dossier + omission gate + capability review |
| AI invents requirements | High | High | Official-source benchmark register + decision rationale |
| Cross-module inconsistency | High | Critical | Journey contracts + orchestration ownership + idempotency |
| Authorization gaps | Medium | Critical | Server-side policy chain + security tests |
| UI-only completeness | High | High | Readiness states separate UI/backend/E2E/UAT |
| Accounting/inventory divergence | Medium | Critical | Ledger ownership + reconciliation + reversal contracts |
| One-person context loss | High | High | Repository checkpoint + decision log + traceability registers |
| Overengineering | Medium | High | REQUIRED/DIFFERENTIATOR/NOT_APPLICABLE benchmark decisions |
""",
"PROGRAM_ROADMAP.md": """
# Program Roadmap

Documentation-first passes:
1. CRM F001–F030
2. Sales F031–F062
3. Procurement F063–F096
4. Stock / Inventory F097–F144
5. Manufacturing F145–F192
6. Projects F193–F230
7. Assets F231–F267
8. Point of Sale F268–F307
9. Quality F308–F342
10. Support / Customer Service F343–F380
11. HR & Payroll F381–F452
12. Accounting / Finance F453–F510

Each pass: research -> domain study -> repo audit -> requirement decomposition -> capability modelling -> journeys/UX -> data/API/security/integration design -> tests/UAT -> red-team review -> specification gate.
""",
"CURRENT_REBUILD_CHECKPOINT.md": """
# Current Rebuild Checkpoint

## Completed
- Documentation governance/bootstrap created.
- Exact canonical F001–F510 dossiers created.
- Module blueprints/capability-pack scaffolds created.
- Cross-module journey contracts scaffolded.
- Standards and traceability registers created.

## Current state
All 510 dossiers are intentionally `UNSPECIFIED`. No autogenerated skeleton is evidence of product completeness.

## Next pass
**Pass 1 — CRM F001–F030 — specification only.**

Required output: official benchmark research, current-code audit, CRM capability architecture, complete F001–F030 enterprise dossiers, CRM cross-module dependencies, gap analysis, red-team review and `SPECIFICATION_READY` evidence.
""",
}
for name, content in program_files.items():
    write(docs / "00-program" / name, content)

standards = {
"PRODUCT_DEFINITION_OF_DONE.md": """
# Product Definition of Done

A feature is Product Ready only when all applicable gates are evidenced: research, requirements, design, domain correctness, server authorization, data integrity, auditability, integration/idempotency, functional UX, responsive behavior, WCAG 2.2 AA intent, failure/recovery behavior, observability, automated tests, browser E2E, and human UAT. Parent capability and critical journey gates must also pass.
""",
"FEATURE_SPEC_STANDARD.md": """
# Feature Specification Standard

Every F-ID dossier must define identity, intent, outcomes, personas/JTBD, benchmark evidence, omission gate, sub-capabilities, functional requirements, business rules, flows, state machine, data model, calculations, UX, search/filter/saved views, create/edit/detail/bulk actions, automation, approvals, notifications, reports/analytics, AI decision, security/scope/field controls, audit, concurrency, idempotency, integrations, API contracts, mobile/offline, responsive/accessibility, performance/observability, edge cases, code audit, gap analysis, implementation map, tests, UAT and objective exit criteria.
""",
"BENCHMARK_RESEARCH_STANDARD.md": """
# Benchmark Research Standard

Prefer current official vendor documentation and primary standards. Record access date, URL/title, capability observed and applicability. Every material benchmark finding receives one decision: `REQUIRED`, `DIFFERENTIATOR`, or `NOT_APPLICABLE` with rationale. Vendor behavior is evidence, not automatic scope.
""",
"DOMAIN_DESIGN_STANDARD.md": """
# Domain Design Standard

Model aggregates, invariants, state machines, commands, queries, events, reversals and ownership explicitly. Cross-module work uses module public contracts/orchestration. Avoid direct writes into another module's private tables. Make transaction boundaries, failure semantics and reconciliation explicit.
""",
"API_STANDARD.md": """
# API Standard

APIs must define command/query intent, authenticated actor and tenant scope, request/response schema, validation, stable error contract, authorization, optimistic concurrency where applicable, idempotency for retryable writes, pagination/filter/sort semantics, audit/outbox effects and version compatibility.
""",
"DATABASE_STANDARD.md": """
# Database Standard

Tenant business data is organization-scoped. Define keys, ownership, constraints, indexes, lifecycle/state constraints, precision/scale, timezone/currency/UOM semantics, soft-delete/archive policy, retention, migrations, RLS where applicable, ledger immutability/reversal patterns and reconciliation invariants.
""",
"SECURITY_STANDARD.md": """
# Security Standard

Authorization is enforced in trusted server-side code. Required scope chain: authentication -> organization -> module entitlement -> permission/role -> company -> branch/location -> record scope -> field/business rule. Add abuse cases, segregation-of-duties where relevant, audit evidence and negative security tests.
""",
"AUDIT_STANDARD.md": """
# Audit Standard

Specify who/what/when/where, before/after values where appropriate, correlation/request ID, source channel, business reason, approval/reversal linkage, tamper resistance, retention and query/report access. Financial/stock/payroll/control-sensitive mutations require deterministic audit evidence.
""",
"INTEGRATION_STANDARD.md": """
# Integration Standard

Every cross-module transition defines trigger, source aggregate, owner, destination command, authorization, validation, transaction boundary, idempotency key, outbox/event, retry/dead-letter behavior, visible state, reversal/compensation and reconciliation.
""",
"UX_STANDARD.md": """
# UX Standard

Specify information architecture, entry points, list/table/work-queue behavior, search/filter/sort, saved views, bulk actions, create/edit/detail workspaces, primary/secondary/destructive actions, keyboard semantics, loading/empty/error/conflict states, permission states and irreversible-action confirmation.
""",
"RESPONSIVE_STANDARD.md": """
# Responsive Standard

Every applicable workflow must define desktop, tablet and mobile behavior. Dense tables require deliberate reflow/card alternatives. Horizontal boards require accessible non-drag alternatives. No critical operation may become unavailable solely because viewport size changes.
""",
"ACCESSIBILITY_STANDARD.md": """
# Accessibility Standard

Target WCAG 2.2 AA intent. Specify semantic structure, labels/instructions, keyboard navigation, focus visibility/order, non-drag alternatives, target sizing, accessible authentication, error identification, status announcements, reduced motion and screen-reader meaningful names.
""",
"AI_PRODUCT_STANDARD.md": """
# AI Product Standard

Classify each feature: `NO_AI`, `AI_ASSIST`, `AI_RECOMMEND`, `AI_GENERATE`, `AI_AUTOMATE_WITH_APPROVAL`, or `AI_AUTOMATE`. Specify data/provenance, confidence, human oversight, permission boundaries, explainability, fallback and audit. AI must not be authoritative for double-entry balancing, payroll/tax calculations, inventory valuation, access control or governed state transitions.
""",
"TESTING_STANDARD.md": """
# Testing Standard

Plan unit/domain tests, database constraints/RLS tests, API contract tests, authorization-negative tests, integration/idempotency/retry tests, browser E2E, responsive/accessibility checks, performance/volume tests, migration tests and reconciliation tests. Tests must cover alternate, exception, reversal and concurrency flows—not only happy paths.
""",
"UAT_STANDARD.md": """
# UAT Standard

Human UAT uses role-based, business-realistic scenarios with prerequisites, exact steps, expected visible state, downstream effects, audit evidence and recovery/reversal checks. Record tester, date, environment, result and evidence. Automated tests do not substitute for final human UAT.
""",
}
for name, content in standards.items():
    write(docs / "01-standards" / name, content)

# Registers
reg = docs / "02-register"
reg.mkdir(parents=True, exist_ok=True)
with (reg / "FEATURE_REGISTER.csv").open("w", encoding="utf-8", newline="") as f:
    w = csv.writer(f)
    w.writerow(["feature_id","module","feature_name","specification_status","implementation_status","product_status","benchmark_status","current_code_status","pass"])
    for fid, module, name in features:
        pass_no = next(i+1 for i,d in enumerate(module_defs) if d[0] == module)
        w.writerow([fid,module,name,"UNSPECIFIED","NOT_STARTED","NOT_READY","PENDING_RESEARCH","UNAUDITED",pass_no])

for fn, header in {
    "SUBREQUIREMENT_REGISTER.csv": ["requirement_id","feature_id","type","statement","status","source","test_evidence"],
    "CAPABILITY_REGISTER.csv": ["capability_id","module","name","feature_ids","status","owner_notes"],
    "DEPENDENCY_REGISTER.csv": ["dependency_id","source_feature_or_capability","target_feature_or_capability","dependency_type","description","status"],
    "BENCHMARK_REGISTER.csv": ["benchmark_id","module","vendor","product","source_title","source_url","accessed_on","finding","decision","rationale","status"],
    "PRODUCT_READINESS_MATRIX.csv": ["feature_id","research","requirements","design","domain","security","implementation","integration","e2e","responsive","accessibility","visual","uat","product_ready"],
}.items():
    with (reg / fn).open("w", encoding="utf-8", newline="") as f:
        csv.writer(f).writerow(header)

# Seed benchmark vendors as research queue.
vendors = {
"CRM": ["Salesforce","Microsoft Dynamics 365 Sales","HubSpot","Zoho CRM","Odoo"],
"Sales": ["Microsoft Dynamics 365","SAP","Oracle","NetSuite","Odoo"],
"Procurement": ["SAP","Oracle Procurement","Microsoft Dynamics 365 SCM","Odoo"],
"Stock / Inventory": ["SAP EWM","Microsoft Dynamics 365 SCM","Oracle Inventory","Odoo"],
"Manufacturing": ["SAP PP","Microsoft Dynamics 365 SCM","Oracle Manufacturing","Odoo"],
"Projects": ["NetSuite SuiteProjects","Microsoft Dynamics 365 Project Operations","SAP","Odoo"],
"Assets": ["SAP Asset Management / FI-AA","Microsoft Dynamics 365","Oracle"],
"Point of Sale": ["Microsoft Dynamics 365 Commerce","Oracle Retail","Odoo POS"],
"Quality": ["SAP QM","Microsoft Dynamics 365 SCM Quality","Oracle Quality","Odoo"],
"Support / Customer Service": ["Salesforce Service Cloud","Microsoft Dynamics 365 Customer Service","ServiceNow","Odoo"],
"HR & Payroll": ["Workday","SAP SuccessFactors","Oracle HCM","Odoo"],
"Accounting / Finance": ["SAP Finance","Oracle Financials","Microsoft Dynamics 365 Finance","NetSuite","Odoo"],
}
with (reg / "BENCHMARK_REGISTER.csv").open("a", encoding="utf-8", newline="") as f:
    w=csv.writer(f); n=1
    for module, vs in vendors.items():
        for vendor in vs:
            w.writerow([f"BM-{n:03d}",module,vendor,"","","","","","","","PENDING_RESEARCH"]); n += 1

with (reg / "PRODUCT_READINESS_MATRIX.csv").open("a", encoding="utf-8", newline="") as f:
    w=csv.writer(f)
    for fid,_,_ in features:
        w.writerow([fid]+["NOT_READY"]*13)

# Module blueprints and capability scaffolds.
for idx, (module, slug, start, end, count, desc) in enumerate(module_defs, start=1):
    mdir = docs / "03-modules" / slug
    fids = [fid for fid,m,_ in features if m == module]
    write(mdir / "MODULE_BLUEPRINT.md", f"""
# {module} Module Blueprint

- Pass: {idx}
- Canonical range: {start}–{end}
- Feature count: {count}
- Product boundary: {desc}
- Specification status: `UNSPECIFIED`

## Pass exit criteria
Research complete; capability map approved; all canonical dossiers in this range fully decomposed; primary/alternate/exception/reversal flows modelled; data/API/security/integration contracts written; desktop/tablet/mobile/accessibility behavior specified; tests/UAT written; current-code gaps mapped; red-team omission review passed.

## Architecture rule
F-IDs are traceability anchors. Implementation should converge on coherent module capabilities and public commands/queries rather than one directory/service per F-ID.
""")
    write(mdir / "capabilities" / "MODULE_CAPABILITY_PACK.md", f"""
# {module} Capability Pack

Status: `TO_BE_MODELLED_IN_PASS_{idx}`

This pack will group sibling F-IDs into operator-facing capabilities without changing canonical identity.

Canonical range: {start}–{end}

Feature IDs: {', '.join(fids)}

## Capability modelling checklist
- operator jobs and personas
- capability boundaries and aggregate ownership
- end-to-end workflows and state machines
- shared list/detail/create/edit experiences
- permissions and segregation of duties
- automation/approval/notification behavior
- reporting/analytics/AI surfaces
- cross-module commands/events
- failure/retry/reversal/reconciliation behavior
""")

# Feature dossier template.
template_sections = """
## 1. Identity and traceability
- Canonical ID: `{fid}`
- Canonical name: **{name}**
- Module: **{module}**
- Specification status: `UNSPECIFIED`
- Implementation status: `NOT_STARTED` (must be replaced by evidence during code audit)
- Product status: `NOT_READY`

## 2. Product intent and measurable outcomes
TBD during module pass.

## 3. Personas, jobs to be done and permissions
TBD.

## 4. Scope, non-goals and assumptions
TBD.

## 5. Benchmark research
Record official-product evidence and classify each finding `REQUIRED`, `DIFFERENTIATOR`, or `NOT_APPLICABLE` with rationale.

### Omission Gate
What would an experienced enterprise operator reasonably expect from **{name}** that the short canonical name does not explicitly say?

## 6. Sub-capabilities and requirements
Use nested traceability IDs such as `{fid}-FR-001`, `{fid}-UX-001`, `{fid}-BR-001`, `{fid}-SEC-001`, `{fid}-AI-001`, `{fid}-INT-001`, `{fid}-E2E-001`.

### Functional requirements
TBD.
### Business rules and calculations
TBD.
### Data requirements
TBD.
### Security requirements
TBD.
### Integration requirements
TBD.

## 7. User journeys
### Primary flow
TBD.
### Alternate flows
TBD.
### Exception/failure flows
TBD.
### Reversal/compensation flows
TBD.
### Recovery/retry flows
TBD.

## 8. Domain model and state machine
Define aggregates/entities, ownership, states, transitions, invariants, commands, events, concurrency and irreversible/reversible actions.

## 9. Data model
Define fields, relationships, required/optional/calculated/system values, keys, constraints, indexes, precision/rounding, timezone/currency/UOM, retention and migration implications.

## 10. UX contract
Define navigation/deep links, list/table/work-queue/board/calendar/Gantt/ledger/dashboard archetypes as applicable, columns, search, filters, sort, pagination, saved views, bulk actions, create, edit, detail/360, related records, loading/empty/error/conflict/permission states.

## 11. Responsive, mobile and accessibility
Define desktop/tablet/mobile behavior, offline/native behavior if applicable, keyboard semantics and WCAG 2.2 AA intent.

## 12. API and service contract
Define public commands/queries, schemas, authorization, validation, stable errors, idempotency, optimistic concurrency, audit/outbox effects and compatibility.

## 13. Automation, approvals, notifications and documents
TBD.

## 14. Reporting, analytics and KPIs
TBD, including drill-down and reconciliation expectations.

## 15. AI opportunity and safeguards
Decision: `UNASSESSED` from `NO_AI | AI_ASSIST | AI_RECOMMEND | AI_GENERATE | AI_AUTOMATE_WITH_APPROVAL | AI_AUTOMATE`.
Define provenance, confidence, permission boundary, human oversight, fallback and audit.

## 16. Security, privacy and audit
Define org/company/branch/record/field scope, segregation-of-duties, abuse cases, audit events and negative authorization tests.

## 17. Reliability, idempotency and observability
Define transaction boundaries, retry keys, duplicate prevention, worker/outbox semantics, metrics/logs/traces, failure visibility and reconciliation.

## 18. Cross-module effects
For every transition define trigger, owner, destination public command, validation, transaction boundary, idempotency, retry/failure, audit/event, visible resulting state, reversal and reconciliation.

## 19. Current-code audit
Map exact files/routes/schema/tests and classify current state. Do not change target requirements to match current implementation.

## 20. Gap analysis and implementation map
TBD after current-code audit.

## 21. Verification plan
### Unit/domain
TBD.
### Database/security
TBD.
### API/integration
TBD.
### Browser E2E
TBD.
### Performance/scale
TBD.
### Human UAT
TBD.

## 22. Definition of Done
All applicable research, requirements, design, domain, security, implementation, integration, E2E, responsive, accessibility, visual and UAT gates have objective evidence; parent capability and critical journeys also pass.

## 23. Open decisions
TBD.
"""

for fid, module, name in features:
    slug = module_to_slug[module]
    path = docs / "03-modules" / slug / "features" / f"{fid}-{slugify(name)}.md"
    write(path, f"# {fid} — {name}\n\n" + template_sections.format(fid=fid,name=name,module=module))

# Shared-platform area stays noncanonical.
write(docs / "04-shared-platform" / "README.md", """
# Shared Platform Requirements

The 36 shared-platform requirements are separate from canonical F001–F510 and must never be renumbered into F511+.

During the documentation program, place approved shared-platform specifications here for identity/tenancy, authorization, billing/entitlements, audit, security, customization, workflows, notifications, files, imports/exports, search, observability, integration/webhooks, localization, accessibility, responsive behavior, mobile/offline and other cross-cutting platform concerns.
""")

journeys = {
"LEAD_TO_CASH.md":"Lead to Cash",
"ORDER_TO_CASH.md":"Order to Cash",
"PROCURE_TO_PAY.md":"Procure to Pay",
"PLAN_TO_PRODUCE.md":"Plan to Produce",
"MANUFACTURING_QUALITY_STOCK.md":"Manufacturing → Quality → Stock",
"POS_TO_CASH.md":"POS to Cash",
"HIRE_TO_PAYROLL_TO_BOOKS.md":"Hire → Payroll → Books",
"ASSET_TO_BOOKS.md":"Asset to Books",
"PROJECT_TO_CASH.md":"Project to Cash",
"SERVICE_TO_RESOLUTION.md":"Service to Resolution",
}
journey_body = """
# {title}

Status: `UNSPECIFIED`

For every transition document:
- trigger and initiating actor/channel
- source aggregate and owning module
- destination public command/query
- permissions and scope
- validations/invariants
- transaction boundary
- idempotency key and duplicate behavior
- outbox/event and async worker behavior
- failure, retry and dead-letter handling
- audit evidence
- visible user state while processing
- resulting records and financial/stock implications
- reversal/compensation path
- reconciliation and exception queue
- automated integration tests and human UAT
"""
for fn,title in journeys.items(): write(docs / "05-cross-module" / fn, journey_body.format(title=title))

for folder in ["06-current-code-audit/latest","07-gap-analysis","08-implementation-plans","09-test-plans","10-uat","scripts"]:
    (docs/folder).mkdir(parents=True, exist_ok=True)
    if not any((docs/folder).iterdir()):
        write(docs/folder/"README.md", f"# {folder}\n\nPopulated during the twelve deep specification passes.\n")

# Inventory
rows=[]
for module,slug,start,end,count,desc in module_defs:
    rows.append(f"| {module} | {start}–{end} | {count} | `03-modules/{slug}/` |")
write(docs / "00-program" / "BLUEPRINT_INVENTORY.generated.md", """
# Blueprint Inventory

| Module | Range | Count | Directory |
|---|---:|---:|---|
""" + "\n".join(rows) + "\n\n**Canonical total: 510.**\n")

# Machine-readable manifest for future agents.
manifest = {
    "canonical_feature_count":510,
    "canonical_first_id":"F001",
    "canonical_last_id":"F510",
    "shared_platform_requirements_are_separate":True,
    "next_pass":{"number":1,"module":"CRM","range":"F001-F030","mode":"SPECIFICATION_ONLY"},
    "module_passes":[{"pass":i+1,"module":d[0],"slug":d[1],"start":d[2],"end":d[3],"count":d[4]} for i,d in enumerate(module_defs)],
}
write(docs / "00-program" / "BLUEPRINT_MANIFEST.json", json.dumps(manifest, indent=2, ensure_ascii=False)+"\n")

print(f"Generated {len(features)} canonical feature dossiers across {len(module_defs)} modules.")
PY

# Self-install the bootstrap for reproducibility when invoked from a file.
mkdir -p docs/scripts
if [[ -f "$0" ]]; then
  cp "$0" docs/scripts/init_product_blueprint.sh 2>/dev/null || true
  chmod +x docs/scripts/init_product_blueprint.sh 2>/dev/null || true
fi

log "Capturing current repository audit metadata"
AUDIT_DIR="docs/06-current-code-audit/latest"
{
  echo "# Current Repository Baseline"
  echo
  echo "Generated: $(date -Iseconds 2>/dev/null || date)"
  echo "Commit: $(git rev-parse HEAD 2>/dev/null || echo UNCOMMITTED)"
  echo "Branch: $(git branch --show-current 2>/dev/null || echo UNKNOWN)"
  echo
  echo "## Working tree"
  echo '```text'
  git status --short || true
  echo '```'
  echo
  echo "## Top-level directories"
  echo '```text'
  find . -maxdepth 2 -type d -not -path './.git*' -not -path './node_modules*' | sort | sed -n '1,250p'
  echo '```'
} > "$AUDIT_DIR/REPOSITORY_BASELINE.md"

# Run repository scripts if they exist; failures become evidence and do not abort docs bootstrap.
run_audit(){
  local label="$1"
  local script="$2"
  local out="$AUDIT_DIR/${label}.log"
  if [[ ! -f package.json ]]; then return 0; fi
  if ! command -v pnpm >/dev/null 2>&1; then
    printf 'pnpm not available; audit skipped.\n' > "$out"
    return 0
  fi
  if node -e "const p=require('./package.json'); process.exit(p.scripts&&p.scripts['$script']?0:1)" >/dev/null 2>&1; then
    log "Audit: pnpm $script"
    set +e
    pnpm "$script" >"$out" 2>&1
    local rc=$?
    set -e
    printf '\nEXIT_CODE=%s\n' "$rc" >> "$out"
    [[ $rc -eq 0 ]] && ok "$script passed" || warn "$script failed; captured in $out"
  else
    printf 'package.json has no script named %s; skipped.\n' "$script" > "$out"
  fi
}

if [[ "${BLUEPRINT_SKIP_AUDIT:-0}" != "1" ]]; then
  run_audit "verify-architecture" "verify:architecture"
  run_audit "lint-web" "lint:web"
  run_audit "test-web" "test:web"
  run_audit "test-api" "test:api"
  if [[ "${BLUEPRINT_AUDIT_LEVEL:-basic}" == "full" ]]; then
    run_audit "verify-db" "verify:db"
    run_audit "typecheck-web" "typecheck:web"
    run_audit "test-sdk" "test:sdk"
    run_audit "test-worker" "test:worker"
    run_audit "test-integration" "test:integration"
    run_audit "test-security" "test:security"
    run_audit "build-web" "build:web"
  fi
else
  warn "Repository command audit skipped by BLUEPRINT_SKIP_AUDIT=1"
fi

log "Validating documentation blueprint"
python - <<'PY'
from pathlib import Path
import csv, json, re, sys
D=Path('docs')
with (D/'02-register/FEATURE_REGISTER.csv').open(encoding='utf-8', newline='') as f:
    rows=list(csv.DictReader(f))
assert len(rows)==510, f"FEATURE_REGISTER rows={len(rows)}"
ids=[r['feature_id'] for r in rows]
assert ids==[f'F{i:03d}' for i in range(1,511)]
assert len(set(ids))==510
files=list((D/'03-modules').glob('*/features/F*.md'))
assert len(files)==510, f"feature dossier files={len(files)}"
for row in rows:
    matches=list((D/'03-modules').glob(f"*/features/{row['feature_id']}-*.md"))
    assert len(matches)==1, (row['feature_id'], len(matches))
    txt=matches[0].read_text(encoding='utf-8')
    assert row['feature_name'] in txt
mods=list((D/'03-modules').glob('*/MODULE_BLUEPRINT.md'))
assert len(mods)==12, len(mods)
manifest=json.loads((D/'00-program/BLUEPRINT_MANIFEST.json').read_text(encoding='utf-8'))
assert manifest['canonical_feature_count']==510
print('PASS: exact F001-F510 register, 510 dossiers, 12 module blueprints.')
PY
ok "Canonical documentation validation passed"

git diff --check -- docs || fail "git diff --check reported documentation whitespace errors."
ok "git diff --check passed"

# Stage only docs. Preserve unrelated staged work by refusing automatic commit if it existed before docs staging.
PRE_STAGED="$(git diff --cached --name-only)"
git add -- docs
ok "Staged docs/**"

if [[ "${BLUEPRINT_SKIP_COMMIT:-0}" == "1" ]]; then
  warn "Commit skipped by BLUEPRINT_SKIP_COMMIT=1"
elif [[ -n "$PRE_STAGED" ]]; then
  warn "Unrelated files were already staged before bootstrap; docs were staged but automatic commit was skipped."
elif git diff --cached --quiet -- docs; then
  ok "No documentation changes to commit"
else
  if [[ -n "${GIT_AUTHOR_NAME:-}" && -n "${GIT_AUTHOR_EMAIL:-}" ]]; then
    export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME" GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
  fi
  if git config user.name >/dev/null 2>&1 && git config user.email >/dev/null 2>&1 || { [[ -n "${GIT_AUTHOR_NAME:-}" ]] && [[ -n "${GIT_AUTHOR_EMAIL:-}" ]]; }; then
    git commit -m "docs: initial product blueprint and feature templates"
    ok "Created documentation checkpoint commit"
  else
    warn "Git identity is not configured. Docs are generated and staged; commit was skipped."
  fi
fi

printf '\n============================================================\n'
printf ' VERCENTLABS ERP DOCUMENTATION BOOTSTRAP COMPLETE\n'
printf '============================================================\n'
printf ' Canonical feature dossiers : 510\n'
printf ' Module blueprints          : 12\n'
printf ' Next documentation pass    : CRM F001-F030\n'
printf ' Next mode                  : SPECIFICATION ONLY\n'
printf ' Checkpoint                 : docs/00-program/CURRENT_REBUILD_CHECKPOINT.md\n'
printf '============================================================\n'
