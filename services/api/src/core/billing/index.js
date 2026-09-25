// Shared Platform — billing boundary.
// Subscription billing, plan entitlements, seats, usage limits and the billing write gate.
//
// Compatibility barrel: implementations still live in the flat
// services/api/src/core/*.js files listed below and are moved behind this
// boundary incrementally. New callers import the boundary, not the files.
export * from "../entitlements.js";
export * from "../subscription-billing.js";
export * from "../razorpay.js";
export * from "../billing.js";
