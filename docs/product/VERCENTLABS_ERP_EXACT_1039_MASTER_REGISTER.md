# Vercentlabs ERP - Feature Catalogue and Final Sidebar Handoff

**Purpose:** Single source-of-truth handoff for continuing the ERP navigation/UX work in a new chat.

**Prepared:** 8 August 2026

## 1. Product baseline

- Current product scope: **12 business modules plus shared platform services**.
- Working feature baseline used throughout the landing/product work: **1,039 requirements/capabilities**.
- Historical exact master register: **945 module-specific requirements + 94 shared SaaS/platform requirements = 1,039**.
- The exact 945 count in the original master catalogue is fully allocated across the original 11 named modules. **Accounting was added later as the 12th business module and is documented separately.**
- Therefore, keep **1,039 as the current product/marketing baseline**, keep Accounting in the sidebar, and **do not recompute or redistribute the numeric feature total until the master register is formally normalised**.

### Module count reference

| Module | Count / status |
|---|---:|
| CRM | 74 |
| Sales | 76 |
| Accounting | Separate 12th-module scope; count not normalized into original 1,039 register |
| Procurement | 79 |
| Stock and Warehouse Management | 90 |
| HR & Payroll | 108 |
| Support and Customer Service | 75 |
| Quality Management | 77 |
| Point of Sale | 89 |
| Assets | 73 |
| Projects | 86 |
| Manufacturing | 118 |
| Shared SaaS/platform | 94 |

### Shared platform distribution

| Area | Count |
|---|---:|
| SaaS platform | 14 |
| Security and governance | 15 |
| Workflow and automation | 12 |
| Reporting and analytics | 13 |
| Integration | 13 |
| User experience | 15 |
| Data governance | 12 |

## 2. Final visual direction

Use the existing Vercentlabs ERP shell as the visual foundation:

- Dark, compact left sidebar.
- Light top utility bar.
- Large light workspace/canvas.
- Company and branch context selectors in the top bar.
- Global search / Ctrl+K.
- Notifications, security/settings, and profile actions on the right.
- Clean enterprise cards, tables, forms and dashboards.
- One module expanded at a time.
- Sidebar width target: about **248-260 px expanded**; compact rail can be **64-72 px** where supported.

## 3. Final top-level sidebar

```text
WORKSPACE
  Home
  Master Data

MY WORK
  Notifications
  Approvals
  Tasks
  Follow-ups & Reminders
  Exceptions
  Recent Records
  Favourites

MODULES
  CRM
  Sales
  Accounting
  Procurement
  Stock
  Manufacturing
  Projects
  Assets
  Point of Sale
  Quality
  Support
  HR & Payroll

GOVERNANCE
  Billing
  Audit Logs
  Compliance

ADMINISTRATION
  Workspace Settings
  Automation
  Reports & Analytics
  Integrations
  Data Management
  Security

Help & Support
Profile
```

## 4. Navigation rules

1. **Never place individual CRUD/actions in the global sidebar.** Create, edit, delete, archive, approve, reject, print, export, attach, comment, post, reverse, etc. belong inside pages.
2. **Maximum navigation depth: 3 meaningful levels.** Global section/module -> capability/workspace -> page. Finer actions stay in the page.
3. **Only one module expands at a time.**
4. **Role/permission filtering happens before rendering navigation.** Hidden-by-CSS is not sufficient.
5. **Backend authorisation remains mandatory** even when a destination is hidden from the menu.
6. **Settings and reports are separated from daily operational navigation.**
7. **My Work aggregates cross-module approvals, tasks, follow-ups, mentions and exceptions.**
8. **Global search / Ctrl+K is a first-class navigation method** across modules, records, reports, settings and commands.
9. **Favourites and Recent Records reduce repeat navigation.**
10. **Mobile does not replicate the desktop sidebar.** Use drawer + bottom navigation (Home, My Work, Search, Modules, Profile).

## 5. Global areas

### Workspace / Master Data

```text
Home
Master Data
  Overview
  ORGANISATION
    Companies
    Branches
    Departments
    Teams
    Cost Centres
    Locations
  PARTIES
    Customers
    Contacts
    Suppliers
  PRODUCTS
    Items
    Services
    Categories
    Product Variants
    Units of Measure
    Price Lists
  INVENTORY
    Warehouses
    Zones / Bins
  FINANCE
    Currencies
    Taxes
    Payment Terms
  SHARED
    Documents
    Numbering Series
    Import / Export
```

### My Work

```text
Notifications
  All
  Unread
  Mentions
  System Alerts
Approvals
  Pending
  Assigned to Me
  Delegated
  History
Tasks
  My Tasks
  Due Today
  Upcoming
  Overdue
Follow-ups & Reminders
Exceptions
  Workflow Exceptions
  SLA Breaches
  Stock Exceptions
  Quality Holds
  Finance Exceptions
Recent Records
Favourites
```

### Governance

```text
Billing
  Subscription
  Plan
  Usage
  Invoices
  Payments
  Billing Profile
Audit Logs
  Audit Events
  Record History
  User Activity
  Security Events
  Export
Compliance
  Retention
  Consent
  Privacy Requests
  Data Governance
```

### Administration

```text
Workspace Settings
  Overview
  Organisation
  Companies
  Branches
  Departments
  Teams
  Cost Centres
  Branding
  Users
  Invitations
  Roles & Permissions
  Access Scopes
  Sessions
  Authentication
  MFA
  Currencies
  Time Zones
  Languages
  Localisation
  Approval Policies
  Delegation
  Numbering Series
  Retention
  Audit Controls
  Master Data Approval

Automation
  Workflow Builder
  Triggers
  Conditions
  Actions
  Approval Flows
  Scheduled Jobs
  Escalations
  Notifications
  Rules
  Execution History

Reports & Analytics
  Dashboards
  Role Dashboards
  Report Builder
  Saved Views
  Pivot Tables
  Charts
  Scheduled Reports
  Email Delivery
  Exports
  Drill-down
  Cross-Module Analytics
  KPI Targets
  BI Connectors

Integrations
  API Keys / Apps
  REST API
  Webhooks
  OAuth
  Import / Export
  Accounting / Banking
  Payments
  Email / Calendar
  WhatsApp / SMS
  E-Commerce
  Marketplaces
  Shipping / Logistics
  Identity Providers
  Integration Logs
  Retry Queue

Data Management
  Shared Masters
  Duplicate Management
  Validation Rules
  Record Ownership
  Import Templates
  Bulk Update
  Archiving
  Soft Delete
  Retention
  Audit Trail
  Master Approval
  Numbering

Security
  Authentication
  MFA
  Sessions
  Roles
  Permissions
  Record-Level Access
  Field-Level Access
  Company / Branch Scope
  Segregation of Duties
  Maker-Checker
  Audit Evidence
  Security Logs
```

## 6. Final module navigation trees

### CRM

```text
Overview
Customers
  Accounts
  Contacts
  Customer 360
  Segments & Territories
Pipeline
  Leads
  Opportunities
  Pipeline Board
  Forecast
Engagement
  Activities
  Calls
  Meetings
  Emails
  Notes
  Follow-ups
Marketing
  Campaigns
  Target Lists
  Customer Segments
  Journeys
Automation
  Lead Assignment
  Lead Scoring
  Nurture Rules
  Follow-up Sequences
  Workflow Rules
Analytics
  CRM Dashboard
  Lead Conversion
  Source Performance
  Salesperson Performance
  Win / Loss
  Forecasting
Intelligence
  AI Lead Scoring
  Next Best Action
  Churn Prediction
  Sentiment
  Conversation Intelligence
  AI Summaries
  Predictive Forecasting
  Territory Optimisation
  Partners & Resellers
Settings
  CRM Settings
```

### Sales

```text
Overview
Catalogue & Pricing
  Products & Services
  Product Variants
  Price Lists
  Customer Pricing
  Discount Rules
  Promotions
  Taxes
  Commissions
Quotations
  Quotations
  Templates
  Product Configuration
  Bundles & Kits
  Approvals
  Revisions
  Customer Acceptance
Orders
  Sales Orders
  Order Approvals
  Reservations
  Credit Holds
  Backorders
  Recurring Orders
  Make-to-Order
  Drop Ship
Fulfilment
  Pick / Pack / Ship
  Deliveries
  Shipment Tracking
Billing
  Invoice Requests
  Advance Billing
  Partial Billing
  Milestone Billing
  Recurring Billing
Returns
  Returns
  RMA
  Exchanges
  Refunds
  Credit / Debit Notes
Analytics
  Sales Dashboard
  Revenue Analysis
  Margin Analysis
  Targets
  Product Profitability
  Discounts
  Returns
  Customer Retention
  Sales Forecast
Advanced
  CPQ
  Dynamic Pricing
  AI Pricing
  Demand Forecasting
  Contracts
  Subscriptions
  Omnichannel Orders
  Marketplace Orders
  Cross-sell / Upsell
Settings
  Sales Settings
```

### Accounting

```text
Overview
General Ledger
  Chart of Accounts
  Journals
  Journal Entries
  Posting Rules
  Accounting Dimensions
  Fiscal Periods
  Ledger History
Receivables
  Customer Invoices
  Credit Notes
  Receipts
  Allocations
  Open Items
  Customer Statements
  Collections
  AR Ageing
Payables
  Supplier Bills
  Supplier Credit Notes
  Payments
  Payment Runs
  Allocations
  Matching
  Supplier Statements
  AP Ageing
Banking
  Bank Accounts
  Cash Accounts
  Bank Statements
  Reconciliation
  Matching Suggestions
  Suspense
  Bank Charges
Tax & India Compliance
  Tax Configuration
  Tax Ledger
  GST
  GST Returns
  E-Invoice
  E-Way Bill
  TDS
  TCS
  Withholding
  Tax Reports
Fixed Assets
  Asset Register
  Capitalisation
  Depreciation
  Impairment
  Transfers
  Disposal
  Asset Reports
Planning
  Budgets
  Forecasts
  Cash-flow Forecast
  Budget vs Actual
Recurring & Accruals
  Recurring Journals
  Accrual Schedules
  Deferral Schedules
Close
  Period Close
  Close Tasks
  Close Blockers
  Year-End Close
  Retained Earnings
Global Finance
  Foreign Currency
  FX Revaluation
  Intercompany
  Consolidation
Reports
  Trial Balance
  General Ledger
  Journal Register
  Profit & Loss
  Balance Sheet
  Cash Flow
  Receivables
  Payables
  Tax
  Consolidated Reports
Settings
  Accounting Settings
```

