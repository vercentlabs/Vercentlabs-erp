import type { ComponentType } from "react";

import FormPage, { metadata as formMetadata } from "@/app/(workspace)/sales/customers/[id]/edit/form-page";
import { FormModal } from "@/shell/form-modal/FormModal";

type Props = { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> };
export const metadata = formMetadata;

// sales/customers/[id]/edit, opened from inside the app: the same form, in a modal over the page it was opened from.
export default function InterceptedForm(props: Props) {
  const Form = FormPage as unknown as ComponentType<Props>;
  return <FormModal title="Edit customer"><Form {...props} /></FormModal>;
}
