import type { ComponentType } from "react";

import FormPage, { metadata as formMetadata } from "@/app/(workspace)/pos/outlets/[outletId]/edit/form-page";
import { FormModal } from "@/shell/form-modal/FormModal";

type Props = { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> };
export const metadata = formMetadata;

// pos/outlets/[outletId]/edit, opened from inside the app: the same form, in a modal over the page it was opened from.
export default function InterceptedForm(props: Props) {
  const Form = FormPage as unknown as ComponentType<Props>;
  return <FormModal title="Edit store / outlet"><Form {...props} /></FormModal>;
}
