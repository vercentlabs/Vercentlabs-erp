# Domain Design Standard

Model aggregates, invariants, state machines, commands, queries, events, reversals and ownership explicitly. Cross-module work uses module public contracts/orchestration. Avoid direct writes into another module's private tables. Make transaction boundaries, failure semantics and reconciliation explicit.
