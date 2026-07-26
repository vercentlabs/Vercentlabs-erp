import * as SecureStore from "expo-secure-store";
import type { MobileTokenStore, MobileTokens } from "@vercentlabs/shared-sdk";

const tokenKey = "vercentlabs.mobile.tokens.v1";

async function readTokens(): Promise<MobileTokens | null> {
  const value = await SecureStore.getItemAsync(tokenKey);
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<MobileTokens>;
    if (!parsed.accessToken || !parsed.refreshToken) return null;
    return parsed as MobileTokens;
  } catch {
    await SecureStore.deleteItemAsync(tokenKey);
    return null;
  }
}

export const secureTokenStore: MobileTokenStore = Object.freeze({
  async getAccessToken() {
    return (await readTokens())?.accessToken || null;
  },
  async getRefreshToken() {
    return (await readTokens())?.refreshToken || null;
  },
  async setTokens(tokens) {
    await SecureStore.setItemAsync(tokenKey, JSON.stringify(tokens), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },
  async clear() {
    await SecureStore.deleteItemAsync(tokenKey);
  },
});
