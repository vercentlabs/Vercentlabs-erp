// Shared Platform — organization boundary.
// Organization, company, branch, membership and invitation administration; self-serve registration.
//
// Compatibility barrel: implementations still live in the flat
// services/api/src/core/*.js files listed below and are moved behind this
// boundary incrementally. New callers import the boundary, not the files.
export * from "../organization-administration.js";
export * from "../organization-registration.js";
