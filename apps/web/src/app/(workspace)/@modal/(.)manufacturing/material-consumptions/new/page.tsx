import type { ComponentType } from "react";

import FormPage, { metadata as formMetadata } from "@/app/(workspace)/manufacturing/material-consumptions/new/form-page";
import { FormModal } from "@/shell/form-modal/FormModal";

type Props = { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> };
export const metadata = formMetadata;

// manufacturing/material-consumptions/new, opened from inside the app: the same form, in a modal over the page it was opened from.
export default function InterceptedForm(props: Props) {
  const Form = FormPage as unknown as ComponentType<Props>;
  return <FormModal title="Record material consumption"><Form {...props} /></FormModal>;
}
