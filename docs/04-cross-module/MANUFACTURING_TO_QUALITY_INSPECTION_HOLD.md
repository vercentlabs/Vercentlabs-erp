# Manufacturing → Quality Inspection/Hold Contract

Configured production checkpoints/output events request Quality inspections. A scoped applicable hold is a hard guard on affected production/Stock release. Quality owns inspection result, NCR/disposition and hold release authority; Manufacturing consumes that status. All bypass channels (UI/API/import/automation/scanner) use the same server guard. Rework/scrap/release outcomes retain lineage.
