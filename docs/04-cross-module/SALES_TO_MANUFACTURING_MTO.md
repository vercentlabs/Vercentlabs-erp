# Sales → Manufacturing Make-to-Order Contract

A confirmed eligible Sales order line may create/update a manufacturing demand through a versioned orchestration/public command with source-line uniqueness. Manufacturing resolves approved configuration/BOM/routing and returns durable production status references; Sales never mutates work-order tables. Cancellation/amendment after release uses explicit impact/compensation policy.
