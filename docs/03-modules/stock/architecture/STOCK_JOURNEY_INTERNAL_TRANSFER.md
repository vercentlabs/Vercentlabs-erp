# Stock Journey — Internal Transfer

Request/validate source and destination → lock source availability → release/in-transit if configured → atomic source issue and destination receipt → traceability/valuation lineage → audit/outbox → reconciliation. Duplicate completion is a replay/no-op; failure cannot leave a completed one-sided transfer.
