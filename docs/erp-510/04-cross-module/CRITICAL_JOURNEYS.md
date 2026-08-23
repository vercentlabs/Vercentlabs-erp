# Critical Cross-Module ERP Journeys

These are mandatory release gates.

A module cannot be considered production-complete if its critical downstream
effects are broken.

---

## Journey 1 — CRM → Sales

Lead
→ Opportunity
→ Quotation
→ Sales Order

---

## Journey 2 — Sales → Stock → Accounting

Sales Order
→ Stock Reservation
→ Delivery
→ Invoice
→ Receivable
→ Payment
→ Accounting

---

## Journey 3 — Procurement → Stock → Accounting

Purchase Requisition
→ RFQ
→ Supplier Quote
→ Purchase Order
→ Goods Receipt
→ Stock Increase
→ Supplier Invoice
→ Accounts Payable
→ Payment

---

## Journey 4 — Manufacturing → Stock

Demand
→ MRP
→ Manufacturing Order
→ Material Issue
→ Production
→ Finished Goods
→ Inventory

---

## Journey 5 — Manufacturing → Quality → Stock

Production / Receipt
→ Inspection
→ Failure
→ Quality Hold
→ Stock Movement BLOCKED
→ Release / Disposition

A quality hold that does not block relevant stock movement is not complete.

---

## Journey 6 — POS → Stock → Accounting

POS Sale
→ Payment
→ Stock Reduction
→ Tax/Revenue
→ Accounting

---

## Journey 7 — HR Payroll → Accounting

Payroll
→ Earnings
→ Deductions
→ Statutory Liability
→ Net Pay
→ Payroll Approval
→ Accounting Journal

---

## Journey 8 — Assets → Accounting

Purchase
→ Asset Capitalization
→ Depreciation
→ Revaluation/Impairment where applicable
→ Disposal
→ Accounting

---

## Journey 9 — Projects → Sales / Accounting

Project
→ Time / Expense / Material
→ Billing
→ Customer Invoice
→ Revenue / Cost
→ Profitability

---

## Journey 10 — Support → Customer 360

Support Ticket
→ Customer
→ Contact
→ Sales History
→ Product
→ Asset
→ Relevant Service Context
