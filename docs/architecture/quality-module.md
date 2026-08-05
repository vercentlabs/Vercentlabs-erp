# VercentLabs ERP Quality module

Quality embeds inspection, containment, non-conformance, CAPA and audit controls across Procurement, Stock, Manufacturing, Sales and Point of Sale.

## Ownership boundaries

- Procurement owns supplier commercial records and receipts. Quality owns inspection outcomes, supplier quality evidence and release decisions.
- Stock owns quantities, batches, serials and movements. Quality owns holds and release evidence without directly rewriting inventory balances.
- Manufacturing owns production execution. Quality owns in-process and final inspection evidence.
- Sales and Point of Sale own customer transactions and returns. Quality owns return inspection, defect classification and disposition.

## Controls

- Only active quality plans can create inspections.
- Failed inspections can automatically create quality holds.
- Inspectors cannot release their own inspection.
- Non-conformance records preserve containment and disposition evidence.
- CAPA retains root cause, corrective action, prevention and effectiveness verification.
- Every tenant Quality table uses forced PostgreSQL row-level security.
