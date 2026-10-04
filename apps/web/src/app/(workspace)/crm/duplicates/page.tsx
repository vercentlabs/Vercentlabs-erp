import { requireWorkspace } from "@/core/session";
import { DuplicateReviewScreen } from "@/features/crm/duplicates/screens/DuplicateReviewScreen";

export const metadata = { title: "Potential duplicates" };

export default async function Page() {
  await requireWorkspace();
  return <DuplicateReviewScreen />;
}
