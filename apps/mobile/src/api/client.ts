import { createMobileClient } from "@vercent/shared-sdk";
import { secureTokenStore } from "@/auth/token-store";
import { appConfig } from "@/config";

export const mobileApi = createMobileClient({
  baseUrl: appConfig.apiUrl,
  tokenStore: secureTokenStore,
  clientVersion: appConfig.version,
});
