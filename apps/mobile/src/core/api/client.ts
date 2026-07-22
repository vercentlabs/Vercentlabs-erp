import { createMobileClient } from "@vercent/shared-sdk";
import { secureTokenStore } from "@/core/auth/token-store";
import { appConfig } from "@/core/config";

export const mobileApi = createMobileClient({
  baseUrl: appConfig.apiUrl,
  tokenStore: secureTokenStore,
  clientVersion: appConfig.version,
});
