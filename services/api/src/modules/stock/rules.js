// The one rule for which on-hand stock is eligible for allocation (and so counts toward Available). Stock is restricted (on hand, but never
// allocated, reserved, sold or issued through ordinary availability) when its location holds anything but available stock (quality hold,
// quarantined, damaged), does not allow allocation, or is inactive, or when its batch is blocked, expired or past its expiry date. Every
// availability figure (Inventory, Sales, Warehouses, Item Master) uses it, so they always agree. Expiry never removes stock: it stays on
// hand until it is disposed of, returned or adjusted.
export const restrictedStockSql = (location = "location", batch = "batch") =>
  `(COALESCE(${location}.disposition, 'available') <> 'available' OR NOT COALESCE(${location}.allow_allocation, true)`
  + ` OR COALESCE(${location}.location_type, '') = 'quality' OR COALESCE(${location}.purpose, '') = 'transit' OR COALESCE(${location}.status, 'active') <> 'active'`
  + ` OR COALESCE(${batch}.status, 'active') <> 'active' OR COALESCE(${batch}.expires_on < current_date, false))`;

// Expired: a batch marked expired or past its expiry date (part of restricted stock, also shown on its own).
export const expiredStockSql = (batch = "batch") => `(COALESCE(${batch}.status, '') = 'expired' OR COALESCE(${batch}.expires_on < current_date, false))`;

// Why a restricted position is restricted, the first reason that applies: quality_hold | quarantined | damaged | expired | blocked |
// not_allocatable | inactive_location; null when it is eligible.
export const restrictionReasonSql = (location = "location", batch = "batch") => `(CASE
    WHEN COALESCE(${location}.disposition, 'available') <> 'available' THEN ${location}.disposition
    WHEN COALESCE(${location}.location_type, '') = 'quality' THEN 'quality_hold'
    WHEN ${expiredStockSql(batch)} THEN 'expired'
    WHEN COALESCE(${batch}.status, 'active') <> 'active' THEN 'blocked'
    WHEN COALESCE(${location}.purpose, '') = 'transit' THEN 'in_transit'
    WHEN NOT COALESCE(${location}.allow_allocation, true) THEN 'not_allocatable'
    WHEN COALESCE(${location}.status, 'active') <> 'active' THEN 'inactive_location'
  END)`;
