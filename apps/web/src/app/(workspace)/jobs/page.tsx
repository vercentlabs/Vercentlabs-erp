import { PlatformFoundationPage } from "@/shell/module-foundation/PlatformFoundationPage";

export const metadata = { title: "Background Jobs" };

export default function JobsPage() {
  return (
    <PlatformFoundationPage
      label="Background Jobs"
      description="A global job-visibility surface is planned once the current background-job/import-job status source is confirmed."
    />
  );
}
