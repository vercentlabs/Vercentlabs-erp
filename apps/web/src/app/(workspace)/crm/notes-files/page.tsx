import { requireWorkspace } from "@/core/session";
import { NotesFilesScreen } from "@/features/crm/notes/screens/NotesFilesScreen";

export const metadata = { title: "Notes & Files" };

export default async function NotesFilesPage() {
  await requireWorkspace();
  return <NotesFilesScreen />;
}