### Procurement

```text
Overview
Suppliers
  Suppliers
  Supplier Contacts
  Approved Suppliers
  Supplier Products
  Supplier Price Lists
  Supplier Documents
  Onboarding
  Risk
  Performance
  Supplier Portal
Requisitions
  Purchase Requisitions
  Department Requests
  Catalogue Requests
  Budget Checks
  Approval Queue
  Emergency Purchases
Sourcing
  RFQs
  Supplier Bids
  Bid Comparison
  Technical Evaluation
  Commercial Evaluation
  Negotiations
  Supplier Selection
Purchase Orders
  Purchase Orders
  Service POs
  Blanket POs
  Contract POs
  Scheduled POs
  Drop-Ship POs
  PO Amendments
  Delivery Schedules
Receiving
  Goods Receipts
  Service Receipts
  Partial Receipts
  Rejected Receipts
  Purchase Returns
  Quality Inspection
Invoice Control
  Supplier Invoices
  2-Way Match
  3-Way Match
  Variances
  Duplicate Detection
  Debit Notes
  AP Handoff
Analytics
  Spend Analysis
  Price Variance
  Delivery Performance
  Supplier Quality
  Cycle Time
  Contract Utilisation
  Maverick Spend
  Open PO Ageing
  Savings
  Supplier Concentration
Advanced
  E-Procurement
  Reverse Auctions
  Supplier Risk AI
  Spend Classification AI
  Demand Forecasting
  Auto Reorder-to-PO
  Contract Lifecycle
  Vendor Managed Inventory
  Supplier Collaboration
Settings
  Procurement Settings
```

### Stock & Warehouse

```text
Overview
Items
  Item Master
  Variants
  Units
  Barcodes / QR
  Lots
  Serials
  Expiry
  Reorder Rules
  Valuation Setup
Warehouses
  Warehouses
  Zones
  Aisles
  Racks
  Shelves
  Bins
  Transit Locations
  Quarantine
  Receiving Areas
  Dispatch Areas
Inventory
  Stock Balances
  Goods Receipts
  Goods Issues
  Reservations
  Adjustments
  Opening Stock
  Consignment
  Scrap / Damage
Transfers
  Warehouse Transfers
  Branch Transfers
  Bin Transfers
Warehouse Operations
  Receiving
  Put-away
  Picking
  Wave Picking
  Batch Picking
  Zone Picking
  Packing
  Dispatch
  Cross Dock
  Kitting
  Labels
  Proof of Delivery
Planning
  Min / Max
  Reorder Points
  Safety Stock
  EOQ
  Replenishment
  Demand Forecast
  ATP
  CTP
  Ageing
  Slow Moving
  Dead Stock
  Expiry Alerts
  Cycle Counts
  Physical Counts
  ABC / XYZ
Valuation
  FIFO
  Weighted Average
  Standard Cost
  Specific Identification
  Landed Cost
  Cost Adjustments
  Stock Ledger
  COGS
  Period Reconciliation
Traceability
  Lot Genealogy
  Serial Genealogy
  Supplier-to-Customer Traceability
  Recalls
  Movement History
Analytics
  Inventory Turnover
  Fill Rate
  Stock Accuracy
  Warehouse Productivity
  Picking Accuracy
  Carrying Cost
Advanced
  WMS
  RFID
  IoT Sensors
  Automated Storage
  AI Demand Forecast
  Intelligent Replenishment
  Route / Load Optimisation
  Multi-Echelon Planning
Settings
  Stock Settings
```

### Manufacturing

```text
Overview
Product Engineering
  Bills of Materials
  Multi-Level BOM
  Phantom BOM
  Configurable BOM
  Alternate BOM
  Recipes / Formulas
  By-products
  Co-products
  Routings
  Operations
  Work Centres
  Machines
  Labour Resources
  Engineering Changes
  BOM Versions
  Routing Versions
Planning
  S&OP
  Master Production Schedule
  MRP
  Demand Planning
  Supply Planning
  Capacity Planning
  Finite Scheduling
  Infinite Scheduling
  Production Simulation
Production
  Manufacturing Orders
  Work Orders
  Release / Approval
  Material Reservation
  Material Issue
  Backflush
  Job Cards
  Work Instructions
  Production Reporting
  Partial Completion
  Production Receipt
  Shift Handover
Shop Floor
  Shop Floor
  Work-Centre Queues
  Dispatch Lists
  Operator Assignment
  Machine Status
  Downtime
  Alerts
  Bottlenecks
  OEE
  Digital Instructions
  Drawings / Documents
Materials & Traceability
  Raw Material Issue
  Lots / Serials
  Batch Genealogy
  Component Traceability
  Shelf Life
  WIP
  Production Warehouses
  Substitutions
  Returns
  Scrap Recovery
  Recall Support
Quality & Maintenance
  Incoming Inspection
  In-Process Inspection
  Final Inspection
  Quality Holds
  Non-Conformance
  Rework
  Maintenance Requests
  Preventive Maintenance
  Calibration
Costing
  Standard Cost
  Actual Cost
  Labour Cost
  Machine Overhead
  Material Overhead
  Subcontracting Cost
  By-product Cost
  Cost Roll-up
  Production Variance
  Scrap / Rework Cost
  WIP Valuation
  Manufacturing Profitability
Analytics
  Production Output
  Plan vs Actual
  Capacity Utilisation
  OEE
  Yield
  First-Pass Yield
  Scrap / Rework
  Machine Downtime
  Labour Efficiency
  Cycle Time
  Schedule Adherence
  Cost Variance
  On-Time Completion
Advanced
  APS
  MES
  IoT Machine Connectivity
  Predictive Maintenance
  AI Production Scheduling
  AI Demand Forecasting
  Digital Twins
  Computer Vision Inspection
  Energy Monitoring
  Lean / Kanban
  Industry Process Controls
Settings
  Manufacturing Settings
```

### Projects

```text
Overview
Projects
  Projects
  Templates
  Project Types
  Customers / Contracts
  Teams
  Documents
Planning
  Work Breakdown Structure
  Tasks
  Subtasks
  Milestones
  Dependencies
  Gantt
  Kanban
  Calendar
  Critical Path
  Baselines
  Checklists
  Risks / Issues
Resources
  Resource Requests
  Allocation
  Availability
  Resource Calendar
  Capacity
  Utilisation
  Contractors
  Workload
Time & Expenses
  Timesheets
  Timer
  Mobile Time
  Timesheet Approvals
  Expenses
  Expense Approvals
  Mileage
Financials
  Budgets
  Estimates
  Budget Versions
  Commitments
  Actual Costs
  Forecast-to-Complete
  Estimate-at-Completion
  Profitability
  WIP
  Revenue Recognition
  T&M Billing
  Fixed Billing
  Milestone Billing
  Retainers
  Project Materials
Collaboration & Governance
  Comments
  Mentions
  Files
  Meeting Notes
  Change Requests
  Scope Changes
  Approvals
  Risks
  Issues
  Decision Log
  Customer Portal
  Progress Reports
  Audit History
Analytics
  Budget vs Actual
  Schedule Variance
  Cost Variance
  Earned Value
  Milestones
  Resource Utilisation
  Margin
  Billing / Collections
  Timesheet Compliance
  Portfolio Dashboard
Advanced
  AI Schedule Risk
  AI Project Summary
  Resource Optimisation
  Portfolio Management
  Programme Management
  Scenario Planning
  Construction / Engineering
Settings
  Project Settings
```

### Assets

```text
Overview
Asset Register
  Assets
  Categories
  Classes
  Locations
  Custodians
  Components
  Documents
  Warranty
  Insurance
  Supplier Link
  Asset History
Acquisition & Accounting
  Purchase-to-Asset
  Capital Work in Progress
  Capitalisation
  Depreciation Books
  Revaluation
  Impairment
  Split / Merge
  Disposal
  Gain / Loss
  GL Integration
Maintenance
  Preventive Maintenance
  Corrective Maintenance
  Predictive Maintenance
  Maintenance Requests
  Work Orders
  Breakdowns
  Service Checklists
  Labour & Parts
  Downtime
  Contracts
  Warranty Claims
  Service Providers
Inspection & Calibration
  Inspections
  Safety Checks
  Calibration
  Certificates
  Compliance
  Meter Readings
  Condition Monitoring
  Failure Codes
  Root Cause
Allocation
  Employee Issue
  Returns
  Custody Acknowledgement
  Movement Requests
  Location Transfers
  Temporary Allocation
  Lost / Damaged
  Exit Clearance
Analytics
  Asset Value
  Depreciation
  Utilisation
  Downtime
  Maintenance Cost
  MTBF
  MTTR
  Warranty Expiry
  Replacement Planning
  Total Cost of Ownership
Advanced
  Asset Intelligence
Settings
  Asset Settings
```

### Point of Sale

