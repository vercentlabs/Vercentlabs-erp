import { CTAS } from "../navigation.js";

/**
 * /product/integrations ("Import & Export") — how data moves in and out at launch. The export keeps its original name for API stability.
 * Product statements must stay inside the approved launch capability register
 * (capabilities/launch-capabilities.js).
 */
export const INTEGRATIONS_PAGE = Object.freeze({
  slug: "/product/integrations",
  title: "Data Import & Export",
  metaDescription:
    "How data moves in and out of Vercentlabs ERP at launch: CSV import and export (available today for CRM leads), data migration during implementation, and PDF and print for business documents.",
  directDefinition:
    "At launch, data moves in and out of Vercentlabs ERP through CSV import and export — available today for CRM leads — plus data migration during implementation and PDF and print output for business documents. Vercentlabs ERP does not claim a catalogue of prebuilt third-party connectors at launch.",
  eyebrow: "Data import & export",
  heading: "How your data gets in and out — stated plainly.",
  supportingText:
    "This page describes the approved launch capabilities for moving data. Where something would need custom work, it says so rather than implying a ready-made connector.",
  sections: [
    {
      id: "import",
      heading: "Import",
      supportingText: "Bring existing records into Vercentlabs ERP instead of re-typing them.",
      items: [
        { title: "CSV import", description: "CRM leads can be imported from CSV with analyze, preview, commit, and rollback steps, and validation applied before they're saved. Other existing records are loaded during implementation as part of data migration." },
      ],
    },
    {
      id: "export",
      heading: "Export and documents",
      supportingText: "Take data and documents out of the system.",
      items: [
        { title: "CSV export", description: "CRM leads can be exported as CSV for use in other tools." },
        { title: "PDF and print", description: "Business documents can be produced as PDFs and printed." },
      ],
    },
    {
      id: "connectors",
      heading: "Prebuilt connectors",
      supportingText: "Vercentlabs ERP does not claim a catalogue of prebuilt integrations with third-party applications at launch. If you need a specific connection, discuss it with us during your evaluation.",
      items: [],
    },
  ],
  connectedModuleKeys: ["crm", "sales", "stock"],
  primaryCta: CTAS.talkToSpecialist,
  finalCtaHeading: "Talk through your data and migration needs with an ERP specialist.",
});
