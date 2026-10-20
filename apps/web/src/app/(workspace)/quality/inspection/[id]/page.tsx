import { redirect } from "next/navigation";

// Inspections moved to Incoming Inspections (MVP 31); old links keep working.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/quality/incoming/${id}`);
}