```text
Overview
Sell
  POS Terminal
  Product Search
  Barcode Scan
  Customer
  Hold / Resume
  Split Bill
  Quotations
  Notes
Payments
  Cash
  Card
  UPI
  QR
  Wallet
  Gift Card
  Store Credit
  Split Payment
  Partial Payment
  Credit Sale
  Refund / Reversal
Store Operations
  Stores
  Counters
  Registers
  Shifts
  Cash Drawer
  Cash In / Out
  Till Reconciliation
  End-of-Day
  Expenses
  Cash Variance
  Offline Sync
Inventory & Fulfilment
  Store Inventory
  Stock Availability
  Lot / Serial
  Expiry
  Transfer Requests
  Click & Collect
  Ship From Store
  Home Delivery
  Fulfilment
  Returns / Exchanges
Customers & Loyalty
  Purchase History
  Loyalty
  Memberships
  Coupons
  Gift Vouchers
  Customer Pricing
  Offers
  Digital Receipts
  Feedback
Hardware
  Receipt Printer
  Barcode Scanner
  Weighing Scale
  Cash Drawer
  Customer Display
  Kitchen Display
  Payment Terminal
  Label Printer
  Fiscal Devices
Analytics
  Store Sales
  Terminal Sales
  Employee Sales
  Hourly / Daily
  Product Mix
  Margin
  Discounts
  Payments
  Returns
  Cash Variance
  Basket Size
  Retention
Advanced
  Restaurant Tables
  Floor Plans
  Kitchen Orders
  Omnichannel Retail
  Self Checkout
  Mobile POS
  Franchise Management
  AI Recommendations
  Store Replenishment
Settings
  POS Settings
```

### Quality

```text
Overview
Quality Setup
  Policies
  Standards
  Inspection Types
  Inspection Plans
  Test Parameters
  Specifications
  Tolerances
  Sampling
  Frequencies
  Checklists
Inspections
  Incoming
  In-Process
  Final
  Pre-Dispatch
  Returns
  First Article
  Asset Inspection
  Ad Hoc
  Mobile Inspection
  Measurements
  Evidence
Non-Conformance
  NCRs
  Defect Categories
  Severity
  Quarantine
  Rework
  Scrap
  Use-As-Is
  Deviations / Concessions
  Approvals
  Cost of Poor Quality
CAPA
  Root Cause
  5 Whys
  Fishbone
  Corrective Actions
  Preventive Actions
  Owners / Deadlines
  Effectiveness
  CAPA Closure
  Recurrence
Supplier & Customer Quality
  Supplier Ratings
  SCAR
  Supplier Audits
  Incoming Defects
  Customer Complaints
  Returns
  Warranty Quality
  Customer Corrective Actions
  Recalls
Compliance
  Audit Planning
  Internal Audits
  External Audits
  Findings
  Compliance Checklists
  Document Control
  ISO Processes
  Calibration
  Competency
  Electronic Approvals
Analytics
  Defect Rate
  First-Pass Yield
  Scrap / Rework
  Supplier Rejection
  Complaint Rate
  Cost of Quality
  CAPA Closure
  Process Capability
  SPC
  Pareto
Advanced
  Statistical Process Control
  AI Defect Prediction
  Image Defect Detection
  IoT Measurements
  Automated Holds
  Product Genealogy
  Compliance Templates
Settings
  Quality Settings
```

### Support

```text
Overview
Tickets
  All Tickets
  My Tickets
  Queues
  Categories
  Priorities
  Statuses
  Linked Tickets
  Attachments
Channels
  Customer Portal
  Email
  Chat
  Phone
  Social
Assignment & Workflow
  Assignment
  Skill Routing
  Round Robin
  Teams / Queues
  Escalation
  Transfers
  Follow-ups
  Scheduled Actions
  Automation
SLA
  SLA Policies
  Business Hours
  Response SLA
  Resolution SLA
  Pause Conditions
  Escalation Levels
  Breaches
Customer Service
  Customer 360
  Product / Asset History
  Warranty
  Entitlements
  Contracts
  Support Plans
  Communication Timeline
  Canned Responses
  Satisfaction
Knowledge
  Internal Knowledge Base
  Public Knowledge Base
  Categories
  Article Approval
  Search
  Related Articles
  FAQs
  Self-Service Portal
  Community
Analytics
  Ticket Volume
  First Response
  Resolution
  First Contact Resolution
  SLA Compliance
  Reopen Rate
  Escalations
  Agent Productivity
  Backlog Ageing
  Satisfaction
  Root Cause
Advanced
  Omnichannel Inbox
  AI Classification
  AI Responses
  AI Summaries
  Chatbot
  Sentiment
  Predictive Escalation
  Field Service
  Remote Support
Settings
  Support Settings
```

### HR & Payroll

```text
Overview
People
  Employees
  Organisation Chart
  Departments
  Designations
  Grades
  Managers
  Work Locations
  Contracts
  Employee Documents
Recruitment
  Manpower Requests
  Jobs
  Career Portal
  Applicants
  Interviews
  Evaluations
  Offers
  Background Checks
  Preboarding
  Onboarding
Attendance
  Shifts
  Rosters
  Attendance
  Biometrics
  Mobile Attendance
  Geo Attendance
  Overtime
  Regularisation
Leave
  Leave Types
  Policies
  Balances
  Accrual
  Carry Forward
  Holiday Calendars
  Leave Requests
  Comp-Off
Payroll
  Salary Structures
  Earnings
  Deductions
  Reimbursements
  Payroll Runs
  Overtime
  Incentives
  Bonus
  Loans
  Advances
  Arrears
  Final Settlement
  Validation
  Approval
  Payslips
  Bank Transfer
  Reconciliation
Statutory - India
  PF
  ESIC
  Professional Tax
  Labour Welfare Fund
  TDS
  Form 16
  Gratuity
  Bonus Act
  State Rules
Employee Self-Service
  My Profile
  Payslips
  Tax Documents
  Leave
  Attendance Corrections
  Expenses
  Loan Requests
  Documents
  Help Requests
Manager Self-Service
  Team Attendance
  Team Leave
  Approvals
  Team Dashboard
Performance & Talent
  Goals
  KPIs
  Reviews
  360 Reviews
  Competencies
  Promotions
  Increments
  Succession
  Learning
  Skill Matrix
  Engagement
  Recognition
  Disciplinary Actions
  Offboarding
Analytics
  Headcount
  Attrition
  Absenteeism
  Payroll Cost
  Department Cost
  Recruitment Funnel
  Time to Hire
  Performance Distribution
  Diversity
  Workforce Planning
Advanced
  AI Resume Screening
  Attrition Prediction
  Workforce Forecast
  AI Job Descriptions
  AI Employee Helpdesk
  Sentiment
  Compensation Benchmarking
Settings
  HR Settings
  Payroll Settings
```

## 7. Sidebar-to-feature mapping principle

The sidebar is not the feature catalogue. It is the navigation layer over the catalogue.

```text
ERP
  -> Global / shared areas
  -> 12 business modules
  -> Capability/workspace pages
  -> Tabs / sections / reports / settings
  -> Individual feature actions
```

Examples:

- `Procurement -> Purchase Orders` contains create/edit/amend/approve/cancel/receive/print/export/audit and related workflows.
- `Manufacturing -> Work Orders` contains release, material reservation, issue, backflush, labour/machine reporting, completion, rework, history and related controls.
- `CRM -> Leads` contains capture, import, assignment, scoring, qualification, conversion, merge, duplicate handling, activity and audit functions.

## 8. Permission-aware rendering

Recommended rendering sequence:

```text
1. Resolve tenant / workspace
2. Resolve enabled modules
3. Resolve current user roles and permissions
4. Load central navigation registry
5. Remove unauthorised destinations
6. Remove empty groups
7. Apply company / branch scope
8. Apply user favourites / recent items
9. Render sidebar
```

Never render unauthorised items and then hide them with CSS.

## 9. Top bar

```text
[ Search records, people and transactions                     Ctrl K ]
[ + Create ] [ Company v ] [ Branch v ] [ Notifications ] [ Settings ] [ Profile ]
```

Global quick-create should expose commonly used actions across modules without creating extra sidebar rows.

## 10. Responsive plan

### Desktop
- Full dark sidebar + top bar + workspace.
- One expanded module at a time.

### Tablet
- Collapsible sidebar / compact rail.
- 2-column dashboards where space allows.

### Mobile
Use a drawer plus a simple bottom bar:

```text
Home | My Work | Search | Modules | Profile
```

Module drawer shows the same capability pages, not every action.

## 11. Implementation data model

Recommended central navigation registry:

```ts
type NavigationItem = {
  id: string;
  label: string;
  icon?: IconKey;
  href?: string;
  module?: ModuleId;
  capability?: CapabilityId;
  permission?: PermissionKey;
  featureFlag?: string;
  children?: NavigationItem[];
};

type ModuleNavigation = {
  moduleId: ModuleId;
  label: string;
  icon: IconKey;
  overviewHref: string;
  items: NavigationItem[];
};
```

Do not hard-code large menus directly in JSX.

## 12. New-chat continuation instructions

When continuing this work in a new chat:

1. Treat this document as the current navigation source of truth.
2. Preserve all existing product features; redesign navigation, not scope.
3. Keep the current dark-sidebar + light-workspace visual language.
4. Implement the central typed navigation registry first.
5. Preserve company/branch context, global search, My Work, governance and administration.
6. Keep Accounting as a first-class module.
7. Do not change the 1,039 baseline until the master feature register is formally normalised to include Accounting numerically.
8. Build module menus from capability/workspace pages; keep row actions inside pages.
9. One module expanded at a time.
10. Validate role-based/permission-based visibility and mobile behaviour before completing the sidebar implementation.

## 13. Source and count governance note

The companion exact master feature catalogue below is the original 1,039-item counting source. It explicitly states that the supplied list at that time contained 11 modules and allocated all 945 module-specific requirements across those 11. Later Vercentlabs product documents establish a 12-module suite that adds Accounting. This handoff intentionally preserves both facts rather than silently changing the historical count.

---

# Appendix A - Exact original 1,039-feature master catalogue

# Vercentlabs SaaS ERP — Master Feature Catalogue

## Counting methodology

- Each actionable checklist item is counted as **one feature requirement**.
- Section headings, explanatory text, and development phases are **not** counted.
- Features repeated in different modules are counted separately because each requires a distinct module implementation and workflow.
- Advanced capabilities are included in the count.
- The supplied module list contains **11 modules**, not 12. This catalogue therefore counts the 11 named modules plus shared SaaS platform capabilities.

