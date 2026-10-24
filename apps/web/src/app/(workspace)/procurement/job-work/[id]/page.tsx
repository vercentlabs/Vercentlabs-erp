import { JobWorkDetailScreen } from "@/features/procurement/job-work/JobWorkScreens";

export const metadata = { title: "Job work" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <JobWorkDetailScreen id={id} />;
}
