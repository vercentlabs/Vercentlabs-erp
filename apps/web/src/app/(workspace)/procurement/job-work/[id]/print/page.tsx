import { JobWorkChallanPrint } from "@/features/procurement/job-work/JobWorkScreens";

export const metadata = { title: "Job-work challan" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <JobWorkChallanPrint id={id} />;
}
