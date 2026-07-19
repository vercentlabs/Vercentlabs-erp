import { mobileOk } from "@/lib/mobile-http";

export async function GET(request: Request) {
  return mobileOk(request, {
    service: "vercent-mobile-api",
    version: "v1",
  });
}
