import ModulePageGuard from "@/components/module-page-guard";

export default function ProjectsLayout({ children }: { children: React.ReactNode }) {
  return <ModulePageGuard moduleId="projects">{children}</ModulePageGuard>;
}