## Exact feature count

- **Module-specific feature requirements:** 945
- **Shared SaaS/platform feature requirements:** 94
- **Grand total:** 1039

## Module count summary

| # | Module | Feature count |
|---:|---|---:|
| 1 | CRM | 74 |
| 2 | Sales | 76 |
| 3 | Procurement | 79 |
| 4 | Stock and Warehouse Management | 90 |
| 5 | HR & Payroll | 108 |
| 6 | Support and Customer Service | 75 |
| 7 | Quality Management | 77 |
| 8 | Point of Sale | 89 |
| 9 | Assets | 73 |
| 10 | Projects | 86 |
| 11 | Manufacturing | 118 |
|  | **All 11 modules** | **945** |
|  | **Shared SaaS/platform requirements** | **94** |
|  | **Grand total** | **1039** |

## Shared platform count summary

| Area | Feature count |
|---|---:|
| SaaS platform | 14 |
| Security and governance | 15 |
| Workflow and automation | 12 |
| Reporting and analytics | 13 |
| Integration | 13 |
| User experience | 15 |
| Data governance | 12 |
| **Total** | **94** |

---

# Module feature lists

## 1. CRM — 74 features

### Customer and account management — 10

- [ ] **1.** Company and individual customer records
- [ ] **2.** Contacts linked to accounts
- [ ] **3.** Multiple addresses, locations and communication details
- [ ] **4.** Customer groups, industries, territories and segments
- [ ] **5.** Parent–child company relationships
- [ ] **6.** Complete customer 360° timeline
- [ ] **7.** Customer tags and custom fields
- [ ] **8.** Duplicate detection and record merging
- [ ] **9.** Consent, communication preference and privacy tracking
- [ ] **10.** Customer document and attachment management

### Lead management — 13

- [ ] **11.** Manual lead creation
- [ ] **12.** Website lead-capture forms
- [ ] **13.** API-based lead capture
- [ ] **14.** Email-to-lead conversion
- [ ] **15.** Lead import from CSV/Excel
- [ ] **16.** Lead source and campaign tracking
- [ ] **17.** Lead assignment by territory, product, workload or round-robin
- [ ] **18.** Lead qualification workflow
- [ ] **19.** Lead scoring
- [ ] **20.** Lead nurturing stages
- [ ] **21.** Lead conversion into account, contact and opportunity
- [ ] **22.** Duplicate lead prevention
- [ ] **23.** Lost and disqualified lead reasons

### Opportunity and pipeline management — 12

- [ ] **24.** Custom sales pipelines
- [ ] **25.** Configurable opportunity stages
- [ ] **26.** Opportunity value and probability
- [ ] **27.** Expected closing date
- [ ] **28.** Products and services linked to opportunities
- [ ] **29.** Competitor tracking
- [ ] **30.** Stakeholder and decision-maker tracking
- [ ] **31.** Next action and follow-up scheduling
- [ ] **32.** Opportunity history
- [ ] **33.** Win/loss analysis
- [ ] **34.** Pipeline velocity
- [ ] **35.** Weighted revenue forecast

### Activities and communication — 10

- [ ] **36.** Tasks, calls, meetings and reminders
- [ ] **37.** Email integration and email templates
- [ ] **38.** Email open and click tracking
- [ ] **39.** Calendar integration
- [ ] **40.** Notes and internal comments
- [ ] **41.** WhatsApp/SMS integration
- [ ] **42.** Call logging and recording integration
- [ ] **43.** Activity automation
- [ ] **44.** Team mentions and collaboration
- [ ] **45.** Mobile activity capture

### Campaigns and automation — 10

- [ ] **46.** Marketing campaign records
- [ ] **47.** Campaign members and target lists
- [ ] **48.** Customer segmentation
- [ ] **49.** Drip campaigns
- [ ] **50.** Automated follow-up sequences
- [ ] **51.** Campaign cost and revenue attribution
- [ ] **52.** Lead-scoring rules
- [ ] **53.** Workflow automation
- [ ] **54.** Trigger-based notifications
- [ ] **55.** Customer journey tracking

### CRM analytics — 10

- [ ] **56.** Lead conversion dashboard
- [ ] **57.** Sales pipeline dashboard
- [ ] **58.** Lead-source performance
- [ ] **59.** Salesperson performance
- [ ] **60.** Win/loss reporting
- [ ] **61.** Customer acquisition cost
- [ ] **62.** Customer lifetime value
- [ ] **63.** Sales forecasting
- [ ] **64.** Inactive customer reporting
- [ ] **65.** AI-generated account and opportunity summaries

### Advanced — 9

- [ ] **66.** AI lead scoring
- [ ] **67.** AI next-best-action recommendations
- [ ] **68.** Churn prediction
- [ ] **69.** Sentiment analysis
- [ ] **70.** Conversation intelligence
- [ ] **71.** Automatic email and call summarisation
- [ ] **72.** Predictive opportunity forecasting
- [ ] **73.** Territory optimisation
- [ ] **74.** Partner and reseller relationship management

---

## 2. Sales — 76 features

### Product and commercial setup — 13

- [ ] **1.** Product and service catalogue
- [ ] **2.** Product variants
- [ ] **3.** Units of measure
- [ ] **4.** Price lists
- [ ] **5.** Customer-specific pricing
- [ ] **6.** Quantity-based pricing
- [ ] **7.** Contract pricing
- [ ] **8.** Promotional pricing
- [ ] **9.** Discount rules
- [ ] **10.** Tax-inclusive and tax-exclusive pricing
- [ ] **11.** Multi-currency pricing
- [ ] **12.** Sales territories and channels
- [ ] **13.** Sales commission rules

### Quotation management — 14

- [ ] **14.** Quotation creation
- [ ] **15.** Quotation templates
- [ ] **16.** Product configuration
- [ ] **17.** Bundles and kits
- [ ] **18.** Optional products
- [ ] **19.** Terms and conditions
- [ ] **20.** Taxes, freight and additional charges
- [ ] **21.** Quotation revisions and version control
- [ ] **22.** Internal quotation approval
- [ ] **23.** Customer quotation portal
- [ ] **24.** Electronic acceptance
- [ ] **25.** E-signature integration
- [ ] **26.** Quote expiry and reminders
- [ ] **27.** Quote-to-order conversion

### Sales order management — 17

- [ ] **28.** Sales order creation
- [ ] **29.** Customer purchase-order references
- [ ] **30.** Inventory availability checking
- [ ] **31.** Stock reservation
- [ ] **32.** Credit-limit checking
- [ ] **33.** Order approval
- [ ] **34.** Partial fulfilment
- [ ] **35.** Split deliveries
- [ ] **36.** Backorders
- [ ] **37.** Drop shipping
- [ ] **38.** Direct delivery
- [ ] **39.** Make-to-order processing
- [ ] **40.** Order amendments
- [ ] **41.** Order cancellation
- [ ] **42.** Recurring and subscription orders
- [ ] **43.** Order holds
- [ ] **44.** Sales order audit history

### Fulfilment and billing — 14

- [ ] **45.** Pick, pack and ship integration
- [ ] **46.** Delivery notes
- [ ] **47.** Shipment tracking
- [ ] **48.** Partial invoicing
- [ ] **49.** Advance invoicing
- [ ] **50.** Milestone invoicing
- [ ] **51.** Recurring billing
- [ ] **52.** Credit and debit notes
- [ ] **53.** Returns and exchanges
- [ ] **54.** Return merchandise authorisation
- [ ] **55.** Refund processing
- [ ] **56.** Warranty linkage
- [ ] **57.** Revenue recognition integration
- [ ] **58.** Customer outstanding balance visibility

### Sales analytics — 10

- [ ] **59.** Revenue by customer, product and salesperson
- [ ] **60.** Gross-margin analysis
- [ ] **61.** Sales target tracking
- [ ] **62.** Order fulfilment performance
- [ ] **63.** Average order value
- [ ] **64.** Discount analysis
- [ ] **65.** Product profitability
- [ ] **66.** Return and cancellation analysis
- [ ] **67.** Sales forecast
- [ ] **68.** Customer retention and repeat-sales reporting

### Advanced — 8

- [ ] **69.** CPQ: configure, price and quote
- [ ] **70.** Dynamic pricing
- [ ] **71.** AI pricing recommendations
- [ ] **72.** Sales demand forecasting
- [ ] **73.** Contract and subscription management
- [ ] **74.** Omnichannel order management
- [ ] **75.** Marketplace order integration
- [ ] **76.** Automated cross-sell and upsell recommendations

---

## 3. Procurement — 79 features

### Supplier management — 13

- [ ] **1.** Supplier master records
- [ ] **2.** Supplier contacts and locations
- [ ] **3.** Supplier categories
- [ ] **4.** Approved supplier lists
- [ ] **5.** Supplier products and price lists
- [ ] **6.** Payment and delivery terms
- [ ] **7.** Tax and banking information
- [ ] **8.** Supplier documents and certifications
- [ ] **9.** Supplier onboarding
- [ ] **10.** Supplier portal
- [ ] **11.** Supplier performance scorecards
- [ ] **12.** Supplier risk classification
- [ ] **13.** Supplier blacklisting and suspension

### Purchase requisitions — 10

- [ ] **14.** Employee purchase requests
- [ ] **15.** Department and cost-centre requisitions
- [ ] **16.** Catalogue and non-catalogue requests
- [ ] **17.** Budget availability checks
- [ ] **18.** Multi-level approval workflow
- [ ] **19.** Delegated approvals
- [ ] **20.** Requisition-to-RFQ conversion
- [ ] **21.** Requisition-to-PO conversion
- [ ] **22.** Requisition tracking
- [ ] **23.** Emergency purchases

### Sourcing and RFQ — 10

