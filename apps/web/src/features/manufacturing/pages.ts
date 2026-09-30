// Plain data (no components) so a Server Component page can read it.
export const MANUFACTURING_PAGES: Record<string, { title: string }> = {
  boms: { title: "Bills of materials" },
  "bom-versions": { title: "BOM versions" },
  "production-orders": { title: "Production orders" },
  reservations: { title: "Material reservations" },
  consumption: { title: "Material consumption" },
  "finished-output": { title: "Finished output" },
  scrap: { title: "Scrap" },
  settings: { title: "Manufacturing settings" },
  "production-cost": { title: "Production cost" },
  variance: { title: "Cost variance" },
  "standard-cost": { title: "Standard cost" },
  inspections: { title: "Production inspections" },
  "material-planning": { title: "Material availability" },
};
