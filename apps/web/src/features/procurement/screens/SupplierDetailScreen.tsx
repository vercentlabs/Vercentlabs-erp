"use client";

import { ChildSection } from "@/features/procurement/shared/ChildSection";
import { DocumentDetail } from "@/features/procurement/shared/DocumentDetail";
import { supplierChildren, supplierDetail } from "@/features/procurement/configs/suppliers";

// F063-F066/F089-F091: the supplier record with its sites and contacts,
// qualification assessments, certifications and performance scorecards.
export function SupplierDetailScreen({ id }: { id: string }) {
  const config = {
    ...supplierDetail,
    sections: [
      { id: "sites", label: "Sites & contacts", render: (record: { id: string; status: string }) => <ChildSection config={supplierChildren.sites} parentId={record.id} parentStatus={record.status} /> },
      { id: "qualification", label: "Qualification", render: (record: { id: string; status: string }) => (
        <>
          <ChildSection config={supplierChildren.qualifications} parentId={record.id} parentStatus={record.status} />
          <ChildSection config={supplierChildren.certifications} parentId={record.id} parentStatus={record.status} />
        </>
      ) },
      { id: "performance", label: "Performance", render: (record: { id: string; status: string }) => <ChildSection config={supplierChildren.scorecards} parentId={record.id} parentStatus={record.status} /> },
    ],
  };
  return <DocumentDetail config={config} id={id} />;
}