- [ ] **24.** Request for quotation
- [ ] **25.** Multi-supplier RFQs
- [ ] **26.** Supplier bid submission
- [ ] **27.** Bid comparison
- [ ] **28.** Technical and commercial evaluation
- [ ] **29.** Weighted supplier evaluation
- [ ] **30.** Negotiation records
- [ ] **31.** Supplier selection approval
- [ ] **32.** RFQ-to-purchase-order conversion
- [ ] **33.** Sourcing event audit trail

### Purchase orders — 13

- [ ] **34.** Standard purchase orders
- [ ] **35.** Service purchase orders
- [ ] **36.** Blanket purchase orders
- [ ] **37.** Contract purchase orders
- [ ] **38.** Scheduled purchase orders
- [ ] **39.** Drop-ship purchase orders
- [ ] **40.** Purchase-order amendments
- [ ] **41.** PO approval workflow
- [ ] **42.** Advance-payment terms
- [ ] **43.** Landed-cost estimates
- [ ] **44.** Delivery schedule management
- [ ] **45.** PO acknowledgement
- [ ] **46.** Supplier communication history

### Receiving and invoicing — 14

- [ ] **47.** Goods receipt notes
- [ ] **48.** Service receipt confirmation
- [ ] **49.** Partial receipts
- [ ] **50.** Over-receipt and under-receipt tolerances
- [ ] **51.** Rejected and quarantined receipts
- [ ] **52.** Lot and serial capture
- [ ] **53.** Quality inspection integration
- [ ] **54.** Purchase returns
- [ ] **55.** Supplier invoice recording
- [ ] **56.** Two-way and three-way matching
- [ ] **57.** Price and quantity variance handling
- [ ] **58.** Duplicate invoice detection
- [ ] **59.** Debit notes
- [ ] **60.** Accounts-payable integration

### Procurement analytics — 10

- [ ] **61.** Spend by supplier and category
- [ ] **62.** Purchase-price variance
- [ ] **63.** Supplier delivery performance
- [ ] **64.** Supplier quality performance
- [ ] **65.** Procurement cycle time
- [ ] **66.** Contract utilisation
- [ ] **67.** Maverick spending
- [ ] **68.** Open-PO ageing
- [ ] **69.** Savings tracking
- [ ] **70.** Supplier dependency and concentration

### Advanced — 9

- [ ] **71.** E-procurement catalogues
- [ ] **72.** Reverse auctions
- [ ] **73.** AI supplier-risk monitoring
- [ ] **74.** AI spend classification
- [ ] **75.** Procurement demand forecasting
- [ ] **76.** Automatic reorder-to-PO conversion
- [ ] **77.** Contract lifecycle management
- [ ] **78.** Vendor-managed inventory
- [ ] **79.** Supplier collaboration portal

---

## 4. Stock and Warehouse Management — 90 features

### Product and inventory master — 12

- [ ] **1.** Stock items, non-stock items and services
- [ ] **2.** Product variants
- [ ] **3.** Units of measure and conversions
- [ ] **4.** Barcodes and QR codes
- [ ] **5.** Lot-controlled products
- [ ] **6.** Serial-controlled products
- [ ] **7.** Expiry-controlled products
- [ ] **8.** Product dimensions and weight
- [ ] **9.** Storage requirements
- [ ] **10.** Reorder rules
- [ ] **11.** Inventory valuation method
- [ ] **12.** Product images and documents

### Warehouse structure — 8

- [ ] **13.** Multiple companies
- [ ] **14.** Multiple warehouses
- [ ] **15.** Zones, aisles, racks, shelves and bins
- [ ] **16.** Virtual and transit locations
- [ ] **17.** Receiving and dispatch areas
- [ ] **18.** Quarantine and damaged-stock locations
- [ ] **19.** Location capacity limits
- [ ] **20.** Location-based access control

### Inventory transactions — 13

- [ ] **21.** Goods receipt
- [ ] **22.** Goods issue
- [ ] **23.** Warehouse transfer
- [ ] **24.** Inter-branch transfer
- [ ] **25.** Bin-to-bin movement
- [ ] **26.** Stock reservation
- [ ] **27.** Stock adjustment
- [ ] **28.** Inventory opening balance
- [ ] **29.** Customer and supplier consignment stock
- [ ] **30.** Free-of-charge inventory
- [ ] **31.** Scrap and damaged inventory
- [ ] **32.** Samples and promotional stock
- [ ] **33.** Stock ownership tracking

### Warehouse operations — 13

- [ ] **34.** Receiving and put-away
- [ ] **35.** Rule-based put-away
- [ ] **36.** Picking lists
- [ ] **37.** Wave, batch and zone picking
- [ ] **38.** Packing
- [ ] **39.** Shipping and dispatch
- [ ] **40.** Cross-docking
- [ ] **41.** Kitting and un-kitting
- [ ] **42.** Barcode scanner support
- [ ] **43.** Mobile warehouse application
- [ ] **44.** Packing labels and shipping labels
- [ ] **45.** Courier and transporter integration
- [ ] **46.** Proof of delivery

### Inventory planning and control — 16

- [ ] **47.** Minimum and maximum stock levels
- [ ] **48.** Reorder points
- [ ] **49.** Safety stock
- [ ] **50.** Economic order quantity
- [ ] **51.** Automatic replenishment
- [ ] **52.** Demand forecasting
- [ ] **53.** Available-to-promise
- [ ] **54.** Capable-to-promise
- [ ] **55.** Inventory ageing
- [ ] **56.** Slow-moving and non-moving stock
- [ ] **57.** Dead-stock identification
- [ ] **58.** Expiry alerts
- [ ] **59.** FEFO, FIFO and LIFO picking rules
- [ ] **60.** Cycle counting
- [ ] **61.** Physical stock count
- [ ] **62.** ABC and XYZ classification

### Costing and valuation — 10

- [ ] **63.** FIFO
- [ ] **64.** Weighted average
- [ ] **65.** Standard costing
- [ ] **66.** Specific identification
- [ ] **67.** Landed-cost allocation
- [ ] **68.** Inventory valuation reports
- [ ] **69.** Cost adjustments
- [ ] **70.** Stock ledger
- [ ] **71.** Cost-of-goods-sold integration
- [ ] **72.** Period closing and stock reconciliation

### Traceability and analytics — 10

- [ ] **73.** Complete lot and serial genealogy
- [ ] **74.** Supplier-to-customer traceability
- [ ] **75.** Recall management
- [ ] **76.** Stock movement history
- [ ] **77.** Inventory turnover
- [ ] **78.** Fill rate
- [ ] **79.** Stock accuracy
- [ ] **80.** Warehouse productivity
- [ ] **81.** Picking accuracy
- [ ] **82.** Inventory carrying cost

### Advanced — 8

- [ ] **83.** Warehouse management system capabilities
- [ ] **84.** RFID integration
- [ ] **85.** IoT sensor integration
- [ ] **86.** Automated storage integration
- [ ] **87.** AI demand forecasting
- [ ] **88.** Intelligent replenishment
- [ ] **89.** Route and load optimisation
- [ ] **90.** Multi-echelon inventory planning

---

## 5. HR & Payroll — 108 features

### Core HR — 14

- [ ] **1.** Employee master records
- [ ] **2.** Employee numbers and employment status
- [ ] **3.** Departments, designations and grades
- [ ] **4.** Organisation hierarchy
- [ ] **5.** Reporting managers
- [ ] **6.** Branches and work locations
- [ ] **7.** Employment contracts
- [ ] **8.** Probation and confirmation
- [ ] **9.** Employee document management
- [ ] **10.** Qualification and experience records
- [ ] **11.** Dependants and emergency contacts
- [ ] **12.** Bank, tax and statutory information
- [ ] **13.** Employee lifecycle history
- [ ] **14.** Custom employee fields

### Recruitment and onboarding — 13

- [ ] **15.** Manpower requisition
- [ ] **16.** Job openings
- [ ] **17.** Career portal
- [ ] **18.** Applicant tracking
- [ ] **19.** Interview scheduling
- [ ] **20.** Candidate evaluation
- [ ] **21.** Offer-letter generation
- [ ] **22.** Background-verification tracking
- [ ] **23.** Preboarding checklist
- [ ] **24.** Employee onboarding workflow
- [ ] **25.** Document collection
- [ ] **26.** Asset and access assignment
- [ ] **27.** Induction and training

### Attendance and leave — 14

- [ ] **28.** Shift management
- [ ] **29.** Rosters and scheduling
- [ ] **30.** Biometric integration
- [ ] **31.** Web and mobile attendance
- [ ] **32.** Geo-tagged attendance
- [ ] **33.** Overtime calculation
- [ ] **34.** Late arrival and early departure rules
- [ ] **35.** Leave types and policies
- [ ] **36.** Leave balances
- [ ] **37.** Accrual and carry-forward
- [ ] **38.** Holiday calendars
- [ ] **39.** Leave approval workflow
- [ ] **40.** Compensatory leave
- [ ] **41.** Attendance regularisation

### Payroll — 18

- [ ] **42.** Salary structures
- [ ] **43.** Earnings, deductions and reimbursements
- [ ] **44.** Payroll periods
- [ ] **45.** Proration
- [ ] **46.** Overtime and incentive calculations
- [ ] **47.** Bonus and commission processing
- [ ] **48.** Loans and salary advances
- [ ] **49.** Arrears and retroactive payroll
- [ ] **50.** Final settlement
- [ ] **51.** Payroll validation
- [ ] **52.** Payroll approval
- [ ] **53.** Payslip generation
- [ ] **54.** Bank-transfer files
- [ ] **55.** Payroll accounting entries
- [ ] **56.** Payroll reconciliation
- [ ] **57.** Employee tax declarations
- [ ] **58.** Country-specific tax and labour compliance
- [ ] **59.** Statutory reports and filings

### India-first statutory payroll — 9

