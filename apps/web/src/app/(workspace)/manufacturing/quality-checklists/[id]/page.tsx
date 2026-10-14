import { Suspense } from "react";

import { QiTemplateScreen } from "@/features/manufacturing/quality/screens/QiTemplateScreen";

export const metadata = { title: "Inspection checklist" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense><QiTemplateScreen templateId={id} /></Suspense>;
}
