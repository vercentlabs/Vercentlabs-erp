// Plain data (no components) so a Server Component page can read it.
export const ASSETS_PAGES: Record<string, { title: string }> = {
  register: { title: "Asset register" },
  categories: { title: "Asset categories" },
  locations: { title: "Locations" },
  acquisition: { title: "Acquisition" },
  capitalization: { title: "Capitalization" },
  assignments: { title: "Assignments" },
  transfers: { title: "Transfers" },
  depreciation: { title: "Depreciation" },
  "maintenance-plans": { title: "Maintenance plans" },
  "work-orders": { title: "Work orders" },
  retirement: { title: "Retirement" },
  disposal: { title: "Disposal and sale" },
  settings: { title: "Asset settings" },
};