- [ ] **60.** Provident Fund (PF)
- [ ] **61.** Employees' State Insurance Corporation (ESIC)
- [ ] **62.** Professional Tax
- [ ] **63.** Labour Welfare Fund
- [ ] **64.** Tax Deducted at Source (TDS)
- [ ] **65.** Form 16
- [ ] **66.** Gratuity
- [ ] **67.** Bonus Act requirements
- [ ] **68.** State-specific payroll rules

### Employee self-service — 11

- [ ] **69.** Employee profile
- [ ] **70.** Payslips
- [ ] **71.** Tax documents
- [ ] **72.** Leave requests
- [ ] **73.** Attendance corrections
- [ ] **74.** Expense claims
- [ ] **75.** Loan requests
- [ ] **76.** Document downloads
- [ ] **77.** Help requests
- [ ] **78.** Manager self-service
- [ ] **79.** Team attendance and approval dashboards

### Performance and talent — 12

- [ ] **80.** Goal and KPI management
- [ ] **81.** Performance review cycles
- [ ] **82.** Self, manager and 360° reviews
- [ ] **83.** Competency management
- [ ] **84.** Promotion and increment workflows
- [ ] **85.** Succession planning
- [ ] **86.** Training and learning records
- [ ] **87.** Skill matrix
- [ ] **88.** Employee engagement surveys
- [ ] **89.** Recognition and rewards
- [ ] **90.** Disciplinary action tracking
- [ ] **91.** Exit and offboarding

### HR analytics — 10

- [ ] **92.** Headcount
- [ ] **93.** Attrition
- [ ] **94.** Absenteeism
- [ ] **95.** Payroll cost
- [ ] **96.** Department-wise workforce cost
- [ ] **97.** Recruitment funnel
- [ ] **98.** Time-to-hire
- [ ] **99.** Performance distribution
- [ ] **100.** Diversity metrics
- [ ] **101.** Workforce planning

### Advanced — 7

- [ ] **102.** AI résumé screening
- [ ] **103.** Employee attrition prediction
- [ ] **104.** Workforce-demand forecasting
- [ ] **105.** AI job-description generation
- [ ] **106.** AI employee helpdesk
- [ ] **107.** Sentiment analysis
- [ ] **108.** Compensation benchmarking

---

## 6. Support and Customer Service — 75 features

### Ticket management — 15

- [ ] **1.** Ticket creation by agent
- [ ] **2.** Customer portal tickets
- [ ] **3.** Email-to-ticket
- [ ] **4.** Chat-to-ticket
- [ ] **5.** Phone and call-centre integration
- [ ] **6.** Social-channel ticket integration
- [ ] **7.** Ticket categories and subcategories
- [ ] **8.** Priorities and severity
- [ ] **9.** Ticket statuses
- [ ] **10.** Custom ticket fields
- [ ] **11.** Attachments
- [ ] **12.** Internal and public comments
- [ ] **13.** Parent and child tickets
- [ ] **14.** Duplicate-ticket merging
- [ ] **15.** Ticket linking

### Assignment and workflow — 12

- [ ] **16.** Manual and automatic assignment
- [ ] **17.** Skill-based routing
- [ ] **18.** Round-robin assignment
- [ ] **19.** Department and team queues
- [ ] **20.** Escalation rules
- [ ] **21.** Approval workflows
- [ ] **22.** Ticket transfer
- [ ] **23.** Collision detection
- [ ] **24.** Agent availability
- [ ] **25.** Follow-up reminders
- [ ] **26.** Scheduled actions
- [ ] **27.** Workflow automation

### SLA management — 8

- [ ] **28.** Response-time SLA
- [ ] **29.** Resolution-time SLA
- [ ] **30.** SLA policies by customer and priority
- [ ] **31.** Business-hours calendars
- [ ] **32.** SLA pause conditions
- [ ] **33.** Escalation levels
- [ ] **34.** SLA breach alerts
- [ ] **35.** SLA performance reporting

### Customer service capabilities — 11

- [ ] **36.** Customer 360° history
- [ ] **37.** Product and asset linkage
- [ ] **38.** Warranty verification
- [ ] **39.** Service entitlement validation
- [ ] **40.** Service contracts
- [ ] **41.** Support plans
- [ ] **42.** Customer communication timeline
- [ ] **43.** Canned responses
- [ ] **44.** Email templates
- [ ] **45.** Customer satisfaction surveys
- [ ] **46.** CSAT, CES and NPS tracking

### Knowledge management — 9

- [ ] **47.** Internal knowledge base
- [ ] **48.** Public knowledge base
- [ ] **49.** Article categories
- [ ] **50.** Article approval and version control
- [ ] **51.** Search
- [ ] **52.** Related-article suggestions
- [ ] **53.** FAQs
- [ ] **54.** Customer self-service portal
- [ ] **55.** Community/forum integration

### Service analytics — 11

- [ ] **56.** Ticket volume
- [ ] **57.** First-response time
- [ ] **58.** Resolution time
- [ ] **59.** First-contact resolution
- [ ] **60.** SLA compliance
- [ ] **61.** Reopen rate
- [ ] **62.** Escalation rate
- [ ] **63.** Agent productivity
- [ ] **64.** Backlog ageing
- [ ] **65.** Customer satisfaction
- [ ] **66.** Root-cause trends

### Advanced — 9

- [ ] **67.** Omnichannel inbox
- [ ] **68.** AI ticket classification
- [ ] **69.** AI response suggestions
- [ ] **70.** AI ticket summaries
- [ ] **71.** Chatbot and virtual agent
- [ ] **72.** Sentiment detection
- [ ] **73.** Predictive escalation
- [ ] **74.** Field-service integration
- [ ] **75.** Remote support and screen-sharing integration

---

## 7. Quality Management — 77 features

### Quality setup — 10

- [ ] **1.** Quality policies and objectives
- [ ] **2.** Quality standards
- [ ] **3.** Inspection types
- [ ] **4.** Inspection plans
- [ ] **5.** Test parameters
- [ ] **6.** Specifications and tolerance limits
- [ ] **7.** Sampling plans
- [ ] **8.** Inspection frequencies
- [ ] **9.** Quality checklists
- [ ] **10.** Product and supplier quality requirements

### Inspections — 12

- [ ] **11.** Incoming-material inspection
- [ ] **12.** In-process inspection
- [ ] **13.** Final-product inspection
- [ ] **14.** Pre-dispatch inspection
- [ ] **15.** Returned-product inspection
- [ ] **16.** First-article inspection
- [ ] **17.** Asset and equipment inspection
- [ ] **18.** Ad hoc inspection
- [ ] **19.** Mobile inspection entry
- [ ] **20.** Photo and attachment evidence
- [ ] **21.** Instrument and measurement capture
- [ ] **22.** Automatic pass/fail calculation

### Non-conformance — 10

- [ ] **23.** Non-conformance reports
- [ ] **24.** Defect categories
- [ ] **25.** Defect severity
- [ ] **26.** Material quarantine
- [ ] **27.** Rework decisions
- [ ] **28.** Scrap decisions
- [ ] **29.** Use-as-is approvals
- [ ] **30.** Concession and deviation requests
- [ ] **31.** Non-conformance approval
- [ ] **32.** Cost-of-poor-quality tracking

### Corrective and preventive action — 9

- [ ] **33.** Root-cause analysis
- [ ] **34.** 5 Whys
- [ ] **35.** Fishbone analysis
- [ ] **36.** Corrective actions
- [ ] **37.** Preventive actions
- [ ] **38.** Action owners and deadlines
- [ ] **39.** Effectiveness verification
- [ ] **40.** CAPA approval and closure
- [ ] **41.** Recurrence monitoring

### Supplier and customer quality — 9

- [ ] **42.** Supplier quality rating
- [ ] **43.** Supplier corrective-action requests
- [ ] **44.** Supplier audits
- [ ] **45.** Incoming defect trends
- [ ] **46.** Customer complaints
- [ ] **47.** Product returns
- [ ] **48.** Warranty quality analysis
- [ ] **49.** Customer corrective actions
- [ ] **50.** Recall management

### Compliance — 10

- [ ] **51.** Audit planning
- [ ] **52.** Internal audits
- [ ] **53.** External audits
- [ ] **54.** Findings and observations
- [ ] **55.** Compliance checklists
- [ ] **56.** Document control integration
- [ ] **57.** ISO-related process support
- [ ] **58.** Calibration integration
- [ ] **59.** Training and competency verification
- [ ] **60.** Electronic approvals and audit trail

### Quality analytics — 10

- [ ] **61.** Defect rate
- [ ] **62.** First-pass yield
- [ ] **63.** Scrap and rework
- [ ] **64.** Supplier rejection rate
- [ ] **65.** Customer complaint rate
- [ ] **66.** Cost of quality
- [ ] **67.** CAPA closure time
- [ ] **68.** Process capability
- [ ] **69.** Control charts and SPC
- [ ] **70.** Pareto analysis

### Advanced — 7

- [ ] **71.** Statistical process control
- [ ] **72.** AI defect prediction
- [ ] **73.** Image-based defect detection
- [ ] **74.** IoT measurement capture
- [ ] **75.** Automated quality holds
- [ ] **76.** Full product genealogy
- [ ] **77.** Industry-specific compliance templates

---

## 8. Point of Sale — 89 features

### POS operations — 15

- [ ] **1.** Fast product search
- [ ] **2.** Barcode scanning
- [ ] **3.** Product variants
- [ ] **4.** Product images
- [ ] **5.** Touchscreen interface
- [ ] **6.** Customer selection and creation
- [ ] **7.** Anonymous/walk-in customer
- [ ] **8.** Multiple price lists
- [ ] **9.** Discounts and promotions
- [ ] **10.** Tax calculation
- [ ] **11.** Salesperson assignment
- [ ] **12.** Hold and resume transaction
- [ ] **13.** Split billing
- [ ] **14.** Quotations from POS
- [ ] **15.** Notes and special instructions

### Payments — 13

