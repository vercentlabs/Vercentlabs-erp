import { Suspense } from "react";

import { SubmissionScreen } from "@/features/projects/timesheets/ReviewScreens";

export const metadata = { title: "Timesheet" };

export default async function Page({ params }: { params: Promise<{ submissionId: string }> }) {
  const { submissionId } = await params;
  return <Suspense><SubmissionScreen submissionId={submissionId} /></Suspense>;
}
