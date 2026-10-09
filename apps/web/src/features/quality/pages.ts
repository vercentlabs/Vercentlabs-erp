// Plain data (no components) so a Server Component page can read it.
export const QUALITY_PAGES: Record<string, { title: string }> = {
  plans: { title: "Quality plans" },
  "plan-builder": { title: "New quality plan" },
  "inspection-new": { title: "New inspection" },
  inspections: { title: "Inspections" },
  "open-inspections": { title: "Open inspections" },
  nonconformances: { title: "Non-conformances" },
};
