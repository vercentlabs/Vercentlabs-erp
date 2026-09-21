import { notFound } from "next/navigation";

import { PROJECTS_PAGES } from "@/features/projects/pages";
import { ProjectsPage } from "@/features/projects/ProjectsPage";

export async function generateMetadata({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  return { title: PROJECTS_PAGES[page]?.title ?? "Projects" };
}

export default async function Page({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  if (!(page in PROJECTS_PAGES)) notFound();
  return <ProjectsPage name={page} />;
}
