// Plain data (no components) so a Server Component page can read it.
export const MANUFACTURING_PAGES: Record<string, { title: string }> = {
  boms: { title: "Bills of materials" },
  "bom-versions": { title: "BOM versions" },
  "where-used": { title: "Where used" },
  "engineering-changes": { title: "Engineering changes" },
};