- [ ] **16.** Cash
- [ ] **17.** Card
- [ ] **18.** UPI
- [ ] **19.** QR-code payments
- [ ] **20.** Wallets
- [ ] **21.** Gift cards
- [ ] **22.** Store credit
- [ ] **23.** Split payments
- [ ] **24.** Partial payments
- [ ] **25.** Credit sales
- [ ] **26.** Payment-terminal integration
- [ ] **27.** Tips and service charges
- [ ] **28.** Refunds and reversals

### Retail operations — 13

- [ ] **29.** Multiple stores
- [ ] **30.** Multiple counters
- [ ] **31.** Multiple registers
- [ ] **32.** Register opening and closing
- [ ] **33.** Cash drawer management
- [ ] **34.** Cash in/out
- [ ] **35.** Shift management
- [ ] **36.** Till reconciliation
- [ ] **37.** End-of-day settlement
- [ ] **38.** Expense entry
- [ ] **39.** Cash variance reports
- [ ] **40.** Offline transaction support
- [ ] **41.** Automatic synchronisation

### Inventory and fulfilment — 11

- [ ] **42.** Real-time stock availability
- [ ] **43.** Store-specific inventory
- [ ] **44.** Automatic stock deduction
- [ ] **45.** Serial and lot tracking
- [ ] **46.** Batch and expiry selection
- [ ] **47.** Stock transfer requests
- [ ] **48.** Click and collect
- [ ] **49.** Ship-from-store
- [ ] **50.** Home delivery
- [ ] **51.** Order fulfilment status
- [ ] **52.** Returns and exchanges

### Customer engagement — 10

- [ ] **53.** Customer purchase history
- [ ] **54.** Loyalty points
- [ ] **55.** Membership levels
- [ ] **56.** Coupons
- [ ] **57.** Gift vouchers
- [ ] **58.** Customer-specific pricing
- [ ] **59.** Birthday and anniversary offers
- [ ] **60.** Digital receipts
- [ ] **61.** SMS/email receipts
- [ ] **62.** Feedback collection

### Hardware and integration — 9

- [ ] **63.** Receipt printer
- [ ] **64.** Barcode scanner
- [ ] **65.** Weighing scale
- [ ] **66.** Cash drawer
- [ ] **67.** Customer display
- [ ] **68.** Kitchen display
- [ ] **69.** Payment terminal
- [ ] **70.** Label printer
- [ ] **71.** Fiscal device integration where required

### POS analytics — 10

- [ ] **72.** Sales by store, terminal and employee
- [ ] **73.** Hourly and daily sales
- [ ] **74.** Product mix
- [ ] **75.** Gross margin
- [ ] **76.** Discount analysis
- [ ] **77.** Payment-method analysis
- [ ] **78.** Returns
- [ ] **79.** Cash variance
- [ ] **80.** Basket size
- [ ] **81.** Customer retention

### Advanced — 8

- [ ] **82.** Restaurant tables and floor plans
- [ ] **83.** Kitchen order tickets
- [ ] **84.** Multi-channel retail
- [ ] **85.** Self-checkout
- [ ] **86.** Mobile POS
- [ ] **87.** Franchise management
- [ ] **88.** AI product recommendations
- [ ] **89.** Demand-based store replenishment

---

## 9. Assets — 73 features

### Asset register — 12

- [ ] **1.** Asset categories and classes
- [ ] **2.** Unique asset identification
- [ ] **3.** Barcode and QR code
- [ ] **4.** Asset location
- [ ] **5.** Asset custodian
- [ ] **6.** Department and cost centre
- [ ] **7.** Parent and component assets
- [ ] **8.** Asset documents and images
- [ ] **9.** Warranty information
- [ ] **10.** Insurance information
- [ ] **11.** Supplier and purchase linkage
- [ ] **12.** Asset status and history

### Asset acquisition and accounting — 16

- [ ] **13.** Asset creation from purchase receipt
- [ ] **14.** Capital work in progress
- [ ] **15.** Asset capitalisation
- [ ] **16.** Multiple depreciation books
- [ ] **17.** Straight-line depreciation
- [ ] **18.** Written-down-value depreciation
- [ ] **19.** Units-of-production depreciation
- [ ] **20.** Prorated depreciation
- [ ] **21.** Tax depreciation
- [ ] **22.** Revaluation
- [ ] **23.** Impairment
- [ ] **24.** Asset transfer
- [ ] **25.** Asset split and merge
- [ ] **26.** Disposal and sale
- [ ] **27.** Gain or loss calculation
- [ ] **28.** General-ledger integration

### Maintenance — 13

- [ ] **29.** Preventive maintenance schedules
- [ ] **30.** Corrective maintenance
- [ ] **31.** Predictive maintenance
- [ ] **32.** Maintenance requests
- [ ] **33.** Maintenance work orders
- [ ] **34.** Breakdown reporting
- [ ] **35.** Service checklists
- [ ] **36.** Labour and spare-parts consumption
- [ ] **37.** Downtime tracking
- [ ] **38.** Maintenance contracts
- [ ] **39.** Warranty claims
- [ ] **40.** External service providers
- [ ] **41.** Maintenance history

### Inspection and calibration — 9

- [ ] **42.** Asset inspections
- [ ] **43.** Safety checks
- [ ] **44.** Calibration schedules
- [ ] **45.** Calibration certificates
- [ ] **46.** Compliance records
- [ ] **47.** Meter and usage readings
- [ ] **48.** Condition monitoring
- [ ] **49.** Failure codes
- [ ] **50.** Root-cause analysis

### Asset allocation — 8

- [ ] **51.** Employee asset issue
- [ ] **52.** Asset return
- [ ] **53.** Custodian acknowledgement
- [ ] **54.** Asset movement requests
- [ ] **55.** Location transfers
- [ ] **56.** Temporary allocation
- [ ] **57.** Lost and damaged asset reporting
- [ ] **58.** Exit-clearance integration

### Asset analytics — 9

- [ ] **59.** Asset value and depreciation
- [ ] **60.** Asset utilisation
- [ ] **61.** Downtime
- [ ] **62.** Maintenance cost
- [ ] **63.** Mean time between failures
- [ ] **64.** Mean time to repair
- [ ] **65.** Warranty expiry
- [ ] **66.** Replacement planning
- [ ] **67.** Total cost of ownership

### Advanced — 6

- [ ] **68.** IoT-based condition monitoring
- [ ] **69.** Predictive failure detection
- [ ] **70.** Digital twins
- [ ] **71.** Mobile maintenance application
- [ ] **72.** GIS asset mapping
- [ ] **73.** Reliability-centred maintenance

---

## 10. Projects — 86 features

### Project setup — 10

- [ ] **1.** Project templates
- [ ] **2.** Project types
- [ ] **3.** Project manager and team
- [ ] **4.** Customer and contract linkage
- [ ] **5.** Start and end dates
- [ ] **6.** Project status
- [ ] **7.** Departments and cost centres
- [ ] **8.** Tags and custom fields
- [ ] **9.** Project documents
- [ ] **10.** Internal and customer projects

### Planning — 12

- [ ] **11.** Work breakdown structure
- [ ] **12.** Tasks and subtasks
- [ ] **13.** Milestones
- [ ] **14.** Dependencies
- [ ] **15.** Gantt chart
- [ ] **16.** Kanban board
- [ ] **17.** Calendar view
- [ ] **18.** Critical-path calculation
- [ ] **19.** Baselines
- [ ] **20.** Recurring tasks
- [ ] **21.** Project checklists
- [ ] **22.** Risk and issue registers

### Resource management — 10

- [ ] **23.** Resource requests
- [ ] **24.** Skills-based resource allocation
- [ ] **25.** Resource availability
- [ ] **26.** Resource calendar
- [ ] **27.** Capacity planning
- [ ] **28.** Utilisation tracking
- [ ] **29.** Billable and non-billable allocation
- [ ] **30.** Contractor management
- [ ] **31.** Resource replacement
- [ ] **32.** Team workload view

### Time and expenses — 10

- [ ] **33.** Timesheets
- [ ] **34.** Timer
- [ ] **35.** Mobile time entry
- [ ] **36.** Task-level time capture
- [ ] **37.** Timesheet approval
- [ ] **38.** Expense claims
- [ ] **39.** Expense approval
- [ ] **40.** Mileage
- [ ] **41.** Billable and non-billable classification
- [ ] **42.** Cost-rate and billing-rate management

### Project financials — 15

- [ ] **43.** Project budgets
- [ ] **44.** Cost estimates
- [ ] **45.** Budget versions
- [ ] **46.** Committed costs
- [ ] **47.** Actual costs
- [ ] **48.** Forecast-to-complete
- [ ] **49.** Estimate-at-completion
- [ ] **50.** Project profitability
- [ ] **51.** Work in progress
- [ ] **52.** Revenue recognition
- [ ] **53.** Time-and-material billing
- [ ] **54.** Fixed-price billing
- [ ] **55.** Milestone billing
- [ ] **56.** Retainers
- [ ] **57.** Project purchase and inventory consumption

### Collaboration and governance — 12

- [ ] **58.** Comments and mentions
- [ ] **59.** File sharing
- [ ] **60.** Meeting notes
- [ ] **61.** Change requests
- [ ] **62.** Scope changes
- [ ] **63.** Approval workflows
- [ ] **64.** Risk management
- [ ] **65.** Issue management
- [ ] **66.** Decision log
- [ ] **67.** Customer portal
- [ ] **68.** Progress reports
- [ ] **69.** Project audit history

### Project analytics — 10

- [ ] **70.** Budget versus actual
- [ ] **71.** Schedule variance
- [ ] **72.** Cost variance
- [ ] **73.** Earned-value metrics
- [ ] **74.** Milestone status
- [ ] **75.** Resource utilisation
- [ ] **76.** Project margin
- [ ] **77.** Billing and collection status
- [ ] **78.** Timesheet compliance
- [ ] **79.** Portfolio dashboard

### Advanced — 7

