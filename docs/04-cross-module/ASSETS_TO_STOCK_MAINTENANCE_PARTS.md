# Contract — Assets maintenance to Stock parts

Maintenance order requests reserve/issue/return of specific Stock item/UOM/warehouse quantities through Stock public commands. Stock owns availability, reservation, lot/serial and valuation. Assets stores source movement IDs/cost snapshots for maintenance history; retries cannot double-consume parts and failed/reversed movements reconcile explicitly.
