import { socialSignInProviders } from "@vercentlabs/api";

import { ok } from "@/core/http";

// Which "Continue with …" buttons the sign-in page shows: the providers the operator configured.
export async function GET() {
  return ok({ providers: socialSignInProviders(process.env) });
}
