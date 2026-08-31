# AI Runtime Governance

Status: `APPROVED_FOR_ARCHITECTURE_FREEZE`

AI is an assistive capability, never an alternate authority plane.

## Hard rules
- AI MUST NOT write directly to database tables. Actions execute only through normal authenticated/authorized module commands.
- Retrieval is tenant/company/record/field permission filtered before context is provided to a model.
- Deterministic systems remain authoritative for accounting, tax, payroll, inventory/valuation, payments, authorization and lifecycle legality.
- High-impact actions require explicit approval or a pre-approved policy with audit evidence.
- Outputs store model/provider/version, prompt/template version, authorized source references, timestamp and actor when they influence a business decision.
- User corrections/overrides preserve the original AI output and decision provenance.
- Prompt/tool data is isolated by tenant and must not cross customer boundaries.
- Evaluation suites cover grounding, authorization leakage, unsafe tool use, hallucination, regression and business-task quality before model/prompt changes ship.
- Kill switch, feature flag and rollback to deterministic/manual workflow are mandatory.
- Model/tool failures cannot partially execute business mutations.
