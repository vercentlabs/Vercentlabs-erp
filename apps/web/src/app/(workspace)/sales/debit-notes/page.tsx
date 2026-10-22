import { Suspense } from "react";

import { DebitNotesScreen } from "@/features/sales/debit-notes/DebitNoteScreens";

export const metadata = { title: "Debit notes" };

export default function Page() {
  return <Suspense><DebitNotesScreen /></Suspense>;
}
