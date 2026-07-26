import { mobileOk } from "@/lib/mobile-http";

export async function GET(request: Request) {
  return mobileOk(request, {
    service: "vercentlabs-mobile-api",
    version: "v1",
  });
}