- [ ] **80.** AI schedule-risk prediction
- [ ] **81.** AI project summaries
- [ ] **82.** Resource optimisation
- [ ] **83.** Portfolio management
- [ ] **84.** Programme management
- [ ] **85.** Scenario planning
- [ ] **86.** Construction and engineering project features

---

## 11. Manufacturing — 118 features

### Product engineering — 16

- [ ] **1.** Bills of materials
- [ ] **2.** Multi-level BOM
- [ ] **3.** Phantom BOM
- [ ] **4.** Configurable BOM
- [ ] **5.** Alternate BOM
- [ ] **6.** Formula and recipe management
- [ ] **7.** By-products and co-products
- [ ] **8.** Scrap definition
- [ ] **9.** Routings
- [ ] **10.** Operations
- [ ] **11.** Work centres
- [ ] **12.** Machines and labour resources
- [ ] **13.** Setup and run times
- [ ] **14.** Engineering change management
- [ ] **15.** BOM and routing version control
- [ ] **16.** Product lifecycle status

### Production planning — 16

- [ ] **17.** Sales and operations planning
- [ ] **18.** Master production schedule
- [ ] **19.** Material requirements planning
- [ ] **20.** Demand planning
- [ ] **21.** Supply planning
- [ ] **22.** Capacity requirements planning
- [ ] **23.** Finite and infinite scheduling
- [ ] **24.** Make-to-stock
- [ ] **25.** Make-to-order
- [ ] **26.** Engineer-to-order
- [ ] **27.** Assemble-to-order
- [ ] **28.** Repetitive manufacturing
- [ ] **29.** Batch manufacturing
- [ ] **30.** Process manufacturing
- [ ] **31.** Subcontract manufacturing
- [ ] **32.** Production simulation

### Work orders and execution — 18

- [ ] **33.** Manufacturing orders
- [ ] **34.** Work-order release and approval
- [ ] **35.** Material reservation
- [ ] **36.** Material issue
- [ ] **37.** Backflushing
- [ ] **38.** Operation sequencing
- [ ] **39.** Job cards
- [ ] **40.** Work instructions
- [ ] **41.** Labour-time capture
- [ ] **42.** Machine-time capture
- [ ] **43.** Setup-time capture
- [ ] **44.** Production quantity reporting
- [ ] **45.** Partial completion
- [ ] **46.** Scrap and rework
- [ ] **47.** Production receipt
- [ ] **48.** Shop-floor terminals
- [ ] **49.** Mobile shop-floor execution
- [ ] **50.** Shift handover

### Shop-floor control — 12

- [ ] **51.** Real-time production status
- [ ] **52.** Work-centre queues
- [ ] **53.** Dispatch lists
- [ ] **54.** Machine status
- [ ] **55.** Downtime reasons
- [ ] **56.** Operator assignment
- [ ] **57.** Production alerts
- [ ] **58.** Bottleneck visibility
- [ ] **59.** OEE tracking
- [ ] **60.** Andon-board integration
- [ ] **61.** Digital work instructions
- [ ] **62.** Drawing and document access

### Material and traceability — 11

- [ ] **63.** Raw-material issue
- [ ] **64.** Lot and serial tracking
- [ ] **65.** Batch genealogy
- [ ] **66.** Ingredient and component traceability
- [ ] **67.** Expiry and shelf-life control
- [ ] **68.** WIP tracking
- [ ] **69.** Production warehouse management
- [ ] **70.** Material substitution
- [ ] **71.** Material return
- [ ] **72.** Scrap recovery
- [ ] **73.** Recall support

### Quality and maintenance integration — 9

- [ ] **74.** Incoming inspection
- [ ] **75.** In-process inspection
- [ ] **76.** Final inspection
- [ ] **77.** Quality holds
- [ ] **78.** Non-conformance
- [ ] **79.** Rework orders
- [ ] **80.** Machine maintenance requests
- [ ] **81.** Preventive maintenance integration
- [ ] **82.** Calibration verification

### Costing — 12

- [ ] **83.** Standard production cost
- [ ] **84.** Actual production cost
- [ ] **85.** Labour cost
- [ ] **86.** Machine overhead
- [ ] **87.** Material overhead
- [ ] **88.** Subcontracting cost
- [ ] **89.** By-product cost allocation
- [ ] **90.** Cost roll-up
- [ ] **91.** Production variance
- [ ] **92.** Scrap and rework cost
- [ ] **93.** Work-in-progress valuation
- [ ] **94.** Manufacturing profitability

### Manufacturing analytics — 13

- [ ] **95.** Production output
- [ ] **96.** Plan versus actual
- [ ] **97.** Capacity utilisation
- [ ] **98.** OEE
- [ ] **99.** Yield
- [ ] **100.** First-pass yield
- [ ] **101.** Scrap and rework
- [ ] **102.** Machine downtime
- [ ] **103.** Labour efficiency
- [ ] **104.** Manufacturing cycle time
- [ ] **105.** Schedule adherence
- [ ] **106.** Production cost variance
- [ ] **107.** On-time completion

### Advanced — 11

- [ ] **108.** Advanced planning and scheduling
- [ ] **109.** Manufacturing execution system
- [ ] **110.** IoT machine connectivity
- [ ] **111.** Predictive maintenance
- [ ] **112.** AI production scheduling
- [ ] **113.** AI demand forecasting
- [ ] **114.** Digital twins
- [ ] **115.** Computer-vision quality inspection
- [ ] **116.** Energy-consumption monitoring
- [ ] **117.** Lean manufacturing and Kanban
- [ ] **118.** Industry-specific process controls

---

# Shared SaaS and enterprise platform requirements

## SaaS platform — 14 features

- [ ] **1.** True multi-tenant architecture
- [ ] **2.** Tenant-level data isolation
- [ ] **3.** Multiple companies and branches
- [ ] **4.** Configurable subscription plans
- [ ] **5.** Feature entitlements
- [ ] **6.** Usage metering
- [ ] **7.** Trial management
- [ ] **8.** Tenant provisioning and suspension
- [ ] **9.** Data export and tenant deletion
- [ ] **10.** Backup and disaster recovery
- [ ] **11.** Regional deployment and data residency
- [ ] **12.** High availability
- [ ] **13.** Horizontal scaling
- [ ] **14.** Status monitoring

## Security and governance — 15 features

- [ ] **15.** Role-based access control
- [ ] **16.** Permission by module, action and record
- [ ] **17.** Field-level permissions
- [ ] **18.** Branch and territory-based access
- [ ] **19.** Maker-checker controls
- [ ] **20.** Segregation of duties
- [ ] **21.** Single sign-on
- [ ] **22.** Multi-factor authentication
- [ ] **23.** Session and device management
- [ ] **24.** IP restrictions
- [ ] **25.** Audit logs
- [ ] **26.** Record version history
- [ ] **27.** Encryption at rest and in transit
- [ ] **28.** API authentication and scoped tokens
- [ ] **29.** Privacy and retention controls

## Workflow and automation — 12 features

- [ ] **30.** Configurable approval workflows
- [ ] **31.** Conditional workflow rules
- [ ] **32.** Multi-level approvals
- [ ] **33.** Delegation
- [ ] **34.** Escalations
- [ ] **35.** Scheduled automation
- [ ] **36.** Event-triggered automation
- [ ] **37.** Email, SMS and in-app notifications
- [ ] **38.** Webhooks
- [ ] **39.** Business-rule engine
- [ ] **40.** No-code custom fields
- [ ] **41.** No-code forms and layouts

## Reporting and analytics — 13 features

- [ ] **42.** Module dashboards
- [ ] **43.** Role-specific dashboards
- [ ] **44.** Custom report builder
- [ ] **45.** Filters and saved views
- [ ] **46.** Pivot tables
- [ ] **47.** Charts
- [ ] **48.** Scheduled reports
- [ ] **49.** Email report delivery
- [ ] **50.** CSV/Excel/PDF export
- [ ] **51.** Drill-down reporting
- [ ] **52.** Cross-module analytics
- [ ] **53.** KPI targets and alerts
- [ ] **54.** Data warehouse and BI connectors

## Integration — 13 features

- [ ] **55.** Versioned REST APIs
- [ ] **56.** Webhooks
- [ ] **57.** API documentation
- [ ] **58.** OAuth 2.0
- [ ] **59.** Import and export framework
- [ ] **60.** Accounting and banking integrations
- [ ] **61.** Payment gateways
- [ ] **62.** Email and calendar integration
- [ ] **63.** WhatsApp and SMS
- [ ] **64.** E-commerce and marketplace integrations
- [ ] **65.** Shipping and logistics integrations
- [ ] **66.** Identity-provider integrations
- [ ] **67.** Integration logs and retry handling

## User experience — 15 features

- [ ] **68.** Responsive web application
- [ ] **69.** Android and iOS applications
- [ ] **70.** Global search
- [ ] **71.** Command palette
- [ ] **72.** Configurable list views
- [ ] **73.** Bulk operations
- [ ] **74.** Keyboard shortcuts
- [ ] **75.** Localisation
- [ ] **76.** Multiple languages
- [ ] **77.** Multiple currencies
- [ ] **78.** Multiple time zones
- [ ] **79.** Accessibility
- [ ] **80.** In-product help
- [ ] **81.** Notifications centre
- [ ] **82.** Favourites and recent records

## Data governance — 12 features

- [ ] **83.** Shared customer, supplier, employee and product masters
- [ ] **84.** Duplicate management
- [ ] **85.** Data validation
- [ ] **86.** Record ownership
- [ ] **87.** Data import templates
- [ ] **88.** Bulk update
- [ ] **89.** Archiving
- [ ] **90.** Soft deletion
- [ ] **91.** Data retention
- [ ] **92.** Complete audit trail
- [ ] **93.** Master-data approval
- [ ] **94.** Unique numbering sequences

---

## Validation totals

- Numbered module entries: **945**
- Numbered shared-platform entries: **94**
- Validated overall total: **1039**

> Note: Finance and Accounting is normally a core ERP module, but it was not included in the supplied module list. Adding it later will increase the total.