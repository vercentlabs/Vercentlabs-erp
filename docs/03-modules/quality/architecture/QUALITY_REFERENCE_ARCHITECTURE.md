# Quality Reference Architecture

Command chain: authenticate → organization/company/site → module entitlement → quality permission/SoD → resolve effective standard/specification/plan/control point → resolve source/item/lot/sample/instrument → expected-state/concurrency lock → deterministic validation/evaluation → atomic Quality state/evidence/audit → public hold/release/disposition/CAPA/downstream intent → visible result/reconciliation.

F323 requires Stock/Manufacturing movement authorization to query/lock applicable active Quality hold state inside the same authoritative concurrency boundary. No asynchronous notification or UI-only flag can satisfy this invariant.
